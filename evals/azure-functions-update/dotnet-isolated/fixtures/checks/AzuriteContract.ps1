#Requires -Version 7.2

function Invoke-AzuriteRequest {
    param(
        [ValidateSet('blob', 'queue')][string]$Service,
        [ValidateSet('GET', 'PUT', 'POST', 'DELETE')][string]$Method,
        [string]$Resource,
        [string]$Body = '',
        [switch]$BlockBlob,
        [string]$Date = [DateTime]::UtcNow.ToString('R')
    )
    if ($Resource -notmatch '^[a-z0-9/-]+(?:\.txt)?(?:\?restype=container)?$') {
        throw "Invalid emulator resource path: $Resource"
    }
    $port = $Service -eq 'blob' ? 10000 : 10001
    $uri = [uri]"http://127.0.0.1:$port/devstoreaccount1/$Resource"
    $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
    $headers = @{ 'x-ms-date' = $Date; 'x-ms-version' = '2021-12-02' }
    if ($BlockBlob) { $headers['x-ms-blob-type'] = 'BlockBlob' }
    $canonicalHeaders = (@($headers.Keys | Sort-Object | ForEach-Object { "$($_):$($headers[$_])" }) -join "`n") + "`n"
    $canonicalResource = "/devstoreaccount1$($uri.AbsolutePath)"
    if ($uri.Query) { $canonicalResource += "`nrestype:container" }
    $length = $bytes.Length -gt 0 ? [string]$bytes.Length : ''
    $toSign = @($Method, '', '', $length, '', 'application/octet-stream', '', '', '', '', '', '',
        "$canonicalHeaders$canonicalResource") -join "`n"
    # Public emulator key, not a credential for Azure. Endpoints cannot be overridden.
    $key = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
    $hmac = [Security.Cryptography.HMACSHA256]::new([Convert]::FromBase64String($key))
    try {
        $signature = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($toSign)))
    } finally { $hmac.Dispose() }
    $headers.Authorization = "SharedKey devstoreaccount1:$signature"
    $arguments = @{
        Uri = $uri.AbsoluteUri; Method = $Method; Headers = $headers
        ContentType = 'application/octet-stream'; TimeoutSec = 5
        NoProxy = $true; MaximumRedirection = 0; SkipHttpErrorCheck = $true
    }
    if ($bytes.Length -gt 0) { $arguments.Body = $bytes }
    Invoke-WebRequest @arguments
}

function Initialize-StorageCase {
    param($Contract, [Collections.Generic.List[object]]$Owned)
    $resources = @(
        @{ service = 'queue'; resource = [string]$Contract.queue },
        @{ service = 'blob'; resource = "$($Contract.inputContainer)?restype=container" },
        @{ service = 'blob'; resource = "$($Contract.outputContainer)?restype=container" }
    )
    foreach ($resource in $resources) {
        $response = Invoke-AzuriteRequest -Service $resource.service -Method PUT -Resource $resource.resource
        if ($response.StatusCode -in @(204, 409)) {
            throw [InvalidOperationException]::new("Emulator resource '$($resource.resource)' already exists. Use an empty dedicated emulator.")
        }
        if ($response.StatusCode -ne 201) {
            throw [InvalidOperationException]::new("Cannot create emulator resource '$($resource.resource)': HTTP $($response.StatusCode).")
        }
        $Owned.Add($resource)
    }
}

function Send-StorageInput {
    param($Contract, [string]$RequestId)
    $input = Invoke-AzuriteRequest -Service blob -Method PUT -BlockBlob `
        -Resource "$($Contract.inputContainer)/$RequestId.txt" -Body $Contract.input
    if ($input.StatusCode -ne 201) { throw "Input blob creation failed: HTTP $($input.StatusCode)." }
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($RequestId))
    $message = "<QueueMessage><MessageText>$encoded</MessageText></QueueMessage>"
    $sent = Invoke-AzuriteRequest -Service queue -Method POST -Resource "$($Contract.queue)/messages" -Body $message
    if ($sent.StatusCode -ne 201) { throw "Queue send failed: HTTP $($sent.StatusCode)." }
}

function Read-StorageOutput {
    param($Contract, [string]$RequestId)
    $response = Invoke-AzuriteRequest -Service blob -Method GET -Resource "$($Contract.outputContainer)/$RequestId.txt"
    if ($response.StatusCode -eq 404) {
        return @{ ready = $false; matches = $false; body = '' }
    }
    if ($response.StatusCode -ne 200) { throw "Output blob read failed: HTTP $($response.StatusCode)." }
    $body = $response.Content -is [byte[]] ? [Text.Encoding]::UTF8.GetString($response.Content) : [string]$response.Content
    return @{ ready = $true; matches = $body -ceq [string]$Contract.output; body = $body }
}

function Remove-StorageCase {
    param([Collections.Generic.List[object]]$Owned)
    $failures = [Collections.Generic.List[string]]::new()
    foreach ($resource in $Owned) {
        try {
            $response = Invoke-AzuriteRequest -Service $resource.service -Method DELETE -Resource $resource.resource
            if ($response.StatusCode -notin @(202, 204, 404)) {
                $failures.Add("$($resource.resource): HTTP $($response.StatusCode)")
            }
        } catch [System.Net.Http.HttpRequestException] {
            $failures.Add("$($resource.resource): $($_.Exception.Message)")
        }
    }
    if ($failures.Count) { throw "Emulator cleanup failed: $($failures -join '; ')" }
}
