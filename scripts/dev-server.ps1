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

    if ($BuildOnly) {
        $args = @('--destination', 'public', '--minify', '--gc')
        if ($BaseUrl) { $args += @('--baseURL', $BaseUrl) }
        if ($useDrafts) { $args += '-D' }
        if ($useFuture) { $args += '--buildFuture' }

        Write-Host "Building site to ./public/ ..." -ForegroundColor Cyan
        & $hugoExe @args
    } else {
        $args = @('server', '--watch', '--port', $Port)
        if ($BaseUrl) { $args += @('--baseURL', $BaseUrl) }
        if ($useDrafts) { $args += '-D' }
        if ($useFuture) { $args += '--buildFuture' }

        Write-Host "Starting Hugo dev server on http://localhost:$Port/ (Ctrl+C to stop) ..." -ForegroundColor Cyan
        & $hugoExe @args
    }
}
finally {
    Pop-Location
}
