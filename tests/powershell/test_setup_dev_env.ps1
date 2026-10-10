#Requires -Version 5.1
param(
    [string]$PythonPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.venv\Scripts\python.exe'),
    [switch]$Online
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $repo 'scripts\setup-dev-env.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }

# Load only helpers, never the installation entry point.
foreach ($name in @('Read-DownloadText', 'Get-Download', 'Get-Checksum', 'Install-VerifiedZip', 'Find-Python', 'Test-WorkbenchEditorAssets')) {
    $definition = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }.GetNewClosure(), $true)
    if (-not $definition) { throw "Missing setup helper: $name" }
    Set-Item "Function:\$name" ([scriptblock]::Create($definition.Body.Extent.Text.TrimStart('{').TrimEnd('}')))
}
$realDownload = (Get-Item Function:\Get-Download).ScriptBlock

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -ne $Expected) { throw "$Message : expected '$Expected', got '$Actual'" }
}
function Assert-Rejected([scriptblock]$Action, [string]$Message) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw $Message }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("ftsk-setup-test-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $editorFixture = Join-Path $fixture 'editor'
    New-Item -ItemType Directory -Path (Join-Path $editorFixture '.tools/workbench-editor') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $editorFixture 'tools/workbench/web') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $editorFixture 'scripts') -Force | Out-Null
    Assert-Equal (Test-WorkbenchEditorAssets $editorFixture) $false 'Missing editor bundle needs setup'
    $hashes = @{}
    foreach ($file in @('package-lock.json', 'tools/workbench/web/monaco-entry.js', 'scripts/build_workbench_editors.js')) {
        Set-Content -LiteralPath (Join-Path $editorFixture $file) -Value 'fixture source'
        $hashes[$file] = (Get-FileHash -LiteralPath (Join-Path $editorFixture $file) -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $editorAssets = Join-Path $editorFixture '.tools/workbench-editor'
    foreach ($file in @('editor.js', 'editor.css', 'editor.worker.js', 'json.worker.js', 'css.worker.js', 'html.worker.js', 'ts.worker.js')) {
        Set-Content -LiteralPath (Join-Path $editorAssets $file) -Value 'fixture asset'
    }
    $hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $editorAssets 'version.json')
    Assert-Equal (Test-WorkbenchEditorAssets $editorFixture) $true 'Matching editor bundle is reused'
    Remove-Item -LiteralPath (Join-Path $editorAssets 'json.worker.js')
    Assert-Equal (Test-WorkbenchEditorAssets $editorFixture) $false 'Missing worker needs a rebuild'
    Set-Content -LiteralPath (Join-Path $editorAssets 'json.worker.js') -Value 'fixture asset'
    Add-Content -LiteralPath (Join-Path $editorFixture 'package-lock.json') -Value 'changed dependency'
    Assert-Equal (Test-WorkbenchEditorAssets $editorFixture) $false 'Changed dependency lock needs a rebuild'

    $hash = 'a' * 64
    $filename = 'hugo_extended_0.166.0_windows-amd64.zip'
    $script:responseContent = [Text.Encoding]::UTF8.GetBytes("$hash  $filename`n")
    function Invoke-WebRequest { param($Uri, [switch]$UseBasicParsing, $TimeoutSec)
        [pscustomobject]@{ Content = $script:responseContent }
    }
    Assert-Equal (Get-Checksum (Read-DownloadText 'https://example.test/checksums') $filename) $hash 'Binary checksum response'
    $script:responseContent = "$hash *$filename`r`n"
    Assert-Equal (Get-Checksum (Read-DownloadText 'https://example.test/checksums') $filename) $hash 'Text checksum response'
    Assert-Rejected { Get-Checksum 'not a manifest' $filename } 'Missing checksums must fail'

    $archiveSource = Join-Path $fixture 'source.txt'
    Set-Content -LiteralPath $archiveSource -Value 'test archive'
    $script:archive = Join-Path $fixture 'source.zip'
    Compress-Archive -LiteralPath $archiveSource -DestinationPath $script:archive
    function Get-Download { param($Uri, $Destination)
        Copy-Item -LiteralPath $script:archive -Destination $Destination
    }
    $destination = Join-Path $fixture 'verified'
    Assert-Rejected { Install-VerifiedZip 'https://example.test/tool.zip' $hash $destination } 'Checksum mismatch must fail'
    Assert-Equal (Test-Path -LiteralPath $destination) $false 'Mismatch must not extract'
    $actualHash = (Get-FileHash -LiteralPath $script:archive -Algorithm SHA256).Hash
    Install-VerifiedZip 'https://example.test/tool.zip' $actualHash $destination
    Assert-Equal (Test-Path -LiteralPath (Join-Path $destination 'source.txt')) $true 'Verified archive extracts'

    $script:workingPython = (Resolve-Path -LiteralPath $PythonPath).Path
    $script:launcher = Join-Path $fixture 'py.cmd'
    Set-Content -LiteralPath $script:launcher -Encoding ASCII -Value "@echo off`r`necho $script:workingPython`r`nexit /b 0"
    $script:launcherProbes = 0
    function Find-Tool { param($Name, $Candidates)
        if ($Name -eq 'py.exe') { $script:launcherProbes++; return $script:launcher }
        return $null
    }
    function Get-ChildItem { param($Path, [switch]$File, $ErrorAction) }
    $PythonPath = ''
    Assert-Equal (Find-Python) $script:workingPython 'py-only Python discovery'
    $before = $script:launcherProbes
    $PythonPath = Join-Path $fixture 'missing-python.exe'
    Assert-Equal (Find-Python) $null 'Invalid explicit Python cannot silently select another interpreter'
    Assert-Equal $script:launcherProbes $before 'Explicit selection does not probe launcher'
    $PythonPath = $script:workingPython
    Assert-Equal (Find-Python) $script:workingPython 'Explicit compatible Python'

    Remove-Item Function:\Get-ChildItem
    $launcherRoot = Join-Path $fixture 'checkout with spaces'
    New-Item -ItemType Directory -Path (Join-Path $launcherRoot 'scripts') | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'setup-dev-env.bat') -Destination $launcherRoot
    $stub = Join-Path $launcherRoot 'scripts\setup-dev-env.ps1'
    foreach ($code in @(0, 7)) {
        $content = @'
param([switch]$CheckOnly)
if (-not $CheckOnly) { throw 'Arguments were not forwarded' }
if ((Get-Location).Path -ne (Split-Path $PSScriptRoot -Parent)) { throw 'Wrong working directory' }
Write-Host 'LAUNCHER-VERIFIED'
exit EXIT_CODE
'@
        Set-Content -LiteralPath $stub -Value $content.Replace('EXIT_CODE', [string]$code) -Encoding UTF8
        Push-Location $env:TEMP
        try {
            $output = (& $env:ComSpec /d /c ('call "' + (Join-Path $launcherRoot 'setup-dev-env.bat') + '" -CheckOnly <nul')) -join "`n"
            Assert-Equal $LASTEXITCODE $code 'Double-click launcher preserves setup exit status'
            if ($output -notmatch 'LAUNCHER-VERIFIED') { throw 'Launcher did not execute setup' }
            if ($code -eq 7 -and $output -notmatch 'Setup did not complete') { throw 'Launcher must explain failures' }
        } finally { Pop-Location }
    }
    Copy-Item -LiteralPath (Join-Path $repo 'site_editor.bat') -Destination $launcherRoot
    $output = (& $env:ComSpec /d /c ('call "' + (Join-Path $launcherRoot 'site_editor.bat') + '" <nul')) -join "`n"
    Assert-Equal $LASTEXITCODE 1 'Missing project Python must fail startup'
    if ($output -notmatch 'Double-click setup-dev-env.bat') { throw 'Workbench must explain how to install the environment' }

    & $script:workingPython -m venv --without-pip (Join-Path $launcherRoot '.venv')
    Assert-Equal $LASTEXITCODE 0 'Create disposable launcher interpreter'
    $moduleRoot = Join-Path $launcherRoot 'tools\workbench'
    New-Item -ItemType Directory -Path $moduleRoot -Force | Out-Null
    foreach ($code in @(0, 7)) {
        $content = @'
import sys
from pathlib import Path
assert Path.cwd() == Path(__file__).resolve().parents[2], "Wrong working directory"
assert sys.argv[1:] == ["--port", "8897", "--no-browser"], "Arguments were not forwarded"
print("WORKBENCH-LAUNCHER-VERIFIED")
sys.exit(EXIT_CODE)
'@
        Set-Content -LiteralPath (Join-Path $moduleRoot '__main__.py') -Value $content.Replace('EXIT_CODE', [string]$code) -Encoding UTF8
        Push-Location $env:TEMP
        try {
            $output = (& $env:ComSpec /d /c ('set "PYTHONDONTWRITEBYTECODE=1" & call "' + (Join-Path $launcherRoot 'site_editor.bat') + '" --port 8897 --no-browser <nul')) -join "`n"
            Assert-Equal $LASTEXITCODE $code 'Workbench launcher preserves application exit status'
            if ($output -notmatch 'WORKBENCH-LAUNCHER-VERIFIED') { throw 'Workbench launcher did not execute the module' }
            if ($code -eq 7 -and $output -notmatch 'Workbench could not start') { throw 'Workbench launcher must explain failures' }
        } finally { Pop-Location }
    }

    if ($Online) {
        Remove-Item Function:\Invoke-WebRequest
        Set-Item Function:\Get-Download $realDownload
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $version = (Get-Content (Join-Path $repo '.hugo-version') -Raw).Trim()
        $releaseUrl = "https://github.com/gohugoio/hugo/releases/download/v$version"
        $filename = "hugo_extended_${version}_windows-amd64.zip"
        $checksums = Read-DownloadText "$releaseUrl/hugo_${version}_checksums.txt"
        $hugoDirectory = Join-Path $fixture 'hugo'
        Install-VerifiedZip "$releaseUrl/$filename" (Get-Checksum $checksums $filename) $hugoDirectory
        $versionOutput = (& (Join-Path $hugoDirectory 'hugo.exe') version) -join ' '
        Assert-Equal $LASTEXITCODE 0 'Downloaded Hugo runs'
        if ($versionOutput -notmatch 'extended' -or $versionOutput -notmatch ('v' + [regex]::Escape($version))) {
            throw "Wrong downloaded Hugo: $versionOutput"
        }
        Write-Host "PASS: Official Hugo download, SHA-256 verification, extraction and executable version: $versionOutput"
    }
    Write-Host 'PASS: PS5.1 checksums, verified archives, Monaco bundle freshness, py-only detection, explicit Python selection, and setup launcher success/failure.' -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
exit 0
