param($Timer)

Write-Host "Timer trigger function executed at: $(Get-Date)"

# BAD: PS-003 — Installing modules at runtime instead of using managed dependencies
Install-Module -Name ImportExcel -Force -AllowClobber -Scope CurrentUser

# BAD: CQ-002 — Writing to $env: expecting persistence across invocations
# Environment variables set here persist within the worker process but NOT across scale-out instances
$env:LAST_RUN_TIME = (Get-Date).ToString("o")
$env:RUN_COUNT = [int]$env:RUN_COUNT + 1

Write-Host "Run count: $env:RUN_COUNT (last run: $env:LAST_RUN_TIME)"

# BAD: PS-003 — Another module installation
if (-not (Get-Module -ListAvailable -Name Az.Monitor)) {
    Install-Module -Name Az.Monitor -Force -AllowClobber -Scope CurrentUser
}

# BAD: CQ-002 — Using $global: for state (shared within worker, not across instances)
$global:ProcessedCount = ($global:ProcessedCount ?? 0) + 1

# Actual timer work
$data = Invoke-RestMethod -Uri "https://api.example.com/health"
Write-Host "Health check result: $($data.status)"
