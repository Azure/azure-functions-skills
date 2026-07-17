#!/bin/bash

# Telemetry tracking hook for Azure Functions Skills
# Reads hook JSON from stdin, tracks Azure Functions skill usage, and publishes via Azure MCP plugin telemetry.

set +e

if [ "${AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY}" = "false" ] || [ "${AZURE_MCP_COLLECT_TELEMETRY}" = "false" ]; then
    echo '{"continue":true}'
    exit 0
fi

return_success() {
    echo '{"continue":true}'
    exit 0
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_path="${script_dir}/../telemetry.config.json"
if [ -f "$config_path" ] && grep -Eq '"enabled"[[:space:]]*:[[:space:]]*false' "$config_path"; then
    echo '{"continue":true}'
    exit 0
fi

extract_json_field() {
    local json="$1"
    local field="$2"
    echo "$json" | sed -n "s/.*\"$field\":[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

extract_toolargs_field() {
    local json="$1"
    local field="$2"
    local value=""
    value=$(echo "$json" | sed -n "s/.*\"toolArgs\":[[:space:]]*{[^}]*\"$field\":[[:space:]]*\"\([^\"]*\)\".*/\1/p")
    if [ -z "$value" ]; then
        value=$(echo "$json" | sed -n "s/.*\"tool_input\":[[:space:]]*{[^}]*\"$field\":[[:space:]]*\"\([^\"]*\)\".*/\1/p")
    fi
    echo "$value"
}

extract_toolargs_path() {
    local json="$1"
    local path_value=""

    path_value=$(echo "$json" | sed -n 's/.*"toolArgs":[[:space:]]*{[^}]*"path":[[:space:]]*"\([^"]*\)".*/\1/p')
    if [ -z "$path_value" ]; then
        path_value=$(echo "$json" | sed -n 's/.*"toolArgs":[[:space:]]*{[^}]*"filePath":[[:space:]]*"\([^"]*\)".*/\1/p')
    fi
    if [ -z "$path_value" ]; then
        path_value=$(echo "$json" | sed -n 's/.*"tool_input":[[:space:]]*{[^}]*"filePath":[[:space:]]*"\([^"]*\)".*/\1/p')
    fi
    if [ -z "$path_value" ]; then
        path_value=$(echo "$json" | sed -n 's/.*"tool_input":[[:space:]]*{[^}]*"file_path":[[:space:]]*"\([^"]*\)".*/\1/p')
    fi
    if [ -z "$path_value" ]; then
        path_value=$(echo "$json" | sed -n 's/.*"tool_input":[[:space:]]*{[^}]*"path":[[:space:]]*"\([^"]*\)".*/\1/p')
    fi

    echo "$path_value"
}

configure_appinsights() {
    local config_path
    local instrumentation_key
    if [ ! -f "$config_path" ]; then
        return
    fi

    instrumentation_key=$(sed -n 's/.*"applicationInsightsInstrumentationKey":[[:space:]]*"\([^"]*\)".*/\1/p' "$config_path")
    if [ -n "$instrumentation_key" ] && [ "$instrumentation_key" != "__APPLICATIONINSIGHTS_INSTRUMENTATION_KEY__" ]; then
        export APPLICATIONINSIGHTS_INSTRUMENTATION_KEY="$instrumentation_key"
        export APPINSIGHTS_INSTRUMENTATIONKEY="$instrumentation_key"
    fi
}

is_functions_skill_name() {
    [[ "$1" == azure-functions-* ]]
}

is_functions_skills_path() {
    local p="$1"
    [[ "$p" == *".copilot/installed-plugins/azure-functions-skills/"* ]] && return 0
    [[ "$p" == *".claude/plugins/cache/azure-functions-skills/"* ]] && return 0
    [[ "$p" == *"agent-plugins/github.com/azure/azure-functions-skills/.github/plugins/azure-functions-skills/skills/"* ]] && return 0
    [[ "$p" == *"agent-plugins/github.com/microsoft/azure-functions-skills/.github/plugins/azure-functions-skills/skills/"* ]] && return 0
    [[ "$p" == *".github/skills/azure-functions-"* ]] && return 0
    [[ "$p" == *".claude/skills/azure-functions-"* ]] && return 0
    [[ "$p" == *".agents/skills/azure-functions-"* ]] && return 0
    return 1
}

extract_functions_relative_path() {
    local p="$1"
    local normalized
    normalized=$(echo "$p" | tr '\\' '/' | sed 's|//*|/|g')

    if [[ "$normalized" =~ azure-functions-skills/(azure-functions-skills/)?([0-9]+\.[0-9]+\.[0-9][^/]*/)?skills/(.+)$ ]]; then
        echo "${BASH_REMATCH[3]}"
        return
    fi
    if [[ "$normalized" =~ azure-functions-skills/skills/(.+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi
    if [[ "$normalized" =~ \.agents/skills/(azure-functions-.+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi
    if [[ "$normalized" =~ \.github/skills/(azure-functions-.+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi
    if [[ "$normalized" =~ \.claude/skills/(azure-functions-.+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi
}

if [ -t 0 ]; then
    return_success
fi

rawInput=$(cat)
if [ -z "$rawInput" ]; then
    return_success
fi

toolName=$(extract_json_field "$rawInput" "toolName")
sessionId=$(extract_json_field "$rawInput" "sessionId")

if [ -z "$toolName" ]; then
    toolName=$(extract_json_field "$rawInput" "tool_name")
fi
if [ -z "$sessionId" ]; then
    sessionId=$(extract_json_field "$rawInput" "session_id")
fi

timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ "$COPILOT_CLI" = "1" ]; then
    clientName="copilot-cli"
elif echo "$rawInput" | grep -q '"hook_event_name"'; then
    toolUseId=$(extract_json_field "$rawInput" "tool_use_id")
    transcriptPath=$(extract_json_field "$rawInput" "transcript_path")
    transcriptPathNorm=$(echo "$transcriptPath" | tr '\\' '/')
    if [[ "$toolUseId" == *"__vscode"* ]] || [[ "$transcriptPathNorm" == */Code/* ]] || [[ "$transcriptPathNorm" == */Code\ -\ Insiders/* ]]; then
        if [[ "$transcriptPathNorm" == */Code\ -\ Insiders/* ]]; then
            clientName="Visual Studio Code - Insiders"
        else
            clientName="Visual Studio Code"
        fi
    else
        clientName="claude-code"
    fi
elif echo "$rawInput" | grep -q '"toolArgs"'; then
    clientName="copilot-cli"
else
    clientName="unknown"
fi

if [ -z "$toolName" ]; then
    return_success
fi

shouldTrack=false
eventType=""
skillName=""
azureToolName=""
filePath=""

if [ "$toolName" = "skill" ] || [ "$toolName" = "Skill" ]; then
    skillName=$(extract_toolargs_field "$rawInput" "skill")
    skillName="${skillName##*:}"
    if is_functions_skill_name "$skillName"; then
        eventType="skill_invocation"
        shouldTrack=true
    else
        skillName=""
    fi
fi

if [ "$toolName" = "view" ] || [ "$toolName" = "Read" ] || [ "$toolName" = "read_file" ]; then
    pathToCheck=$(extract_toolargs_path "$rawInput")
    if [ -n "$pathToCheck" ]; then
        pathLower=$(echo "$pathToCheck" | tr '[:upper:]' '[:lower:]' | tr '\\' '/' | sed 's|//*|/|g')
        if is_functions_skills_path "$pathLower" && [[ "$pathLower" == *"/skill.md" ]]; then
            relativePath=$(extract_functions_relative_path "$pathToCheck")
            if [[ "$relativePath" =~ ^(azure-functions-[^/]+)/SKILL\.md$ ]]; then
                skillName="${BASH_REMATCH[1]}"
                eventType="skill_invocation"
                shouldTrack=true
            fi
        fi
    fi
fi

if [ -n "$toolName" ]; then
    if [[ "$toolName" == functions_* ]] || [[ "$toolName" == azure-functions* ]] || [[ "$toolName" == mcp__plugin_azure_azure__functions_* ]] || [[ "$toolName" == mcp_azure_mcp_functions_* ]]; then
        azureToolName="$toolName"
        eventType="tool_invocation"
        shouldTrack=true
    fi
fi

if [ -z "$filePath" ] && [ -z "$skillName" ]; then
    pathToCheck=$(extract_toolargs_path "$rawInput")
    if [ -n "$pathToCheck" ]; then
        pathLower=$(echo "$pathToCheck" | tr '[:upper:]' '[:lower:]' | tr '\\' '/' | sed 's|//*|/|g')
        if is_functions_skills_path "$pathLower"; then
            filePath=$(extract_functions_relative_path "$pathToCheck")
            if [ -n "$filePath" ]; then
                eventType="reference_file_read"
                shouldTrack=true
            fi
        fi
    fi
fi

if [ "$shouldTrack" = true ]; then
    configure_appinsights

    mcpArgs=(
        "server" "plugin-telemetry"
        "--timestamp" "$timestamp"
        "--client-name" "$clientName"
        "--plugin-name" "azure-functions-skills"
    )

    [ -n "$eventType" ] && mcpArgs+=("--event-type" "$eventType")
    [ -n "$sessionId" ] && mcpArgs+=("--session-id" "$sessionId")
    [ -n "$skillName" ] && mcpArgs+=("--skill-name" "$skillName")
    [ -n "$azureToolName" ] && mcpArgs+=("--tool-name" "$azureToolName")
    [ -n "$filePath" ] && mcpArgs+=("--file-reference" "$(echo "$filePath" | tr '/' '\\')")

    npx -y @azure/mcp@latest "${mcpArgs[@]}" >/dev/null 2>&1 || true
fi

return_success
