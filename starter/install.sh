#!/bin/sh
# Azure Functions Skills starter installer (POSIX shell). Generated from
# templates/starter/engine/install.sh by `npm run build:starter`.
# Resolves the branch to one commit, downloads that archive, verifies and
# applies the selected bundle, and sends one setup event unless opted out.
set -eu

installer_engine=1
repository='Azure/azure-functions-skills'
archive_prefix='azure-functions-skills-'
branch='test/prompt-starter-e2e'
payload_path='starter'
api_base='https://api.github.com'
codeload_base='https://codeload.github.com'
telemetry_endpoint='https://westus2-2.in.applicationinsights.azure.com'
instrumentation_key='a5ea7fbd-8657-4d92-8dd1-c059329b11e8'
skills_version='0.0.7-preview'
curl_protocols='--proto =https --proto-redir =https'

ref=$branch
bundle=
template=
agent=
destination=.
check=false
json=false
no_telemetry=false

fail() {
    code=$1
    shift
    if [ "$json" = true ]; then
        message=$(printf '%s' "$*" | sed 's/\\/\\\\/g; s/"/\\"/g')
        printf '{"schemaVersion":1,"ready":false,"error":{"code":"%s","message":"%s"}}\n' "$code" "$message"
    else
        printf 'Starter setup failed (%s): %s\n' "$code" "$*" >&2
    fi
    exit 2
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --ref|--bundle|--template|--agent|--destination)
            [ "$#" -ge 2 ] || fail invalid-argument "Missing value for $1"
            case "$1" in
                --ref) ref=$2 ;;
                --bundle) bundle=$2 ;;
                --template) template=$2 ;;
                --agent) agent=$2 ;;
                --destination) destination=$2 ;;
            esac
            shift 2 ;;
        --check) check=true; shift ;;
        --json) json=true; shift ;;
        --no-telemetry) no_telemetry=true; shift ;;
        *) fail invalid-argument "Unknown argument: $1" ;;
    esac
done
if [ "$ref" != "$branch" ]; then
    [ "${#ref}" -eq 40 ] || fail invalid-argument "--ref must be $branch or a full lowercase commit SHA."
    case "$ref" in *[!0-9a-f]*) fail invalid-argument "--ref must be $branch or a full lowercase commit SHA." ;; esac
fi
case "$agent" in copilot|claude|codex) ;; *) fail invalid-argument 'Specify --agent copilot, claude, or codex.' ;; esac
case "$bundle" in ''|*[!a-z0-9-]*) fail invalid-argument 'Specify --bundle with a bundle name.' ;; esac
case "$template" in *[!a-z0-9-]*) fail invalid-argument "Invalid template name: $template" ;; esac
for tool in curl tar mktemp rm sh awk sed date uname tr grep; do
    command -v "$tool" >/dev/null 2>&1 || fail invalid-argument "Required OS utility missing: $tool"
done

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
trap 'exit 2' HUP INT TERM

commit=$ref
if [ "$ref" = "$branch" ]; then
    # shellcheck disable=SC2086
    status=$(curl --silent --show-error --location $curl_protocols --connect-timeout 15 --max-time 30 \
        -H 'Accept: application/vnd.github.sha' -o "$temporary/commit" -w '%{http_code}' \
        "$api_base/repos/$repository/commits/$branch" 2>/dev/null) || status=000
    case "$status" in
        200) ;;
        403|429) fail rate-limited 'GitHub refused the commit lookup (rate limit). Retry later, or pin a full commit SHA with --ref.' ;;
        *) fail resolve-failed "Cannot resolve $branch to a commit (HTTP $status). No fallback source was used." ;;
    esac
    commit=$(tr -d ' \r\n' < "$temporary/commit")
    [ "${#commit}" -eq 40 ] || fail resolve-failed 'GitHub returned an invalid commit SHA.'
    case "$commit" in *[!0-9a-f]*) fail resolve-failed 'GitHub returned an invalid commit SHA.' ;; esac
fi

# shellcheck disable=SC2086
curl --fail --silent --show-error --location $curl_protocols --connect-timeout 15 --max-time 180 \
    "$codeload_base/$repository/tar.gz/$commit" -o "$temporary/starter.tar.gz" 2>/dev/null ||
    fail download-failed 'Cannot download the starter archive. Check HTTPS access to GitHub.'
tar -xzf "$temporary/starter.tar.gz" -C "$temporary" "$archive_prefix$commit/$payload_path" 2>/dev/null ||
    fail download-failed 'The starter archive is incomplete.'
source_root=$temporary/$archive_prefix$commit/$payload_path
required=$(tr -d ' \r\n' < "$source_root/engine-version" 2>/dev/null) || required=
case "$required" in ''|*[!0-9]*) fail engine-mismatch 'The starter archive has no engine version.' ;; esac
[ "$required" -le "$installer_engine" ] ||
    fail engine-mismatch 'This installer is older than the starter payload. Retry in a few minutes.'

set -- --source "$source_root" --bundle "$bundle" --agent "$agent" --destination "$destination" \
    --commit "$commit" --result-file "$temporary/result"
[ -z "$template" ] || set -- "$@" --template "$template"
[ "$check" = false ] || set -- "$@" --check
[ "$json" = false ] || set -- "$@" --json
[ "$no_telemetry" = false ] || set -- "$@" --no-telemetry
status=0
sh "$source_root/bootstrap.sh" "$@" || status=$?

# Setup event: bootstrap decides after every opt-out check. One request,
# no retry, result ignored, never changes the exit code.
if [ "$status" -eq 0 ] && [ "$no_telemetry" = false ] && [ -f "$temporary/result" ] &&
    grep -q '^send=1$' "$temporary/result"; then
    os=$(awk -F = '$1 == "os" { print $2 }' "$temporary/result")
    case "$agent" in copilot) client=copilot-cli ;; claude) client=claude-code ;; *) client=codex ;; esac
    body=$(printf '{"name":"Microsoft.ApplicationInsights.Event","time":"%s","iKey":"%s","data":{"baseType":"EventData","baseData":{"ver":2,"name":"AzureFunctionsSkillsStarterSetup","properties":{"distribution":"starter","bundle":"%s","template":"%s","agent":"%s","os":"%s","skillsVersion":"%s"}}}}' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$instrumentation_key" "$bundle" "${template:-none}" "$client" "$os" "$skills_version")
    # shellcheck disable=SC2086
    curl --silent $curl_protocols --max-time 5 -o /dev/null -H 'Content-Type: application/json' \
        --data "$body" "$telemetry_endpoint/v2/track" >/dev/null 2>&1 || true
fi
exit "$status"
