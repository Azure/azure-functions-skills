#!/bin/bash

# Use only the runtime next to this hook. Do not use a package manager.
script_path="${BASH_SOURCE[0]//\\//}"
script_dir="$(cd -- "${script_path%/*}" 2>/dev/null && pwd)"
runtime="${script_dir}/../runtime/telemetry.mjs"
if [ -f "$runtime" ] && command -v node >/dev/null 2>&1; then
    node "$runtime" hook >/dev/null 2>&1 || true
fi
printf '%s\n' '{"continue":true}'
exit 0
