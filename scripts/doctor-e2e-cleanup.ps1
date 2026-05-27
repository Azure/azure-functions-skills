<#
.SYNOPSIS
  Remove doctor E2E fixture working directories.

.DESCRIPTION
  Removes a specific target directory or all doctor-e2e-* directories under $env:TEMP.

.PARAMETER Target
  Specific directory to remove. If not specified, lists and optionally removes
  all doctor-e2e-* directories under $env:TEMP.

.PARAMETER All
  Remove all doctor-e2e-* directories under $env:TEMP without prompting.

.PARAMETER Force
  Skip confirmation prompt.

.EXAMPLE
  # Remove a specific directory
  .\scripts\doctor-e2e-cleanup.ps1 -Target C:\tmp\doctor-test

  # List and interactively remove temp directories
  .\scripts\doctor-e2e-cleanup.ps1

  # Remove all temp doctor-e2e directories
  .\scripts\doctor-e2e-cleanup.ps1 -All -Force
#>
[CmdletBinding()]
param(
    [string]$Target,
    [switch]$All,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Remove-DoctorDir {
    param([string]$Path)
    if (Test-Path $Path) {
        $itemCount = @(Get-ChildItem -Path $Path -Recurse -File).Count
        Remove-Item -Path $Path -Recurse -Force
        Write-Host "  [-] Removed $Path ($itemCount files)" -ForegroundColor Red
    } else {
        Write-Host "  [?] Not found: $Path" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Doctor E2E Cleanup" -ForegroundColor Cyan
Write-Host "==================" -ForegroundColor Cyan
Write-Host ""

if ($Target) {
    # Remove specific directory
    $Target = [System.IO.Path]::GetFullPath($Target)
    if (-not (Test-Path $Target)) {
        Write-Host "Target not found: $Target" -ForegroundColor Yellow
        exit 0
    }

    if (-not $Force) {
        $confirm = Read-Host "Remove $Target ? (y/N)"
        if ($confirm -ne 'y') {
            Write-Host "Cancelled." -ForegroundColor Yellow
            exit 0
        }
    }

    Remove-DoctorDir $Target
    Write-Host ""
    Write-Host "Cleanup complete." -ForegroundColor Green

} else {
    # Find all doctor-e2e-* directories in TEMP
    $dirs = @(Get-ChildItem -Path $env:TEMP -Directory -Filter 'doctor-e2e-*' |
            Sort-Object CreationTime)

    if ($dirs.Count -eq 0) {
        Write-Host "No doctor-e2e-* directories found in $env:TEMP" -ForegroundColor Yellow
        exit 0
    }

    Write-Host "Found $($dirs.Count) doctor-e2e directories in $env:TEMP`:"
    Write-Host ""
    foreach ($d in $dirs) {
        $fileCount = @(Get-ChildItem -Path $d.FullName -Recurse -File).Count
        $age = [math]::Round(((Get-Date) - $d.CreationTime).TotalHours, 1)
        Write-Host "  $($d.Name)  ($fileCount files, ${age}h ago)" -ForegroundColor Gray
    }
    Write-Host ""

    if ($All) {
        if (-not $Force) {
            $confirm = Read-Host "Remove all $($dirs.Count) directories? (y/N)"
            if ($confirm -ne 'y') {
                Write-Host "Cancelled." -ForegroundColor Yellow
                exit 0
            }
        }
        foreach ($d in $dirs) { Remove-DoctorDir $d.FullName }
    } else {
        foreach ($d in $dirs) {
            $confirm = Read-Host "Remove $($d.Name)? (y/N/q)"
            if ($confirm -eq 'q') { break }
            if ($confirm -eq 'y') { Remove-DoctorDir $d.FullName }
        }
    }

    Write-Host ""
    Write-Host "Cleanup complete." -ForegroundColor Green
}
