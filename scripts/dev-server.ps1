<#
.SYNOPSIS
    Builds and hosts ftsk_site locally with Hugo for development.

.DESCRIPTION
    Uses the same pinned Hugo version as CI (.hugo-version, downloaded by
    scripts/setup-dev-env.ps1 into .tools\hugo\<version>\) and the same
    drafts/future-content conventions used by the PR/staging workflows
    (.github/workflows/*.yml + .github/actions/build-site), so what you see
    locally matches what CI validates and what the staging preview shows.

.PARAMETER BuildOnly
    Do a single static build into ./public/ instead of starting the dev server.

.PARAMETER NoDrafts
    Exclude draft content (by default drafts ARE included, like CI).

.PARAMETER NoFuture
    Exclude future-dated content (by default it IS included, like CI).

.PARAMETER Port
    Port for `hugo server`. Default 1313.

.PARAMETER BaseUrl
    Override baseURL (defaults to config.toml's baseURL).

.EXAMPLE
    ./scripts/dev-server.ps1
.EXAMPLE
    ./scripts/dev-server.ps1 -BuildOnly
#>
[CmdletBinding()]
param(
    [switch]$BuildOnly,
    [switch]$NoDrafts,
    [switch]$NoFuture,
    [int]$Port = 1313,
    [string]$BaseUrl
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $hugoVersion = (Get-Content (Join-Path $repoRoot '.hugo-version') -Raw).Trim()
    $pinnedHugoExe = Join-Path $repoRoot ".tools\hugo\$hugoVersion\hugo.exe"

    if (Test-Path $pinnedHugoExe) {
        $hugoExe = $pinnedHugoExe
    } elseif (Get-Command 'hugo' -ErrorAction SilentlyContinue) {
        $hugoExe = 'hugo'
        Write-Warning "Using global 'hugo' on PATH - version may not match the pinned $hugoVersion. Run ./scripts/setup-dev-env.ps1 to install the pinned version."
    } else {
        throw "Hugo was not found. Run ./scripts/setup-dev-env.ps1 first."
    }

    $useDrafts = -not $NoDrafts
    $useFuture = -not $NoFuture

    foreach ($relativePath in @('public', 'resources/_gen')) {
        $generatedPath = Join-Path $repoRoot $relativePath
        if (Test-Path -LiteralPath $generatedPath) {
            $generatedItem = Get-Item -LiteralPath $generatedPath -Force
            if ($generatedItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                throw "Refusing to purge a linked output directory: $generatedPath"
            }
            $pendingDirectories = New-Object 'System.Collections.Generic.Stack[string]'
            if ($generatedItem.PSIsContainer) { $pendingDirectories.Push($generatedPath) }
            while ($pendingDirectories.Count -gt 0) {
                foreach ($child in Get-ChildItem -LiteralPath $pendingDirectories.Pop() -Force) {
                    if ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                        throw "Refusing to purge an output tree containing a link: $($child.FullName)"
                    }
                    if ($child.PSIsContainer) { $pendingDirectories.Push($child.FullName) }
                }
            }
            Remove-Item -LiteralPath $generatedPath -Recurse -Force
        }
    }

    if ($BuildOnly) {
        $hugoArgs = @('--destination', 'public', '--minify', '--gc', '--cleanDestinationDir')
        if ($BaseUrl) { $hugoArgs += @('--baseURL', $BaseUrl) }
        if ($useDrafts) { $hugoArgs += '-D' }
        if ($useFuture) { $hugoArgs += '--buildFuture' }

        Write-Host "Building site to ./public/ ..." -ForegroundColor Cyan
        & $hugoExe @hugoArgs
    } else {
        $hugoArgs = @('server', '--watch', '--port', $Port, '--destination', 'public', '--cleanDestinationDir', '--disableFastRender')
        if ($BaseUrl) { $hugoArgs += @('--baseURL', $BaseUrl) }
        if ($useDrafts) { $hugoArgs += '-D' }
        if ($useFuture) { $hugoArgs += '--buildFuture' }

        Write-Host "Starting Hugo dev server on http://localhost:$Port/ (Ctrl+C to stop) ..." -ForegroundColor Cyan
        & $hugoExe @hugoArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Hugo exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
