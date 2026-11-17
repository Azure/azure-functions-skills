# Azure Functions Skills starter installer (PowerShell). Generated from
# templates/starter/engine/install.ps1 by `npm run build:starter`.
# start.md runs it as a script block created from the downloaded text, so that
# execution policy does not apply. It never exits the caller's session. The result is in $LASTEXITCODE
# (0 ready, 1 check found missing files, 2 failure) and in the JSON report.
param(
    [string]$Ref = 'main',
    [string]$Bundle,
    [string]$Template,
    [string]$Agent,
    [string]$Destination = (Get-Location).Path,
    [switch]$Check,
    [switch]$Json,
    [switch]$NoTelemetry
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 2.0
$installerEngine = 1
$repository = 'Azure/azure-functions-skills'
$archivePrefix = 'azure-functions-skills-'
$branch = 'main'
$payloadPath = 'starter'
$apiBase = 'https://api.github.com'
$codeloadBase = 'https://codeload.github.com'
$telemetryEndpoint = 'https://westus2-2.in.applicationinsights.azure.com'
$instrumentationKey = 'a5ea7fbd-8657-4d92-8dd1-c059329b11e8'
$skillsVersion = '0.0.7-preview'

function Stop-Installer([string]$Code, [string]$Message) { throw "afs-error|$Code|$Message" }

function Get-StatusCode($ErrorRecord) {
    $response = $null
    try { $response = $ErrorRecord.Exception.Response } catch { }
    if ($null -eq $response) { return 0 }
    try { return [int]$response.StatusCode } catch { return 0 }
}

$exitCode = 2
$temporary = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'afs' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    if ($Ref -cne $branch -and $Ref -cnotmatch '^[0-9a-f]{40}$') { Stop-Installer 'invalid-argument' "-Ref must be $branch or a full lowercase commit SHA." }
    if ($Agent -notin @('copilot', 'claude', 'codex')) { Stop-Installer 'invalid-argument' 'Specify -Agent copilot, claude, or codex.' }
    if ($Bundle -cnotmatch '^[a-z][a-z0-9-]{0,40}$') { Stop-Installer 'invalid-argument' 'Specify -Bundle with a bundle name.' }
    if ($Template -and $Template -cnotmatch '^[a-z][a-z0-9-]{0,40}$') { Stop-Installer 'invalid-argument' "Invalid template name: $Template" }
    $isWindowsHost = ($PSVersionTable.PSEdition -eq 'Desktop') -or [bool](Get-Variable IsWindows -ValueOnly -ErrorAction SilentlyContinue)
    if ($PSVersionTable.PSEdition -eq 'Desktop') {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }
    $null = [IO.Directory]::CreateDirectory($temporary)

    $commit = $Ref
    if ($Ref -ceq $branch) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$apiBase/repos/$repository/commits/$branch" -Headers @{ Accept = 'application/vnd.github.sha' } -TimeoutSec 30
        } catch {
            $status = Get-StatusCode $_
            if ($status -eq 403 -or $status -eq 429) {
                Stop-Installer 'rate-limited' 'GitHub refused the commit lookup (rate limit). Retry later, or pin a full commit SHA with -Ref.'
            }
            Stop-Installer 'resolve-failed' "Cannot resolve $branch to a commit (HTTP $status). No fallback source was used."
        }
        $content = $response.Content
        if ($content -is [byte[]]) { $content = [Text.Encoding]::UTF8.GetString($content) }
        $commit = ([string]$content).Trim()
        if ($commit -cnotmatch '^[0-9a-f]{40}$') { Stop-Installer 'resolve-failed' 'GitHub returned an invalid commit SHA.' }
    }

    $archive = [IO.Path]::Combine($temporary, 'starter.tar.gz')
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$codeloadBase/$repository/tar.gz/$commit" -OutFile $archive -TimeoutSec 180
    } catch {
        Stop-Installer 'download-failed' 'Cannot download the starter archive. Check HTTPS access to GitHub.'
    }
    # Windows 10 1803 and later ship bsdtar. Use it by full path so that another
    # tar on PATH cannot misread drive-letter paths.
    $tar = if ($isWindowsHost) { [IO.Path]::Combine($env:SystemRoot, 'System32', 'tar.exe') } else { 'tar' }
    $member = "$archivePrefix$commit/$payloadPath"
    $ErrorActionPreference = 'Continue'
    & $tar -xzf $archive -C $temporary $member 2>&1 | Out-Null
    $tarStatus = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($tarStatus -ne 0) { Stop-Installer 'download-failed' 'The starter archive is incomplete.' }
    $sourceRoot = [IO.Path]::Combine($temporary, "$archivePrefix$commit", $payloadPath)
    $required = 0
    $engineFile = [IO.Path]::Combine($sourceRoot, 'engine-version')
    if (-not [IO.File]::Exists($engineFile) -or -not [int]::TryParse([IO.File]::ReadAllText($engineFile).Trim(), [ref]$required)) {
        Stop-Installer 'engine-mismatch' 'The starter archive has no engine version.'
    }
    if ($required -gt $installerEngine) { Stop-Installer 'engine-mismatch' 'This installer is older than the starter payload. Retry in a few minutes.' }

    $resultFile = [IO.Path]::Combine($temporary, 'result')
    $bootstrap = [scriptblock]::Create([IO.File]::ReadAllText([IO.Path]::Combine($sourceRoot, 'bootstrap.ps1')))
    $arguments = @{
        SourceRoot = $sourceRoot; Bundle = $Bundle; Agent = $Agent; Destination = $Destination
        Commit = $commit; ResultFile = $resultFile; Check = $Check; Json = $Json; NoTelemetry = $NoTelemetry
    }
    if ($Template) { $arguments.Template = $Template }
    $output = @(& $bootstrap @arguments)
    $exitCode = 2
    if ($output.Count -gt 0) { $exitCode = [int]$output[$output.Count - 1] }

    # Setup event: bootstrap decides after every opt-out check. One request,
    # no retry, result ignored, never changes the exit code.
    if ($exitCode -eq 0 -and -not $NoTelemetry -and [IO.File]::Exists($resultFile)) {
        $result = @{}
        foreach ($line in [IO.File]::ReadAllLines($resultFile)) {
            $parts = $line.Split('=', 2)
            if ($parts.Count -eq 2) { $result[$parts[0]] = $parts[1] }
        }
        if ($result['send'] -eq '1') {
            $client = switch ($Agent) { 'copilot' { 'copilot-cli' } 'claude' { 'claude-code' } default { 'codex' } }
            $templateName = if ($Template) { $Template } else { 'none' }
            $time = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture)
            $body = '{"name":"Microsoft.ApplicationInsights.Event","time":"' + $time + '","iKey":"' + $instrumentationKey +
                '","data":{"baseType":"EventData","baseData":{"ver":2,"name":"AzureFunctionsSkillsStarterSetup","properties":{"distribution":"starter","bundle":"' +
                $Bundle + '","template":"' + $templateName + '","agent":"' + $client + '","os":"' + $result['os'] + '","skillsVersion":"' + $skillsVersion + '"}}}}'
            try {
                $null = Invoke-RestMethod -Method Post -Uri "$telemetryEndpoint/v2/track" -ContentType 'application/json' -Body $body -TimeoutSec 5
            } catch { }
        }
    }
} catch {
    $text = [string]$_.Exception.Message
    if ($text -match '^afs-error\|([a-z-]+)\|(.*)$') { $code = $Matches[1]; $message = $Matches[2] }
    else { $code = 'download-failed'; $message = $text }
    if ($Json) {
        $escaped = $message.Replace('\', '\\').Replace('"', '\"')
        [Console]::Out.WriteLine('{"schemaVersion":1,"ready":false,"error":{"code":"' + $code + '","message":"' + $escaped + '"}}')
    } else {
        [Console]::Error.WriteLine("Starter setup failed ($code): $message")
    }
    $exitCode = 2
} finally {
    if ([IO.Directory]::Exists($temporary)) {
        try { [IO.Directory]::Delete($temporary, $true) } catch { }
    }
}
$global:LASTEXITCODE = $exitCode
