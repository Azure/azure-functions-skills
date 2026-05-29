# BAD: PS-002 — Expensive operations at startup that run on EVERY cold start

# BAD: Installing modules in profile — slow and unreliable
Install-Module -Name Az.KeyVault -Force -AllowClobber -Scope CurrentUser
Install-Module -Name Az.Network -Force -AllowClobber -Scope CurrentUser

# BAD: Multiple API calls during startup
Connect-AzAccount -Identity
$vaults = Get-AzKeyVault
foreach ($vault in $vaults) {
    $secrets = Get-AzKeyVaultSecret -VaultName $vault.VaultName
    Write-Host "Loaded $($secrets.Count) secrets from $($vault.VaultName)"
}

# BAD: Large data download during profile
$configData = Invoke-RestMethod -Uri "https://api.example.com/large-config"
$env:CACHED_CONFIG = $configData | ConvertTo-Json -Depth 10
