using namespace System.Net

param($Request, $TriggerMetadata)

# BAD: CQ-002 — Using $global: hash table as shared business state
# This works within a single worker instance but fails with scale-out
if (-not $global:UserCache) {
    $global:UserCache = @{}
}

$userId = $Request.Query.UserId
if ($userId) {
    if ($global:UserCache.ContainsKey($userId)) {
        $userData = $global:UserCache[$userId]
        Write-Host "Cache hit for user $userId"
    } else {
        # BAD: CQ-007 — No error handling around external call
        $userData = Invoke-RestMethod -Uri "https://api.example.com/users/$userId"
        $global:UserCache[$userId] = $userData
        Write-Host "Cached user $userId"
    }

    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = [HttpStatusCode]::OK
        Body       = ($userData | ConvertTo-Json)
    })
} else {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = [HttpStatusCode]::BadRequest
        Body       = "Please provide a userId"
    })
}
