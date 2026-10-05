#Requires -Version 5.1
<#
.SYNOPSIS
    Installs the complete Windows development and preview environment.
.DESCRIPTION
    Reuses compatible tools, installs user-scoped Git/VS Code/Python with
    WinGet, installs verified portable Go/Node/Hugo archives, and creates
    .venv for all Python tooling. Does not elevate or change machine PATH.
.PARAMETER CheckOnly
    Inspect dependencies without downloading, installing, or writing files.
.PARAMETER NonInteractive
    Skip the initial confirmation; package license/source agreements are accepted.
.PARAMETER PersistPath
    Add tool folders to current-user PATH. Enabled by default; use -PersistPath:$false to opt out.
.PARAMETER PythonPath
    Select an existing 64-bit Python interpreter with Tk support.
.PARAMETER SkipEditor
    Skip VS Code and its extensions.
.PARAMETER SkipVerification
    Skip the final site build and tooling smoke tests.
.EXAMPLE
    ./scripts/setup-dev-env.ps1 -CheckOnly
.EXAMPLE
    ./scripts/setup-dev-env.ps1 -NonInteractive
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$CheckOnly,
    [switch]$NonInteractive,
    [switch]$PersistPath = $true,
    [string]$PythonPath,
    [switch]$SkipEditor,
    [switch]$SkipVerification
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$results = New-Object 'System.Collections.Generic.List[object]'
$setupContext = $PSCmdlet
$script:pythonExe = $null
$script:hugoExe = $null
$script:codeExe = $null
$script:npmExe = $null

function Invoke-Tool {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "$Executable exited with code $LASTEXITCODE. See the output above." }
}

function Find-Tool {
    param([string]$Name, [string[]]$Candidates = @())
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and $command.CommandType -eq 'Application') { return $command.Source }
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    return $null
}

function Read-Version {
    param([string]$Executable, [string[]]$Arguments)
    if (-not $Executable) { return $null }
    try {
        $output = (& $Executable @Arguments 2>$null) -join ' '
        if ($LASTEXITCODE -ne 0) { return $null }
        $match = [regex]::Match($output, '\d+\.\d+(?:\.\d+)?')
        if ($match.Success) { return [version]$match.Value }
    } catch { return $null }
    return $null
}

function Add-ToolPath {
    param([string]$Directory)
    if (-not $Directory -or -not (Test-Path -LiteralPath $Directory -PathType Container)) { return }
    if (($env:Path -split ';') -notcontains $Directory) { $env:Path = "$Directory;$env:Path" }
    if ($PersistPath -and -not $CheckOnly -and -not $WhatIfPreference) {
        $current = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (($current -split ';') -notcontains $Directory) {
            [Environment]::SetEnvironmentVariable('Path', "$Directory;$current", 'User')
        }
    }
}

function Refresh-ToolPaths {
    foreach ($scope in @('Machine', 'User')) {
        foreach ($directory in ([Environment]::GetEnvironmentVariable('Path', $scope) -split ';')) {
            if ($directory -and ($env:Path -split ';') -notcontains $directory) { $env:Path += ";$directory" }
        }
    }
    foreach ($directory in @(
        "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin", "$env:ProgramFiles\Microsoft VS Code\bin",
        "$env:LOCALAPPDATA\Programs\Git\cmd", "$env:LOCALAPPDATA\Git\cmd", "$env:ProgramFiles\Git\cmd",
        "$env:ProgramFiles\Go\bin", "$env:ProgramFiles\nodejs"
    )) { Add-ToolPath $directory }
    foreach ($pattern in @('.tools/go/*/go/bin', '.tools/node/*/*', '.tools/hugo/*')) {
        Get-ChildItem (Join-Path $repoRoot $pattern) -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Add-ToolPath $_.FullName }
    }
}

function Require-Changes {
    param([string]$Description)
    if ($CheckOnly) { throw "Missing or incompatible: $Description" }
    if (-not $setupContext.ShouldProcess($Description, 'Install/configure')) { throw "Not changed: $Description" }
}

function Install-UserPackage {
    param([string]$Id)
    $winget = Find-Tool 'winget.exe'
    if (-not $winget) { throw 'WinGet is missing. Install/update App Installer from Microsoft Store, then rerun setup. No elevated installer will be launched.' }
    Invoke-Tool $winget @('install', '--id', $Id, '--exact', '--source', 'winget', '--scope', 'user', '--architecture', 'x64', '--silent', '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements')
    Refresh-ToolPaths
}

function Get-Download {
    param([string]$Uri, [string]$Destination)
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination -TimeoutSec 180
            return
        } catch {
            if ($attempt -eq 3) { throw }
            Write-Warning "Download attempt $attempt failed; retrying."
        }
    }
}

function Install-VerifiedZip {
    param([string]$Uri, [string]$Checksum, [string]$Destination)
    if ($Checksum -notmatch '^[a-fA-F0-9]{64}$') { throw 'A valid SHA-256 checksum is required before installing a tool archive.' }
    if ((Test-Path -LiteralPath $Destination) -and ((Get-Item -LiteralPath $Destination -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing a linked tool folder: $Destination" }
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ("ftsk-setup-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $temporary | Out-Null
    try {
        $archive = Join-Path $temporary 'tool.zip'
        Get-Download $Uri $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $Checksum) { throw 'Downloaded archive failed SHA-256 verification.' }
        New-Item -ItemType Directory -Force -Path $Destination | Out-Null
        Expand-Archive -LiteralPath $archive -DestinationPath $Destination -Force
    } finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
}

function Get-Checksum {
    param([string]$Text, [string]$Filename)
    $match = [regex]::Match($Text, '(?im)^([a-f0-9]{64})\s+\*?' + [regex]::Escape($Filename) + '\s*$')
    if (-not $match.Success) { throw "Checksum not found for $Filename" }
    return $match.Groups[1].Value
}

function Invoke-SetupStep {
    param([string]$Name, [scriptblock]$Action)
    Write-Host "`n== $Name ==" -ForegroundColor Cyan
    try {
        $detail = & $Action
        $status = 'Ready'
        Write-Host $detail -ForegroundColor Green
    } catch {
        $detail = $_.Exception.Message
        $status = if ($CheckOnly) { 'Missing' } elseif ($WhatIfPreference) { 'Planned' } else { 'Failed' }
        Write-Warning "$Name : $detail"
    }
    $results.Add([pscustomobject]@{ Component = $Name; Status = $status; Detail = ($detail -join ' ') })
}

function Find-Python {
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    if ($PythonPath) { $candidates.Add($PythonPath) }
    $command = Find-Tool 'python.exe'
    if ($command -and $command -notmatch 'WindowsApps') { $candidates.Add($command) }
    foreach ($pattern in @("$env:LOCALAPPDATA\Programs\Python\Python*\python.exe", "$env:LOCALAPPDATA\Python\pythoncore-*\python.exe", "$env:ProgramFiles\Python*\python.exe")) {
        Get-ChildItem $pattern -File -ErrorAction SilentlyContinue | ForEach-Object { $candidates.Add($_.FullName) }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        try {
            $info = & $candidate -c "import json,sys,struct,tkinter,venv; print(json.dumps(dict(exe=sys.executable,version=list(sys.version_info[:3]),bits=struct.calcsize('P')*8)))" 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            $parsed = $info | ConvertFrom-Json
            if ($parsed.bits -eq 64 -and ([version]($parsed.version -join '.')) -ge [version]'3.10') { return $parsed.exe }
        } catch { continue }
    }
    return $null
}

Push-Location $repoRoot
try {
    if (-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT') { throw 'This installer requires 64-bit Windows 10/11 and PowerShell 5.1 or newer.' }
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This installer currently targets Windows x64; native ARM64 tool archives require a separately configured environment.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $hugoVersion = (Get-Content '.hugo-version' -Raw).Trim()
    $goMatch = [regex]::Match((Get-Content 'go.mod' -Raw), '(?m)^go\s+(\d+\.\d+(?:\.\d+)?)')
    if (-not $goMatch.Success) { throw 'go.mod does not specify a minimum Go version.' }
    $goMinimum = [version]$goMatch.Groups[1].Value
    $package = Get-Content 'package.json' -Raw | ConvertFrom-Json
    $nodeMatch = [regex]::Match($package.engines.node, '^>=\s*(\d+\.\d+(?:\.\d+)?)$')
    if (-not $nodeMatch.Success) { throw 'Unsupported Node engines range; update the installer to match package.json.' }
    $nodeMinimum = [version]$nodeMatch.Groups[1].Value
    Write-Host 'FTSK development environment setup' -ForegroundColor Cyan
    Write-Host "Git, VS Code/extensions, Go >= $goMinimum, Node >= $nodeMinimum, Hugo extended $hugoVersion, Python/Tk and all script dependencies."
    Write-Host 'User-scoped software and portable tools only. Python packages use .venv. No production credentials are requested.'
    if (-not $CheckOnly -and -not $WhatIfPreference -and -not $NonInteractive) {
        $answer = Read-Host 'Install missing components and accept their package/source agreements? [Y/n]'
        if ($answer -and $answer -notmatch '^(?i)y(es)?$') { Write-Host 'Cancelled; no dependencies changed.'; return }
    }
    Refresh-ToolPaths

    Invoke-SetupStep 'Git' {
        $git = Find-Tool 'git.exe'
        if (-not (Read-Version $git @('--version'))) { Require-Changes 'Git'; Install-UserPackage 'Git.Git'; $git = Find-Tool 'git.exe' }
        if (-not (Read-Version $git @('--version'))) { throw 'Git installation was not found. Restart the terminal and rerun setup.' }
        "Available: $git"
    }

    if (-not $SkipEditor) {
        Invoke-SetupStep 'Visual Studio Code' {
            $script:codeExe = Find-Tool 'code.cmd'
            if (-not $script:codeExe) { Require-Changes 'Visual Studio Code'; Install-UserPackage 'Microsoft.VisualStudioCode'; $script:codeExe = Find-Tool 'code.cmd' }
            if (-not $script:codeExe) { throw 'VS Code CLI was not found after installation. Restart the terminal and rerun.' }
            "Available: $script:codeExe"
        }
        Invoke-SetupStep 'VS Code extensions' {
            if (-not $script:codeExe) { throw 'VS Code is required before installing extensions.' }
            $extensions = @('yzhang.markdown-all-in-one', 'DavidAnson.vscode-markdownlint', 'ms-vscode.PowerShell', 'ms-python.python', 'ms-python.vscode-pylance', 'budparr.language-hugo-vscode')
            $installed = @(& $script:codeExe --list-extensions)
            if ($LASTEXITCODE -ne 0) { throw 'Could not list VS Code extensions.' }
            $missing = @($extensions | Where-Object { $installed -notcontains $_ })
            if ($CheckOnly -and $missing.Count) { throw ('Missing extensions: ' + ($missing -join ', ')) }
            foreach ($extension in $extensions) {
                if ($installed -notcontains $extension) { Require-Changes "VS Code extension $extension"; Invoke-Tool $script:codeExe @('--install-extension', $extension) }
                else { Write-Host "Already installed: $extension" }
            }
            'Markdown, PowerShell, Python/Pylance and Hugo syntax support are ready.'
        }
    }

    Invoke-SetupStep 'Go / Hugo Modules' {
        $go = Find-Tool 'go.exe'
        $version = Read-Version $go @('version')
        if (-not $version -or $version -lt $goMinimum) {
            Require-Changes "Go >= $goMinimum"
            $releases = Invoke-RestMethod 'https://go.dev/dl/?mode=json' -Headers @{ 'User-Agent' = 'ftsk-site-setup' }
            $release = $releases | Where-Object { $_.stable } | Select-Object -First 1
            $asset = $release.files | Where-Object { $_.os -eq 'windows' -and $_.arch -eq 'amd64' -and $_.kind -eq 'archive' } | Select-Object -First 1
            if (-not $asset) { throw 'A verified Windows x64 Go archive was not found.' }
            $destination = Join-Path $repoRoot ".tools/go/$($release.version)"
            Install-VerifiedZip "https://go.dev/dl/$($asset.filename)" $asset.sha256 $destination
            Add-ToolPath (Join-Path $destination 'go/bin')
            $go = Find-Tool 'go.exe'; $version = Read-Version $go @('version')
        }
        if (-not $version -or $version -lt $goMinimum) { throw 'Go version validation failed.' }
        "Go $version : $go"
    }

    Invoke-SetupStep 'Node.js / npm' {
        $node = Find-Tool 'node.exe'
        $version = Read-Version $node @('--version')
        if (-not $version -or $version -lt $nodeMinimum) {
            Require-Changes "Node LTS >= $nodeMinimum"
            $releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
            $release = $releases | Where-Object { $_.lts -and ([version]$_.version.TrimStart('v')) -ge $nodeMinimum -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
            if (-not $release) { throw 'A compatible Node LTS Windows x64 archive was not found.' }
            $filename = "node-$($release.version)-win-x64.zip"
            $checksums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt").Content
            $destination = Join-Path $repoRoot ".tools/node/$($release.version)"
            Install-VerifiedZip "https://nodejs.org/dist/$($release.version)/$filename" (Get-Checksum $checksums $filename) $destination
            Add-ToolPath (Join-Path $destination "node-$($release.version)-win-x64")
            $node = Find-Tool 'node.exe'; $version = Read-Version $node @('--version')
        }
        $script:npmExe = Find-Tool 'npm.cmd'
        if (-not $version -or $version -lt $nodeMinimum -or -not $script:npmExe) { throw 'Compatible Node and npm were not found.' }
        "Node $version and npm are ready."
    }

    Invoke-SetupStep 'Pinned Hugo extended' {
        $directory = Join-Path $repoRoot ".tools/hugo/$hugoVersion"
        $pinnedExecutable = Join-Path $directory 'hugo.exe'
        $script:hugoExe = if (Test-Path -LiteralPath $pinnedExecutable -PathType Leaf) { $pinnedExecutable } else { Find-Tool 'hugo.exe' }
        $output = if ($script:hugoExe) { (& $script:hugoExe version) -join ' ' } else { '' }
        if ($output -notmatch ('v' + [regex]::Escape($hugoVersion) + '(?:\s|[-+])') -or $output -notmatch 'extended') {
            Require-Changes "Hugo extended $hugoVersion"
            $release = Invoke-RestMethod "https://api.github.com/repos/gohugoio/hugo/releases/tags/v$hugoVersion" -Headers @{ 'User-Agent' = 'ftsk-site-setup' }
            $asset = $release.assets | Where-Object { $_.name -match '^hugo_extended_[0-9].*windows[-_]amd64\.zip$' } | Select-Object -First 1
            if (-not $asset) { throw 'The pinned Windows x64 Hugo extended archive was not found.' }
            $checksumAsset = $release.assets | Where-Object { $_.name -match 'checksums.*\.txt$' } | Select-Object -First 1
            if (-not $checksumAsset) { throw 'Hugo checksum manifest was not found.' }
            $checksums = (Invoke-WebRequest -UseBasicParsing $checksumAsset.browser_download_url).Content
            Install-VerifiedZip $asset.browser_download_url (Get-Checksum $checksums $asset.name) $directory
            $script:hugoExe = Join-Path $directory 'hugo.exe'
            $output = (& $script:hugoExe version) -join ' '
        }
        if ($output -notmatch 'extended' -or (Read-Version $script:hugoExe @('version')) -ne [version]$hugoVersion) { throw 'Pinned Hugo version/extended validation failed.' }
        Add-ToolPath (Split-Path -Parent $script:hugoExe)
        "Available: $output"
    }

    Invoke-SetupStep 'Python / Tk GUI support' {
        $script:pythonExe = Find-Python
        if (-not $script:pythonExe) {
            if ($PythonPath) { throw 'The supplied -PythonPath must be a working 64-bit Python >= 3.10 with Tk and venv.' }
            Require-Changes '64-bit Python with Tk, pip and venv'
            Install-UserPackage 'Python.Python.3.12'
            $script:pythonExe = Find-Python
        }
        if (-not $script:pythonExe) { throw 'A working 64-bit Python >= 3.10 with Tk and venv was not found. Use -PythonPath to select one.' }
        "Available: $script:pythonExe"
    }

    Invoke-SetupStep 'Project Python environment and packages' {
        if (-not $script:pythonExe) { throw 'Python must be ready first.' }
        $venv = Join-Path $repoRoot '.venv'
        if ((Test-Path -LiteralPath $venv) -and ((Get-Item -LiteralPath $venv -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing to install packages into a linked .venv.' }
        $environmentPython = Join-Path $venv 'Scripts/python.exe'
        if (-not (Test-Path -LiteralPath $environmentPython)) {
            Require-Changes 'Project .venv'
            if (Test-Path -LiteralPath $venv) { throw 'Existing .venv is incomplete; rename it before retrying. It was not deleted.' }
            Invoke-Tool $script:pythonExe @('-m', 'venv', $venv)
        }
        if (-not $CheckOnly -and -not $WhatIfPreference) {
            Require-Changes 'Python tooling packages in .venv'
            Invoke-Tool $environmentPython @('-m', 'pip', 'install', '--only-binary=:all:', '-r', (Join-Path $PSScriptRoot 'requirements-dev.txt'))
            Invoke-Tool $environmentPython @('-m', 'pip', 'check')
        }
        Invoke-Tool $environmentPython @('-c', 'import PIL,yaml,paramiko,tkinter')
        $script:pythonExe = $environmentPython
        'Pillow, PyYAML, Paramiko and Tk are ready in .venv.'
    }

    Invoke-SetupStep 'Bookshop / npm packages' {
        if (-not $script:npmExe) { throw 'Node/npm must be ready first.' }
        $manifestHash = (Get-FileHash 'package.json' -Algorithm SHA256).Hash
        if (Test-Path 'package-lock.json') { $manifestHash += (Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash }
        $stamp = Join-Path $repoRoot '.tools/npm-setup.sha256'
        $treeReady = $false
        if (Test-Path 'node_modules') {
            try {
                & $script:npmExe ls --depth=0 --json 2>$null | Out-Null
                $treeReady = $LASTEXITCODE -eq 0
            } catch { $treeReady = $false }
        }
        $sameManifest = (Test-Path -LiteralPath $stamp) -and ((Get-Content -LiteralPath $stamp -Raw).Trim() -eq $manifestHash)
        if ($treeReady -and ($sameManifest -or $CheckOnly -or $WhatIfPreference)) { 'Compatible npm dependencies already installed.'; return }
        Require-Changes 'Repository npm dependencies'
        $mode = if (Test-Path 'package-lock.json') { 'ci' } else { 'install' }
        Invoke-Tool $script:npmExe @($mode, '--no-fund', '--no-audit')
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stamp) | Out-Null
        Set-Content -LiteralPath $stamp -Value $manifestHash -Encoding ASCII
        'Bookshop and npm-run-all are ready.'
    }

    if (-not $SkipVerification) {
        Invoke-SetupStep 'Build and tooling verification' {
            if ($CheckOnly -or $WhatIfPreference) { 'Build skipped in inspection mode.'; return }
            if (-not $script:hugoExe -or -not $script:pythonExe -or -not $script:npmExe) { throw 'Required tools are not ready; build verification cannot run.' }
            $temporary = Join-Path ([IO.Path]::GetTempPath()) ("ftsk-setup-build-" + [guid]::NewGuid())
            try {
                Invoke-Tool $script:hugoExe @('--destination', $temporary, '--baseURL', 'https://www.ftsk.hu/', '--buildDrafts', '--buildFuture')
                Invoke-Tool $script:pythonExe @('scripts/verify_members.py')
                Invoke-Tool $script:pythonExe @('scripts/verify_site_links.py', '--root', $temporary, '--base-url', 'https://www.ftsk.hu/')
                Invoke-Tool (Find-Tool 'node.exe') @('scripts/site_image_converter/test_hero_framing.js')
                Invoke-Tool $script:pythonExe @('-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_social*.py')
                Invoke-Tool $script:pythonExe @('-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_*workbench.py')
            } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force } }
            'Site build, roster, internal links, hero framing, social cards and browser content/image workbench verified.'
        }
    }

    Write-Host "`nSetup summary" -ForegroundColor Cyan
    $results | Format-Table Component, Status, Detail -Wrap -AutoSize | Out-Host
    if (-not $CheckOnly -and -not $WhatIfPreference) {
        $reportDirectory = Join-Path $repoRoot '.tools'
        New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
        $results | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $reportDirectory 'setup-report.json') -Encoding UTF8
    }
    if ($results | Where-Object { $_.Status -in @('Failed', 'Missing') }) { throw 'Setup needs attention. Resolve the components listed above and rerun; completed components are reused.' }
    if ($WhatIfPreference) {
        Write-Host 'Plan only; rerun without -WhatIf to install missing components.' -ForegroundColor Cyan
    } elseif ($CheckOnly) {
        Write-Host 'All inspected components are ready; no installation changes were made.' -ForegroundColor Green
    } else {
        Write-Host 'Next: restart VS Code/your terminal, then ./scripts/run_workbench.bat (browser tools) or ./scripts/dev-server.ps1. Python CLI: ./.venv/Scripts/Activate.ps1.' -ForegroundColor Green
    }
} catch {
    Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally { Pop-Location }
