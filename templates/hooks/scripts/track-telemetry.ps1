# Use only the runtime next to this hook. Do not use a package manager.
$runtime = [IO.Path]::Combine($PSScriptRoot, '..', 'runtime', 'telemetry.mjs')
try {
    $node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
    if (Test-Path -LiteralPath $runtime -PathType Leaf) {
        & $node.Source $runtime hook 2>&1 | Out-Null
    }
} catch {
    # Telemetry must not change the tool result.
}
Write-Output '{"continue":true}'
exit 0
