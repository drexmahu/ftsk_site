<#
.SYNOPSIS
    Assembles the local Windows development environment for ftsk_site.

.DESCRIPTION
    Verifies/reports on Go and Node.js, downloads the exact Hugo (extended)
    version pinned in .hugo-version into a local .tools\ cache (so local
    builds use the same Hugo version as CI), and installs npm dependencies.

    Version requirements are read from the repo's existing single sources of
    truth - nothing is hardcoded here:
      - Hugo version:  .hugo-version
      - Go version:    go.mod ("go x.y" directive)
      - Node version:  package.json ("engines.node")

.PARAMETER PersistPath
    Also permanently add the pinned Hugo folder to the current user's PATH
    (Environment.SetEnvironmentVariable, User scope). Off by default; without
    it, the pinned Hugo is only added to PATH for this session.

.EXAMPLE
    ./scripts/setup-dev-env.ps1
#>
[CmdletBinding()]
param(
    [switch]$PersistPath
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    function Test-CommandExists {
        param([string]$Name)
        return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
    }

    function Get-VersionNumber {
        param([string]$Text)
        $match = [regex]::Match($Text, '(\d+)\.(\d+)(\.(\d+))?')
        if (-not $match.Success) { return $null }
        return [version]$match.Value
    }

    Write-Host "== ftsk_site local dev environment setup ==" -ForegroundColor Cyan

    # ---- Hugo version (single source of truth: .hugo-version) ----
    $hugoVersionFile = Join-Path $repoRoot '.hugo-version'
    $hugoVersion = (Get-Content $hugoVersionFile -Raw).Trim()
    Write-Host "Pinned Hugo version : $hugoVersion (from .hugo-version)"

    # ---- Go version (single source of truth: go.mod) ----
    $goMod = Get-Content (Join-Path $repoRoot 'go.mod') -Raw
    $goRequiredMatch = [regex]::Match($goMod, '(?m)^go\s+(\d+\.\d+(\.\d+)?)')
    $goRequired = if ($goRequiredMatch.Success) { [version]$goRequiredMatch.Groups[1].Value } else { $null }
    Write-Host "Required Go version  : $goRequired (from go.mod)"

    # ---- Node version (single source of truth: package.json engines.node) ----
    $pkg = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
    $nodeRequired = $null
    if ($pkg.engines -and $pkg.engines.node) {
        $nodeRequired = Get-VersionNumber $pkg.engines.node
    }
    Write-Host "Required Node version: >= $nodeRequired (from package.json engines.node)"
    Write-Host ""

    # ---- Check Go ----
    if (Test-CommandExists 'go') {
        $installed = Get-VersionNumber (& go version)
        if ($goRequired -and $installed -lt $goRequired) {
            Write-Warning "Go $installed is installed but go.mod requires >= $goRequired. Update Go: https://go.dev/dl/ (or 'winget install GoLang.Go')."
        } else {
            Write-Host "Go OK: $installed" -ForegroundColor Green
        }
    } else {
        Write-Warning "Go was not found on PATH. Hugo needs Go to resolve Hugo Modules (the bookshop component library). Install it from https://go.dev/dl/ (or 'winget install GoLang.Go'), then re-run this script."
    }

    # ---- Check Node / npm ----
    $hasNode = Test-CommandExists 'node'
    if ($hasNode) {
        $installedNode = Get-VersionNumber (& node --version)
        if ($nodeRequired -and $installedNode -lt $nodeRequired) {
            Write-Warning "Node $installedNode is installed but package.json requires >= $nodeRequired. Update Node: https://nodejs.org/ (or 'winget install OpenJS.NodeJS.LTS')."
        } else {
            Write-Host "Node OK: $installedNode" -ForegroundColor Green
        }
    } else {
        Write-Warning "Node.js was not found on PATH. It's only needed for the CloudCannon/Bookshop live component preview, not for plain Hugo builds. Install it from https://nodejs.org/ (or 'winget install OpenJS.NodeJS.LTS') if you want that, then re-run this script."
    }

    # ---- Ensure pinned Hugo (extended) is available locally ----
    $toolsDir = Join-Path $repoRoot ".tools\hugo\$hugoVersion"
    $hugoExe = Join-Path $toolsDir 'hugo.exe'

    $needsDownload = $true
    if (Test-Path $hugoExe) {
        $existingVersionOutput = & $hugoExe version
        if ($existingVersionOutput -match [regex]::Escape($hugoVersion)) {
            $needsDownload = $false
            Write-Host "Hugo v$hugoVersion already present at $hugoExe" -ForegroundColor Green
        }
    }

    if ($needsDownload) {
        Write-Host "Downloading Hugo extended v$hugoVersion for windows/amd64..." -ForegroundColor Cyan
        $apiUrl = "https://api.github.com/repos/gohugoio/hugo/releases/tags/v$hugoVersion"
        $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ 'User-Agent' = 'ftsk-site-setup-script' }

        $asset = $release.assets | Where-Object { $_.name -match '(?i)^hugo_extended.*windows.*(amd64|64bit).*\.zip$' } | Select-Object -First 1
        if (-not $asset) {
            $asset = $release.assets | Where-Object { $_.name -match '(?i)extended.*windows.*\.zip$' } | Select-Object -First 1
        }
        if (-not $asset) {
            throw "Could not find a Windows extended Hugo asset for v$hugoVersion. Download it manually from https://github.com/gohugoio/hugo/releases/tag/v$hugoVersion and unzip hugo.exe into $toolsDir"
        }

        $zipPath = Join-Path $env:TEMP $asset.name
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
        New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
        Remove-Item $zipPath -Force
        Write-Host "Installed Hugo v$hugoVersion to $toolsDir" -ForegroundColor Green
    }

    # Make the pinned Hugo available on PATH for this session
    if ($env:Path -notlike "*$toolsDir*") {
        $env:Path = "$toolsDir;$env:Path"
    }

    if ($PersistPath) {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath -notlike "*$toolsDir*") {
            [Environment]::SetEnvironmentVariable('Path', "$toolsDir;$userPath", 'User')
            Write-Host "Added $toolsDir to your permanent user PATH." -ForegroundColor Green
        }
    } else {
        Write-Host "Tip: the pinned Hugo is only on PATH for this terminal session. Re-run with -PersistPath to add it permanently, or always use scripts/dev-server.ps1 which finds it automatically." -ForegroundColor DarkYellow
    }

    # ---- npm dependencies (Bookshop live component preview) ----
    if ($hasNode -and (Test-CommandExists 'npm')) {
        Write-Host "Installing npm dependencies..." -ForegroundColor Cyan
        npm install
    }

    Write-Host ""
    Write-Host "Setup complete. Next: ./scripts/dev-server.ps1" -ForegroundColor Cyan
}
finally {
    Pop-Location
}
