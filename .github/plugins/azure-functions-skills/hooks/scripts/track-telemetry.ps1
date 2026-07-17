# Telemetry tracking hook for Azure Functions Skills
# Reads hook JSON from stdin, tracks Azure Functions skill usage, and publishes via Azure MCP plugin telemetry.

$ErrorActionPreference = "SilentlyContinue"

if ($env:AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY -eq "false" -or $env:AZURE_MCP_COLLECT_TELEMETRY -eq "false") {
    Write-Output '{"continue":true}'
    exit 0
}

$telemetryConfigPath = Join-Path $PSScriptRoot "..\telemetry.config.json"
if (Test-Path $telemetryConfigPath) {
    try {
        $telemetryConfig = Get-Content -Raw -Path $telemetryConfigPath | ConvertFrom-Json
        if ($telemetryConfig.enabled -eq $false) {
            Write-Output '{"continue":true}'
            exit 0
        }
    } catch {
        # Continue with the default when an optional local preference cannot be read.
    }
}

function Write-Success {
    Write-Output '{"continue":true}'
    exit 0
}

function Set-AppInsightsEnvironment {
    if (-not (Test-Path $telemetryConfigPath)) {
        return
    }

    try {
        $config = Get-Content -Raw -Path $telemetryConfigPath | ConvertFrom-Json
        $instrumentationKey = $config.applicationInsightsInstrumentationKey
        if ($instrumentationKey -and $instrumentationKey -ne "__APPLICATIONINSIGHTS_INSTRUMENTATION_KEY__") {
            $env:APPLICATIONINSIGHTS_INSTRUMENTATION_KEY = $instrumentationKey
            $env:APPINSIGHTS_INSTRUMENTATIONKEY = $instrumentationKey
        }
    } catch {
        return
    }
}

try {
    $rawInput = [Console]::In.ReadToEnd()
} catch {
    Write-Success
}

if ([string]::IsNullOrWhiteSpace($rawInput)) {
    Write-Success
}

try {
    $inputData = $rawInput | ConvertFrom-Json
} catch {
    Write-Success
}

$toolName = $inputData.toolName
if (-not $toolName) {
    $toolName = $inputData.tool_name
}

$sessionId = $inputData.sessionId
if (-not $sessionId) {
    $sessionId = $inputData.session_id
}

$toolInput = $inputData.toolArgs
if (-not $toolInput) {
    $toolInput = $inputData.tool_input
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$hasHookEventName = $inputData.PSObject.Properties.Name -contains "hook_event_name"
$hasToolArgs = $inputData.PSObject.Properties.Name -contains "toolArgs"
$toolUseId = $inputData.tool_use_id
$transcriptPath = $inputData.transcript_path
$isVscodeToolUseId = $toolUseId -and ($toolUseId -match '__vscode')
$isVscodeTranscript = $transcriptPath -and ($transcriptPath -match '[/\\]Code( - Insiders)?[/\\]')

if ($env:COPILOT_CLI -eq "1") {
    $clientName = "copilot-cli"
} elseif ($hasHookEventName -and ($isVscodeToolUseId -or $isVscodeTranscript)) {
    if ($transcriptPath -match '[/\\]Code - Insiders[/\\]') {
        $clientName = "Visual Studio Code - Insiders"
    } else {
        $clientName = "Visual Studio Code"
    }
} elseif ($hasHookEventName) {
    $clientName = "claude-code"
} elseif ($hasToolArgs) {
    $clientName = "copilot-cli"
} else {
    $clientName = "unknown"
}

if (-not $toolName) {
    Write-Success
}

function Get-ToolInputPath {
    if ($toolInput.path) { return $toolInput.path }
    if ($toolInput.filePath) { return $toolInput.filePath }
    if ($toolInput.file_path) { return $toolInput.file_path }
    return $null
}

function Test-FunctionsSkillName {
    param([string] $Name)
    return $Name -and $Name.StartsWith("azure-functions-")
}

function Test-FunctionsSkillsPath {
    param([string] $Path)
    return $Path -match '\.copilot/installed-plugins/azure-functions-skills/' -or
        $Path -match '\.claude/plugins/cache/azure-functions-skills/' -or
        $Path -match 'agent-plugins/github\.com/azure/azure-functions-skills/\.github/plugins/azure-functions-skills/skills/' -or
        $Path -match 'agent-plugins/github\.com/microsoft/azure-functions-skills/\.github/plugins/azure-functions-skills/skills/' -or
        $Path -match '\.github/skills/azure-functions-' -or
        $Path -match '\.claude/skills/azure-functions-' -or
        $Path -match '\.agents/skills/azure-functions-'
}

function Get-FunctionsSkillRelativePath {
    param([string] $Path)
    $normalized = $Path -replace '\\', '/' -replace '/+', '/'
    if ($normalized -match 'azure-functions-skills/(?:azure-functions-skills/)?(?:[0-9]+\.[0-9]+\.[0-9][^/]*/)?skills/(.+)$') {
        return $Matches[1]
    }
    if ($normalized -match 'azure-functions-skills/skills/(.+)$') {
        return $Matches[1]
    }
    if ($normalized -match '\.agents/skills/(azure-functions-.+)$') {
        return $Matches[1]
    }
    if ($normalized -match '\.github/skills/(azure-functions-.+)$') {
        return $Matches[1]
    }
    if ($normalized -match '\.claude/skills/(azure-functions-.+)$') {
        return $Matches[1]
    }
    return $null
}

$shouldTrack = $false
$eventType = $null
$skillName = $null
$azureToolName = $null
$filePath = $null

if ($toolName -eq "skill" -or $toolName -eq "Skill") {
    $skillName = $toolInput.skill
    if ($skillName -and $skillName.Contains(":")) {
        $skillName = $skillName.Substring($skillName.LastIndexOf(":") + 1)
    }
    if (Test-FunctionsSkillName $skillName) {
        $eventType = "skill_invocation"
        $shouldTrack = $true
    } else {
        $skillName = $null
    }
}

if ($toolName -eq "view" -or $toolName -eq "Read" -or $toolName -eq "read_file") {
    $pathToCheck = Get-ToolInputPath
    if ($pathToCheck) {
        $pathLower = $pathToCheck.ToLower() -replace '\\', '/' -replace '/+', '/'
        if ((Test-FunctionsSkillsPath $pathLower) -and $pathLower.EndsWith("/skill.md")) {
            $relativePath = Get-FunctionsSkillRelativePath $pathToCheck
            if ($relativePath -and $relativePath -match '^(azure-functions-[^/]+)/SKILL\.md$') {
                $skillName = $Matches[1]
                $eventType = "skill_invocation"
                $shouldTrack = $true
            }
        }
    }
}

if ($toolName) {
    if ($toolName.StartsWith("functions_") -or
        $toolName.StartsWith("azure-functions") -or
        $toolName.StartsWith("mcp__plugin_azure_azure__functions_") -or
        $toolName.StartsWith("mcp_azure_mcp_functions_")) {
        $azureToolName = $toolName
        $eventType = "tool_invocation"
        $shouldTrack = $true
    }
}

if (-not $filePath -and -not $skillName) {
    $pathToCheck = Get-ToolInputPath
    if ($pathToCheck) {
        $pathLower = $pathToCheck.ToLower() -replace '\\', '/' -replace '/+', '/'
        if (Test-FunctionsSkillsPath $pathLower) {
            $filePath = Get-FunctionsSkillRelativePath $pathToCheck
            if ($filePath) {
                $eventType = "reference_file_read"
                $shouldTrack = $true
            }
        }
    }
}

if ($shouldTrack) {
    Set-AppInsightsEnvironment

    $mcpArgs = @(
        "server", "plugin-telemetry",
        "--timestamp", $timestamp,
        "--client-name", $clientName,
        "--plugin-name", "azure-functions-skills"
    )

    if ($eventType) { $mcpArgs += "--event-type"; $mcpArgs += $eventType }
    if ($sessionId) { $mcpArgs += "--session-id"; $mcpArgs += $sessionId }
    if ($skillName) { $mcpArgs += "--skill-name"; $mcpArgs += $skillName }
    if ($azureToolName) { $mcpArgs += "--tool-name"; $mcpArgs += $azureToolName }
    if ($filePath) { $mcpArgs += "--file-reference"; $mcpArgs += ($filePath -replace '/', '\') }

    try {
        & npx -y @azure/mcp@latest @mcpArgs 2>&1 | Out-Null
    } catch { }
}

Write-Success
