<#
.SYNOPSIS
  Copy doctor bad-app fixtures to a working directory for manual deep testing.

.DESCRIPTION
  Copies fixture directories from tests/fixtures/doctor-bad-apps/ to a target
  directory. The copies are safe to run `doctor --deep` against since the agent
  may write files (.azure-functions-skills/, node_modules, etc.).

.PARAMETER Target
  Destination directory. Default: $env:TEMP\doctor-e2e-<timestamp>

.PARAMETER Filter
  Glob/wildcard pattern to select fixtures. Default: * (all).
  Examples: "node-deep-*", "python-*", "*-clean"

.PARAMETER DeepOnly
  When set, copies only the "*-deep-*" fixtures (skips numbered and clean).

.EXAMPLE
  # Copy all fixtures to temp
  .\scripts\doctor-e2e-setup.ps1

  # Copy only Python fixtures to a specific directory
  .\scripts\doctor-e2e-setup.ps1 -Target C:\tmp\doctor-test -Filter "python-*"

  # Copy only deep fixtures
  .\scripts\doctor-e2e-setup.ps1 -DeepOnly

.NOTES
  After setup, run doctor against each fixture:
    $env:AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE = "1"
    node bin/azure-functions-skills.js doctor --dir <target>\<fixture> --deep --agent github-copilot --format json
#>
[CmdletBinding()]
param(
    [string]$Target,
    [string]$Filter = '*',
    [switch]$DeepOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$fixturesDir = Join-Path $repoRoot 'tests\fixtures\doctor-bad-apps'
$cliPath = Join-Path $repoRoot 'bin\azure-functions-skills.js'

if (-not (Test-Path $cliPath)) {
    Write-Error "CLI not found: $cliPath"
    exit 1
}

if (-not (Test-Path $fixturesDir)) {
    Write-Error "Fixtures directory not found: $fixturesDir"
    exit 1
}

# Default target: temp directory with timestamp
if (-not $Target) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $Target = Join-Path $env:TEMP "doctor-e2e-$timestamp"
}

# Resolve to absolute path
$Target = [System.IO.Path]::GetFullPath($Target)

# Collect fixture directories
$fixtures = @(Get-ChildItem -Path $fixturesDir -Directory |
    Where-Object { $_.Name -like $Filter } |
    Sort-Object Name)

if ($DeepOnly) {
    $fixtures = $fixtures | Where-Object { $_.Name -match '-deep-' }
}

if ($fixtures.Count -eq 0) {
    Write-Warning "No fixtures matched filter '$Filter'$(if ($DeepOnly) { ' (DeepOnly)' })"
    exit 0
}

# Create target directory
if (-not (Test-Path $Target)) {
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
}

Write-Host ""
Write-Host "Doctor E2E Fixture Setup" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan
Write-Host "Source:  $fixturesDir"
Write-Host "Target:  $Target"
Write-Host "Filter:  $Filter$(if ($DeepOnly) { ' (deep only)' })"
Write-Host "Count:   $($fixtures.Count) fixtures"
Write-Host ""

# Copy each fixture
foreach ($fixture in $fixtures) {
    $dest = Join-Path $Target $fixture.Name
    Copy-Item -Path $fixture.FullName -Destination $dest -Recurse -Force
    Write-Host "  [+] $($fixture.Name)" -ForegroundColor Green
}

# Copy expected-results.md and README.md for reference
foreach ($refFile in @('expected-results.md', 'README.md')) {
    $src = Join-Path $fixturesDir $refFile
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $Target $refFile) -Force
        Write-Host "  [+] $refFile" -ForegroundColor DarkGray
    }
}

# Write a run-all helper script into the target
$runAllContent = @'
<# Run doctor against all fixtures in this directory. #>
[CmdletBinding()]
param(
    [switch]$Deep,
    [string]$Agent = 'github-copilot',
    [string]$Format = 'json',
    [int]$Timeout = 300,
    [string]$Filter = '*'
)

$env:AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE = '1'
$dirs = Get-ChildItem -Path $PSScriptRoot -Directory |
    Where-Object { $_.Name -like $Filter } |
    Sort-Object Name

$results = @()
$startTime = Get-Date

foreach ($d in $dirs) {
    Write-Host ""
    Write-Host "=== $($d.Name) ===" -ForegroundColor Yellow
    $outFile = Join-Path $d.FullName "doctor-result.json"
    $doctorArgs = @('doctor', '--dir', $d.FullName, '--format', $Format, '--output', $outFile)
    if (-not $Deep) { $doctorArgs += '--no-deep' }
    else {
        # Doctor refuses Tier 2 without --accept-deep-risk so the user explicitly
        # acknowledges the agent runs with elevated permissions on this workspace.
        $doctorArgs += '--deep'
        $doctorArgs += '--accept-deep-risk'
        $doctorArgs += '--agent'
        $doctorArgs += $Agent
        $doctorArgs += '--timeout'
        $doctorArgs += $Timeout
    }
    $fixtureStart = Get-Date
    & node $CLI_PATH @doctorArgs 2>&1 | Out-Host
    $fixtureDuration = (Get-Date) - $fixtureStart
    $exitCode = $LASTEXITCODE
    $color = if ($exitCode -eq 0) { 'Green' } else { 'Red' }
    Write-Host ("  -> exit code: {0} (duration: {1:N1}s)" -f $exitCode, $fixtureDuration.TotalSeconds) -ForegroundColor $color

    # Parse summary from the --output file (always JSON when $Format -eq 'json')
    $summary = $null
    $aiCount = '-'
    if ($Format -eq 'json' -and (Test-Path $outFile)) {
        try {
            $json = Get-Content $outFile -Raw | ConvertFrom-Json
            $summary = $json.summary
            if ($json.tiers.ai) { $aiCount = @($json.tiers.ai.checks).Count }
        } catch {
            Write-Host "  -> WARN: failed to parse $outFile : $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    $results += [PSCustomObject]@{
        Name      = $d.Name
        ExitCode  = $exitCode
        Status    = if ($summary) { $summary.status } else { 'unknown' }
        Critical  = if ($summary) { $summary.critical } else { '-' }
        High      = if ($summary) { $summary.high } else { '-' }
        Medium    = if ($summary) { $summary.medium } else { '-' }
        AiChecks  = $aiCount
        Duration  = [Math]::Round($fixtureDuration.TotalSeconds, 1)
    }
}

$totalDuration = (Get-Date) - $startTime

Write-Host ""
Write-Host "===== Summary =====" -ForegroundColor Cyan
$results | Format-Table -AutoSize
Write-Host ("Total: {0} fixtures, {1:N1}s ({2:N1} min)" -f $results.Count, $totalDuration.TotalSeconds, $totalDuration.TotalMinutes) -ForegroundColor Cyan
Write-Host ""
Write-Host "Per-fixture reports saved to <fixture>/doctor-result.json" -ForegroundColor DarkGray
'@

# Inject the CLI path after param() block
$runAllScript = $runAllContent -replace "(?m)^(\`$env:AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE)", "`$CLI_PATH = '$cliPath'`n`$1"
$runAllPath = Join-Path $Target 'run-all.ps1'
Set-Content -Path $runAllPath -Value $runAllScript -Encoding utf8

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  # Tier 1 (deterministic) — run all:"
Write-Host "  cd $Target"
Write-Host "  .\run-all.ps1"
Write-Host ""
Write-Host "  # Tier 2 (deep) — run all:"
Write-Host "  .\run-all.ps1 -Deep -Agent github-copilot"
Write-Host ""
Write-Host "  # Single fixture:"
Write-Host "  node $cliPath doctor --dir $Target\<fixture> --deep --agent github-copilot --format json"
Write-Host ""
Write-Host "Cleanup:"
Write-Host "  .\scripts\doctor-e2e-cleanup.ps1 -Target $Target"
Write-Host ""
