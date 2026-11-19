#!/bin/sh
# Azure Functions Skills starter bootstrap (POSIX shell).
# Verifies the starter payload, computes file states, creates missing files,
# inventories tools, and prints one report. It never overwrites a file.
set -eu

source_root=
bundle=
template=
agent=
destination=.
check=false
json=false
no_telemetry=false
commit=local
result_file=

hook_marker='.azure-functions-skills/runtime/telemetry.mjs'
state_dir='.azure-functions-skills'
preference_path='.azure-functions-skills/telemetry.config.json'

json_escape() {
    LC_ALL=C awk 'BEGIN {ORS=""} {
        if (NR > 1) exit 1
        if ($0 ~ /[[:cntrl:]]/) exit 1
        gsub(/\\/, "\\\\")
        gsub(/"/, "\\\"")
        print
    }'
}

fail() {
    code=$1
    shift
    message=$*
    if [ "$json" = true ]; then
        escaped=$(printf '%s' "$message" | json_escape) || escaped='Unprintable error message.'
        printf '{"schemaVersion":1,"ready":false,"error":{"code":"%s","message":"%s"' "$code" "$escaped"
        if [ "$code" = conflict ] && [ -n "${work:-}" ] && [ -s "$work/conflicts" ]; then
            printf ',"files":['
            LC_ALL=C awk 'BEGIN {ORS=""} {printf "%s\"%s\"", (NR>1 ? "," : ""), $0}' "$work/conflicts"
            printf ']'
        fi
        printf '}}\n'
    else
        printf 'Starter setup failed (%s): %s\n' "$code" "$message" >&2
        if [ "$code" = conflict ] && [ -n "${work:-}" ] && [ -s "$work/conflicts" ]; then
            sed 's/^/  /' "$work/conflicts" >&2
        fi
    fi
    exit 2
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --source|--bundle|--template|--agent|--destination|--commit|--result-file)
            [ "$#" -ge 2 ] || fail invalid-argument "Missing value for $1"
            case "$1" in
                --source) source_root=$2 ;;
                --bundle) bundle=$2 ;;
                --template) template=$2 ;;
                --agent) agent=$2 ;;
                --destination) destination=$2 ;;
                --commit) commit=$2 ;;
                --result-file) result_file=$2 ;;
            esac
            shift 2 ;;
        --check) check=true; shift ;;
        --json) json=true; shift ;;
        --no-telemetry) no_telemetry=true; shift ;;
        *) fail invalid-argument "Unknown argument: $1" ;;
    esac
done

is_name() {
    case "$1" in ''|*[!a-z0-9-]*) return 1 ;; [a-z]*) [ "${#1}" -le 41 ] ;; *) return 1 ;; esac
}
is_name "$bundle" || fail invalid-argument 'Specify --bundle with a bundle name.'
case "$agent" in copilot|claude|codex) ;; *) fail invalid-argument 'Specify --agent copilot, claude, or codex.' ;; esac
[ -z "$template" ] || is_name "$template" || fail invalid-argument "Invalid template name: $template"
if [ "$commit" != local ]; then
    [ "${#commit}" -eq 40 ] || fail invalid-argument 'Invalid commit.'
    case "$commit" in *[!0-9a-f]*) fail invalid-argument 'Invalid commit.' ;; esac
fi
[ -n "$destination" ] || fail invalid-argument 'Destination must not be empty.'
for tool in awk cmp dirname mkdir mktemp cat rm mv sed sort grep uname tr ls; do
    command -v "$tool" >/dev/null 2>&1 || fail invalid-argument "Required OS utility missing: $tool"
done
if command -v sha256sum >/dev/null 2>&1; then
    hash_file() { sha256sum < "$1" | awk '{print $1}'; }
    verify_hashes() { sha256sum -c "$1" > /dev/null 2>&1; }
elif command -v shasum >/dev/null 2>&1; then
    hash_file() { shasum -a 256 < "$1" | awk '{print $1}'; }
    verify_hashes() { shasum -a 256 -c "$1" > /dev/null 2>&1; }
else
    fail invalid-argument 'SHA-256 utility missing: install sha256sum or shasum.'
fi

if [ -z "$source_root" ]; then
    source_root=$(dirname -- "$0")
fi
root=$(CDPATH= cd -- "$source_root" && pwd -P) || fail invalid-argument "Cannot open starter source: $source_root"
[ -f "$root/engine-version" ] && [ -f "$root/runtime/files.tsv" ] ||
    fail invalid-argument 'Incomplete starter payload. Use the complete starter archive.'
[ -f "$root/$bundle/files.tsv" ] || fail invalid-argument "Unknown bundle: $bundle"
template_manifest=
if [ -d "$root/$bundle/templates" ]; then
    if [ -z "$template" ]; then
        available=$(ls "$root/$bundle/templates" | tr '\n' ' ')
        fail invalid-argument "Bundle $bundle needs --template. Available: $available"
    fi
    [ -f "$root/$bundle/templates/$template/files.tsv" ] || fail invalid-argument "Unknown template: $template"
    template_manifest=$root/$bundle/templates/$template/files.tsv
elif [ -n "$template" ]; then
    fail invalid-argument "Bundle $bundle has no templates."
fi

case "$(uname -s)" in
    Darwin) os=macos ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) os=windows ;;
    *) os=linux ;;
esac

# Resolve a possibly missing destination without creating it in check mode.
case "$destination" in /*) target=$destination ;; *) target=$(pwd -P)/$destination ;; esac
target=$(printf '%s\n' "$target" | awk -F / '{
    n=0
    for (i=1;i<=NF;i++) {
        if ($i=="" || $i==".") continue
        if ($i=="..") { if (n>0) n--; continue }
        a[++n]=$i
    }
    printf "/"
    for (i=1;i<=n;i++) printf "%s%s", a[i], (i<n ? "/" : "")
}')
printf '%s' "$target" | LC_ALL=C awk '/[[:cntrl:]]/ {exit 1}' || fail invalid-argument 'Control character in destination.'
[ ! -f "$target" ] || fail invalid-argument "Destination is a file: $target"
parent=$target
suffix=
while [ ! -d "$parent" ]; do
    [ ! -e "$parent" ] && [ ! -L "$parent" ] || fail invalid-argument "Destination parent is not a directory: $parent"
    suffix=/${parent##*/}$suffix
    parent=${parent%/*}
    [ -n "$parent" ] || parent=/
done
physical=$(CDPATH= cd -- "$parent" && pwd -P) || fail invalid-argument "Cannot resolve destination: $parent"
target=${physical%/}$suffix
[ -n "$target" ] || target=/
case "$target" in /) fail invalid-argument 'Choose a destination other than the file-system root.' ;; esac
case "$target/" in "$root/"*) fail invalid-argument 'Choose a destination outside the starter payload.' ;; esac
case "$root/" in "$target/"*) fail invalid-argument 'Destination must not contain the starter payload.' ;; esac

safe_path() {
    case "$1" in ''|/*|*/|*[!A-Za-z0-9._/-]*|*//*|.|..|./*|../*|*/./*|*/../*|*/.|*/..) fail integrity-failed "Unsafe manifest path: $1" ;; esac
}
no_link() {
    current=$1
    rest=$2
    [ ! -L "$current" ] || fail conflict "Symbolic link in apply path: $current"
    while :; do
        part=${rest%%/*}
        current=$current/$part
        [ ! -L "$current" ] || fail conflict "Symbolic link in apply path: $current"
        case "$rest" in
            */*)
                if [ -e "$current" ] && [ ! -d "$current" ]; then
                    fail conflict "A parent path is not a directory: $current"
                fi
                rest=${rest#*/} ;;
            *) break ;;
        esac
    done
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
trap 'exit 2' HUP INT TERM
tab=$(printf '\t')
: > "$work/selected"
: > "$work/conflicts"

# Telemetry preference: an existing file is never rewritten. An invalid one
# is treated as disabled and does not fail setup.
preference_exists=false
preference_enabled=true
[ "$no_telemetry" = false ] || preference_enabled=false
if [ -e "$target/$preference_path" ] || [ -L "$target/$preference_path" ]; then
    preference_exists=true
    preference_enabled=false
    if [ -f "$target/$preference_path" ] && [ ! -L "$target/$preference_path" ]; then
        preference_enabled=$(LC_ALL=C awk '{ document = document $0 "\n" } END {
            if (document ~ /^[ \t\r\n]*[{][ \t\r\n]*"enabled"[ \t\r\n]*:[ \t\r\n]*true[ \t\r\n]*[}][ \t\r\n]*$/) printf "true"
            else printf "false"
        }' "$target/$preference_path" 2>/dev/null) || preference_enabled=false
    fi
fi

selected() {
    case "$1" in
        common) return 0 ;;
        agents) [ "$agent" = copilot ] || [ "$agent" = codex ]; return ;;
        copilot|claude|codex) [ "$1" = "$agent" ]; return ;;
        preference-on) [ "$preference_exists" = false ] && [ "$no_telemetry" = false ]; return ;;
        preference-off) [ "$preference_exists" = false ] && [ "$no_telemetry" = true ]; return ;;
        hook-copilot|hook-claude|hook-codex) [ "$1" = "hook-$agent" ] && [ "$preference_enabled" = true ]; return ;;
    esac
    return 1
}

read_manifest() {
    group=$1
    base=$2
    manifest=$base/files.tsv
    LC_ALL=C awk -F '\t' 'NF!=4 || $1 !~ /^(common|agents|copilot|claude|codex|preference-on|preference-off|hook-copilot|hook-claude|hook-codex)$/ ||
        length($2)!=64 || $2 ~ /[^0-9a-f]/ {exit 1}' "$manifest" || fail integrity-failed "Invalid manifest row in $manifest"
    while IFS="$tab" read -r scope digest source output; do
        safe_path "$source"
        safe_path "$output"
        selected "$scope" || continue
        no_link "$base" "$source"
        no_link "$target" "$output"
        [ -f "$base/$source" ] || fail integrity-failed "Missing payload file: $source"
        printf '%s  %s\n' "$digest" "$base/$source" >> "$work/payload.sha256"
        printf '%s\t%s\t%s\t%s\t%s\n' "$group" "$scope" "$digest" "$base/$source" "$output" >> "$work/selected"
    done < "$manifest"
}

: > "$work/payload.sha256"
read_manifest runtime "$root/runtime"
read_manifest bundle "$root/$bundle"
[ -z "$template_manifest" ] || read_manifest bundle "$root/$bundle/templates/$template"
[ -s "$work/selected" ] || fail integrity-failed 'The manifest selects no files.'
LC_ALL=C awk -F '\t' '{ key = tolower($5) } seen[key]++ {exit 1}' "$work/selected" ||
    fail integrity-failed 'Duplicate destination in manifest.'
verify_hashes "$work/payload.sha256" || fail integrity-failed 'A payload file does not match its hash; nothing was written.'

# Provenance records: installer-owned, never compared for conflicts.
read_record() {
    file=$target/$state_dir/$1.json
    : > "$work/record-$1"
    record_commit=
    [ -f "$file" ] && [ ! -L "$file" ] || return 0
    LC_ALL=C awk -v out="$work/record-$1" '
        /^    "[A-Za-z0-9._\/-]+": "[0-9a-f]+",?$/ {
            line = $0
            sub(/^    "/, "", line)
            path = line
            sub(/": ".*$/, "", path)
            hash = line
            sub(/^.*": "/, "", hash)
            sub(/",?$/, "", hash)
            if (length(hash) == 64) printf "%s\t%s\n", path, hash >> out
        }' "$file"
    record_commit=$(LC_ALL=C awk '/^  "commit": "[0-9a-z]+",$/ { line = $0; sub(/^  "commit": "/, "", line); sub(/",$/, "", line); print line; exit }' "$file")
}
read_record runtime
runtime_record_commit=$record_commit
read_record "$bundle"
bundle_record_commit=$record_commit

user_owned() {
    case "$1:$2" in
        hook-claude:.claude/settings.json|hook-codex:.codex/hooks.json) return 0 ;;
    esac
    return 1
}

: > "$work/states"
while IFS="$tab" read -r group scope digest source output; do
    path=$target/$output
    if user_owned "$scope" "$output"; then
        if [ ! -e "$path" ] && [ ! -L "$path" ]; then state=missing
        elif [ -f "$path" ] && cmp -s "$source" "$path"; then state=user-installed
        elif [ -f "$path" ] && grep -F -q "$hook_marker" "$path"; then state=user-merged
        else state=user-needs-merge
        fi
    elif [ ! -e "$path" ] && [ ! -L "$path" ]; then
        state=missing
    elif [ ! -f "$path" ] || [ -L "$path" ]; then
        state=conflict
    else
        actual=$(hash_file "$path")
        if [ "$actual" = "$digest" ]; then
            state=current
        else
            record_name=$bundle
            [ "$group" = bundle ] || record_name=runtime
            baseline=$(LC_ALL=C awk -F '\t' -v p="$output" '$1 == p { print $2; exit }' "$work/record-$record_name")
            if [ -z "$baseline" ]; then state=conflict
            elif [ "$baseline" = "$actual" ]; then state=outdated
            else state=modified
            fi
        fi
    fi
    [ "$state" != conflict ] || printf '%s\n' "$output" >> "$work/conflicts"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$state" "$group" "$scope" "$digest" "$source" "$output" >> "$work/states"
done < "$work/selected"
[ ! -s "$work/conflicts" ] ||
    fail conflict 'Existing files differ from the starter and have no install record; nothing was written. Move or reconcile them, then retry.'

count_state() { LC_ALL=C awk -F '\t' -v s="$1" '$1 == s { n++ } END { print n + 0 }' "$work/states"; }
missing=$(count_state missing)
created=0
if [ "$check" = false ]; then
    while IFS="$tab" read -r state group scope digest source output; do
        [ "$state" = missing ] || continue
        mkdir -p "$(dirname -- "$target/$output")" || fail conflict "Cannot create the directory for $output"
        # noclobber refuses a file created concurrently after preflight.
        (set -C; cat "$source" > "$target/$output") 2>/dev/null ||
            fail conflict "Could not create $output; files created before it remain. No existing file was overwritten."
        created=$((created + 1))
    done < "$work/states"
fi

write_record() {
    name=$1
    group=$2
    file=$target/$state_dir/$name.json
    # A record and its commit change only when this run created a file in its group.
    LC_ALL=C awk -F '\t' -v g="$group" '$2 == g && $1 == "missing" &&
        !(($3 == "hook-claude" && $6 == ".claude/settings.json") || ($3 == "hook-codex" && $6 == ".codex/hooks.json")) { found = 1 }
        END { exit found ? 0 : 1 }' "$work/states" || { : > "$work/new-$name"; return 0; }
    LC_ALL=C awk -F '\t' -v g="$group" '
        $2 == g && ($1 == "missing" || $1 == "current") &&
        !(($3 == "hook-claude" && $6 == ".claude/settings.json") || ($3 == "hook-codex" && $6 == ".codex/hooks.json")) {
            printf "%s\t%s\n", $6, $4 }' "$work/states" > "$work/new-$name"
    [ -s "$work/new-$name" ] || return 0
    LC_ALL=C awk -F '\t' 'FNR == NR { fresh[$1] = $2; next } !($1 in fresh) { print } END { for (p in fresh) printf "%s\t%s\n", p, fresh[p] }' \
        "$work/new-$name" "$work/record-$name" | LC_ALL=C sort -t "$tab" -k 1,1 > "$work/merged-$name"
    mkdir -p "$target/$state_dir"
    {
        printf '{\n  "schemaVersion": 1,\n  "name": "%s",\n  "commit": "%s",\n  "files": {\n' "$name" "$commit"
        LC_ALL=C awk -F '\t' '{ lines[NR] = sprintf("    \"%s\": \"%s\"", $1, $2) } END {
            for (i = 1; i <= NR; i++) printf "%s%s\n", lines[i], (i < NR ? "," : "") }' "$work/merged-$name"
        printf '  }\n}\n'
    } > "$work/out-$name"
    mv -f "$work/out-$name" "$file"
}
if [ "$check" = false ] && [ "$created" -gt 0 ]; then
    write_record runtime runtime
    [ ! -s "$work/new-runtime" ] || runtime_record_commit=$commit
    write_record "$bundle" bundle
    [ ! -s "$work/new-$bundle" ] || bundle_record_commit=$commit
fi

# Hook state for the selected agent.
hook_state=absent
hook_snippet=
if [ "$preference_enabled" = true ]; then
    hook_row=$(LC_ALL=C awk -F '\t' -v s="hook-$agent" '$3 == s && $6 !~ /^\.azure-functions-skills\// { print $1; exit }' "$work/states")
    case "$hook_row" in
        missing) if [ "$check" = true ]; then hook_state=absent; else hook_state=installed; fi ;;
        current|outdated|user-installed) hook_state=installed ;;
        user-merged) hook_state=merged ;;
        user-needs-merge|modified)
            if grep -F -q "$hook_marker" "$target/$(LC_ALL=C awk -F '\t' -v s="hook-$agent" '$3 == s && $6 !~ /^\.azure-functions-skills\// { print $6; exit }' "$work/states")"; then
                hook_state=merged
            else
                hook_state=needs-merge
                hook_snippet=.azure-functions-skills/hooks/$agent.json
            fi ;;
    esac
fi

# Coexistence with plugin-style workspace assets.
coexistence=none
for asset in "$target"/.github/skills/azure-functions-* "$target/.github/hooks/runtime/telemetry.mjs" \
    "$target/.claude/hooks/runtime/telemetry.mjs" "$target/.codex/hooks/runtime/telemetry.mjs"; do
    if [ -e "$asset" ]; then coexistence=workspace; break; fi
done

# Tool inventory: command presence only.
: > "$work/missing-tools"
while IFS="$tab" read -r tool probes tool_os reason docs command; do
    [ "$tool_os" = "$os" ] || continue
    found=false
    for probe in $(printf '%s' "$probes" | tr ',' ' '); do
        if command -v "$probe" >/dev/null 2>&1; then found=true; break; fi
    done
    [ "$found" = false ] || continue
    printf '%s\t%s\t%s\t%s\n' "$tool" "$reason" "$docs" "$command" >> "$work/missing-tools"
done < "$root/$bundle/tools.tsv"

ready=true
exit_code=0
if [ "$check" = true ] && [ "$missing" -gt 0 ]; then ready=false; exit_code=1; fi

# Setup event decision. Opt-outs: flag, environment, preference files in the
# destination and every ancestor. The preference file this run just wrote is
# known to be enabled and is not read again: a transient read failure of a new
# file (Windows CI) must not count as an opt-out.
fresh_preference=
[ "$preference_exists" = true ] || fresh_preference="$target/$preference_path"
send=0
if [ "$check" = false ] && [ "$created" -gt 0 ] && [ "$no_telemetry" = false ] && [ "$preference_enabled" = true ]; then
    send=1
    for variable in "${AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY:-}" "${AZURE_MCP_COLLECT_TELEMETRY:-}"; do
        case "$(printf '%s' "$variable" | tr '[:upper:]' '[:lower:]')" in false) send=0 ;; esac
    done
    directory=$target
    while [ "$send" = 1 ]; do
        for candidate in "$directory/.azure-functions-skills/telemetry.config.json" "$directory/.github/hooks/telemetry.config.json" \
            "$directory/.claude/hooks/telemetry.config.json" "$directory/.codex/hooks/telemetry.config.json"; do
            [ -e "$candidate" ] || [ -L "$candidate" ] || continue
            [ "$candidate" != "$fresh_preference" ] || continue
            if [ ! -f "$candidate" ] || [ ! -r "$candidate" ]; then send=0; break; fi
            LC_ALL=C awk '{ document = document $0 "\n" } END {
                if (document !~ /^[ \t\r\n]*[{]/ || document !~ /[}][ \t\r\n]*$/) exit 1
                if (document ~ /"enabled"[ \t\r\n]*:[ \t\r\n]*false/) exit 1
            }' "$candidate" 2>/dev/null || { send=0; break; }
        done
        [ "$directory" != / ] || break
        directory=$(dirname -- "$directory")
    done
fi
if [ -n "$result_file" ]; then
    printf 'send=%s\nos=%s\ncreated=%s\n' "$send" "$os" "$created" > "$result_file"
fi

mode=apply
[ "$check" = false ] || mode=check
skills_json=$(LC_ALL=C awk -F '\t' 'BEGIN {ORS=""} $6 ~ /^\.(agents|claude)\/skills\/[^\/]+\/SKILL[.]md$/ {
    split($6, parts, "/")
    if (!seen[parts[3]]++) { printf "%s\"%s\"", separator, parts[3]; separator = "," }
}' "$work/states")
commit_json() { if [ -n "$1" ]; then printf '"%s"' "$1"; else printf null; fi; }
if [ "$json" = true ]; then
    escaped_target=$(printf '%s' "$target" | json_escape) || fail invalid-argument 'Control character in destination.'
    printf '{"schemaVersion":1,"mode":"%s","ready":%s,"bundle":"%s",' "$mode" "$ready" "$bundle"
    if [ -n "$template" ]; then printf '"template":"%s",' "$template"; else printf '"template":null,'; fi
    printf '"agent":"%s","destination":"%s","sourceCommit":"%s",' "$agent" "$escaped_target" "$commit"
    printf '"installed":{"bundleCommit":%s,"runtimeCommit":%s},' "$(commit_json "$bundle_record_commit")" "$(commit_json "$runtime_record_commit")"
    printf '"skills":[%s],' "$skills_json"
    printf '"files":{"created":%s,"current":%s,"outdated":%s,"modified":%s},' \
        "$created" "$(count_state current)" "$(count_state outdated)" "$(count_state modified)"
    printf '"missingTools":['
    separator=
    while IFS="$tab" read -r tool reason docs command; do
        printf '%s{"tool":"%s","reason":"%s",' "$separator" "$tool" "$(printf '%s' "$reason" | json_escape)"
        if [ "$command" = - ]; then printf '"command":null,'; else printf '"command":"%s",' "$(printf '%s' "$command" | json_escape)"; fi
        printf '"docs":"%s"}' "$(printf '%s' "$docs" | json_escape)"
        separator=,
    done < "$work/missing-tools"
    printf '],"telemetry":{"preferenceEnabled":%s,"hooks":"%s","hookSnippet":' "$preference_enabled" "$hook_state"
    if [ -n "$hook_snippet" ]; then printf '"%s"' "$hook_snippet"; else printf null; fi
    printf '},"coexistence":"%s","error":null}\n' "$coexistence"
else
    printf 'Ready: %s (%s)\nBundle: %s%s\nAgent: %s\nDestination: %s\nSource commit: %s\n' \
        "$ready" "$mode" "$bundle" "${template:+ / $template}" "$agent" "$target" "$commit"
    printf 'Files: created %s, current %s, outdated %s, modified %s\n' \
        "$created" "$(count_state current)" "$(count_state outdated)" "$(count_state modified)"
    if [ -s "$work/missing-tools" ]; then
        printf 'Missing tools:\n'
        while IFS="$tab" read -r tool reason docs command; do
            printf '  %s: %s\n    %s\n' "$tool" "$reason" "$docs"
            [ "$command" = - ] || printf '    Install: %s\n' "$command"
        done < "$work/missing-tools"
    fi
    printf 'Telemetry preference enabled: %s; hooks: %s\n' "$preference_enabled" "$hook_state"
    [ -z "$hook_snippet" ] || printf 'Hook snippet to merge: %s\n' "$hook_snippet"
    [ "$coexistence" = none ] || printf 'Plugin-style workspace assets were found; usage may be counted twice.\n'
fi
exit "$exit_code"
