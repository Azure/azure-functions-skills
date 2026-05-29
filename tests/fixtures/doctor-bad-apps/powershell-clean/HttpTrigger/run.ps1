using namespace System.Net

param($Request, $TriggerMetadata)

Write-Host "PowerShell HTTP trigger function processed a request."

$name = $Request.Query.Name
if (-not $name) { $name = "World" }

Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
    StatusCode = [HttpStatusCode]::OK
    Body       = "Hello, $name!"
})
