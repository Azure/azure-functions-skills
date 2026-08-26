#!/bin/bash

# Telemetry tracking hook for Azure Functions Skills
# Reads hook JSON from stdin and publishes sanitized Azure Functions skill usage.

set +e

package_version="__PACKAGE_VERSION__"
debug_enabled=false
[ "$(printf '%s' "${AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG}" | tr '[:upper:]' '[:lower:]')" = "true" ] && debug_enabled=true

write_debug() {
    [ "$debug_enabled" = true ] || return
    DEBUG_ACTION="$1" DEBUG_STATUS="$2" DEBUG_REASON="$3" DEBUG_REGISTRY="$4" \
        DEBUG_EXIT_CODE="$5" DEBUG_EVENT="$6" \
        AZURE_FUNCTIONS_SKILLS_PACKAGE_VERSION="$package_version" node --input-type=module -e '
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
try {
  const directory = process.env.AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR || join(tmpdir(), "azure-functions-skills-telemetry");
  const path = join(directory, "telemetry-debug.jsonl");
  const backup = `${path}.1`;
  const record = {
    timestamp: new Date().toISOString(),
    component: "hook",
    action: process.env.DEBUG_ACTION,
    status: process.env.DEBUG_STATUS,
    packageVersion: process.env.AZURE_FUNCTIONS_SKILLS_PACKAGE_VERSION,
  };
  if (process.env.DEBUG_REASON) record.reason = process.env.DEBUG_REASON;
  if (process.env.DEBUG_REGISTRY) record.registryUrl = process.env.DEBUG_REGISTRY;
  if (process.env.DEBUG_EXIT_CODE) record.npxExitCode = Number.parseInt(process.env.DEBUG_EXIT_CODE, 10);
  if (process.env.DEBUG_EVENT) record.event = JSON.parse(process.env.DEBUG_EVENT);
  const line = `${JSON.stringify(record)}\n`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > 1024 * 1024) {
    rmSync(backup, { force: true });
    renameSync(path, backup);
  }
  appendFileSync(path, line, { mode: 0o600 });
} catch {}
' >/dev/null 2>&1
}

safe_registry_url() {
    local registry
    registry=$(npm config get registry 2>/dev/null)
    REGISTRY_VALUE="$registry" node --input-type=module -e '
try {
  const url = new URL(process.env.REGISTRY_VALUE);
  if (url.protocol !== "https:" && url.protocol !== "http:") process.exit(1);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  process.stdout.write(url.toString());
} catch {}
' 2>/dev/null
}

write_debug "start" "started" "" "" "" ""

if [ "${AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY}" = "false" ] || [ "${AZURE_MCP_COLLECT_TELEMETRY}" = "false" ]; then
    write_debug "decision" "skipped" "disabled" "" "" ""
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
    write_debug "decision" "skipped" "disabled" "" "" ""
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

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

if [ -t 0 ]; then
    return_success
fi

rawInput=$(cat)
if [ -z "$rawInput" ]; then
    write_debug "decision" "skipped" "invalid-input" "" "" ""
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
    write_debug "decision" "skipped" "no-tool-name" "" "" ""
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
    if [ -r /proc/sys/kernel/random/uuid ]; then
        correlationId=$(cat /proc/sys/kernel/random/uuid 2>/dev/null)
    elif command -v uuidgen >/dev/null 2>&1; then
        correlationId=$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]')
    else
        correlationId=$(node --input-type=module -e 'import { randomUUID } from "node:crypto"; console.log(randomUUID())' 2>/dev/null)
    fi
    payload=$(printf \
        '{"timestamp":"%s","eventType":"%s","clientName":"%s","pluginName":"azure-functions-skills","pluginVersion":"%s"}' \
        "$(json_escape "$timestamp")" \
        "$(json_escape "$eventType")" \
        "$(json_escape "$clientName")" \
        "$(json_escape "$package_version")")
    if [ -n "$correlationId" ]; then
        payload="${payload%?},\"correlationId\":\"$(json_escape "$correlationId")\"}"
    fi
    if [ -n "$sessionId" ]; then
        payload="${payload%?},\"sessionId\":\"$(json_escape "$sessionId")\"}"
    fi
    if [ -n "$skillName" ]; then
        payload="${payload%?},\"skillName\":\"$(json_escape "$skillName")\"}"
    fi
    if [ -n "$azureToolName" ]; then
        payload="${payload%?},\"toolName\":\"$(json_escape "$azureToolName")\"}"
    fi
    if [ -n "$filePath" ]; then
        payload="${payload%?},\"fileReference\":\"$(json_escape "$(echo "$filePath" | tr '/' '\\')")\"}"
    fi

    registryUrl=""
    if [ "$debug_enabled" = true ]; then
        registryUrl=$(safe_registry_url)
        write_debug "decision" "tracked" "" "$registryUrl" "" "$payload"
        npm view "@azure/functions-skills@__PACKAGE_VERSION__" version >/dev/null 2>&1
        if [ "$?" -eq 0 ]; then
            write_debug "package-resolution" "resolved" "" "$registryUrl" "" ""
        else
            write_debug "package-resolution" "failed" "npm-resolution" "$registryUrl" "" ""
        fi
    fi
    printf '%s' "$payload" |
        npx -y "@azure/functions-skills@__PACKAGE_VERSION__" telemetry >/dev/null 2>&1
    npxExitCode=$?
    write_debug "complete" "completed" "" "$registryUrl" "$npxExitCode" ""
else
    write_debug "decision" "skipped" "filtered" "" "" ""
fi

return_success
