# Azure Functions Skills starter bootstrap (PowerShell).
# The installer loads this file as a script block, so execution policy does not
# apply and the caller's session is never exited. It writes the report to the
# console and returns the exit code (0 ready, 1 check found missing files, 2 failure).
param(
    [string]$SourceRoot,
    [string]$Bundle,
    [string]$Template,
    [string]$Agent,
    [string]$Destination = (Get-Location).Path,
    [string]$Commit = 'local',
    [string]$ResultFile,
    [switch]$Check,
    [switch]$Json,
    [switch]$NoTelemetry
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$hookMarker = '.azure-functions-skills/runtime/telemetry.mjs'
$stateDir = '.azure-functions-skills'
$preferencePath = '.azure-functions-skills/telemetry.config.json'
$scopes = @('common', 'agents', 'copilot', 'claude', 'codex', 'preference-on', 'preference-off', 'hook-copilot', 'hook-claude', 'hook-codex')
$utf8 = New-Object Text.UTF8Encoding($false)
$conflicts = New-Object Collections.Generic.List[string]

function Stop-Starter([string]$Code, [string]$Message) {
    throw "afs-error|$Code|$Message"
}

function Write-Line([string]$Text) { [Console]::Out.WriteLine($Text) }

function ConvertTo-JsonString($Value) {
    if ($null -eq $Value) { return 'null' }
    $Value = [string]$Value
    $builder = New-Object Text.StringBuilder
    $null = $builder.Append('"')
    foreach ($character in $Value.ToCharArray()) {
        $code = [int]$character
        if ($character -eq '"') { $null = $builder.Append('\"') }
        elseif ($character -eq '\') { $null = $builder.Append('\\') }
        elseif ($code -lt 0x20 -or $code -eq 0x7f) { $null = $builder.Append(('\u{0:x4}' -f $code)) }
        else { $null = $builder.Append($character) }
    }
    $null = $builder.Append('"')
    return $builder.ToString()
}

function Test-Name([string]$Value) { return $Value -cmatch '^[a-z][a-z0-9-]{0,40}$' }

function Assert-SafePath([string]$Path) {
    if ($Path -cnotmatch '^[A-Za-z0-9._/-]+$' -or $Path.StartsWith('/') -or $Path.EndsWith('/') -or
        $Path -match '(^|/)\.\.?(/|$)' -or $Path.Contains('//')) {
        Stop-Starter 'integrity-failed' "Unsafe manifest path: $Path"
    }
}

function Get-PathAttributes([string]$Path) {
    try { return [IO.File]::GetAttributes($Path) }
    catch [IO.FileNotFoundException] { return $null }
    catch [IO.DirectoryNotFoundException] { return $null }
}

function Assert-NoLink([string]$Root, [string]$Relative) {
    $current = $Root
    $segments = @('') + @($Relative.Split('/'))
    for ($index = 0; $index -lt $segments.Count; $index++) {
        if ($segments[$index]) { $current = [IO.Path]::Combine($current, $segments[$index]) }
        $attributes = Get-PathAttributes $current
        if ($null -ne $attributes -and ($attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Stop-Starter 'conflict' "Symbolic links and junctions are not supported in apply paths: $current"
        }
        if ($index -lt $segments.Count - 1 -and $null -ne $attributes -and -not ($attributes -band [IO.FileAttributes]::Directory)) {
            Stop-Starter 'conflict' "A parent path is not a directory: $current"
        }
    }
}

function Get-Digest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Test-Selected([string]$Scope) {
    switch ($Scope) {
        'common' { return $true }
        'agents' { return $Agent -in @('copilot', 'codex') }
        'preference-on' { return (-not $preferenceExists) -and (-not $NoTelemetry) }
        'preference-off' { return (-not $preferenceExists) -and [bool]$NoTelemetry }
        { $_ -in @('copilot', 'claude', 'codex') } { return $Scope -eq $Agent }
        { $_ -like 'hook-*' } { return ($Scope -eq "hook-$Agent") -and $preferenceEnabled }
    }
    return $false
}

function Test-UserOwned([string]$Scope, [string]$Output) {
    return ($Scope -eq 'hook-claude' -and $Output -ceq '.claude/settings.json') -or
        ($Scope -eq 'hook-codex' -and $Output -ceq '.codex/hooks.json')
}

function Read-Record([string]$Name) {
    $result = @{ Commit = $null; Files = @{} }
    $file = [IO.Path]::Combine($target, $stateDir, "$Name.json")
    $attributes = Get-PathAttributes $file
    if ($null -eq $attributes -or ($attributes -band [IO.FileAttributes]::ReparsePoint) -or ($attributes -band [IO.FileAttributes]::Directory)) {
        return $result
    }
    foreach ($line in [IO.File]::ReadAllLines($file)) {
        if ($line -cmatch '^    "([A-Za-z0-9._/-]+)": "([0-9a-f]{64})",?$') { $result.Files[$Matches[1]] = $Matches[2] }
        elseif ($line -cmatch '^  "commit": "([0-9a-z]+)",$') { $result.Commit = $Matches[1] }
    }
    return $result
}

function Write-Record([string]$Name, [string]$Group, [hashtable]$Old) {
    $files = @{}
    foreach ($key in $Old.Files.Keys) { $files[$key] = $Old.Files[$key] }
    # A record and its commit change only when this run created a file in its group.
    $created = 0
    foreach ($entry in $states) {
        if ($entry.Group -ne $Group -or $entry.State -notin @('missing', 'current') -or (Test-UserOwned $entry.Scope $entry.Output)) { continue }
        $files[$entry.Output] = $entry.Digest
        if ($entry.State -eq 'missing') { $created++ }
    }
    if ($created -eq 0) { return $false }
    $keys = [string[]]@($files.Keys)
    [Array]::Sort($keys, [StringComparer]::Ordinal)
    $builder = New-Object Text.StringBuilder
    $null = $builder.Append("{`n  `"schemaVersion`": 1,`n  `"name`": `"$Name`",`n  `"commit`": `"$Commit`",`n  `"files`": {`n")
    for ($index = 0; $index -lt $keys.Count; $index++) {
        $separator = if ($index -lt $keys.Count - 1) { ',' } else { '' }
        $null = $builder.Append("    `"$($keys[$index])`": `"$($files[$keys[$index]])`"$separator`n")
    }
    $null = $builder.Append("  }`n}`n")
    $directory = [IO.Path]::Combine($target, $stateDir)
    $null = [IO.Directory]::CreateDirectory($directory)
    [IO.File]::WriteAllText([IO.Path]::Combine($directory, "$Name.json"), $builder.ToString(), $utf8)
    return $true
}

function Test-OptOutFile([string]$Path) {
    $attributes = Get-PathAttributes $Path
    if ($null -eq $attributes) { return $false }
    if ($attributes -band [IO.FileAttributes]::Directory) { return $true }
    try { $text = [IO.File]::ReadAllText($Path) } catch { return $true }
    if ($text -notmatch '^\s*\{' -or $text -notmatch '\}\s*$') { return $true }
    return $text -match '"enabled"\s*:\s*false'
}

try {
    if (-not $SourceRoot) { $SourceRoot = $PSScriptRoot }
    if (-not (Test-Name $Bundle)) { Stop-Starter 'invalid-argument' 'Specify -Bundle with a bundle name.' }
    if ($Agent -notin @('copilot', 'claude', 'codex')) { Stop-Starter 'invalid-argument' 'Specify -Agent copilot, claude, or codex.' }
    if ($Template -and -not (Test-Name $Template)) { Stop-Starter 'invalid-argument' "Invalid template name: $Template" }
    if ($Commit -cne 'local' -and $Commit -cnotmatch '^[0-9a-f]{40}$') { Stop-Starter 'invalid-argument' 'Invalid commit.' }
    if (-not $SourceRoot -or -not [IO.Directory]::Exists($SourceRoot)) { Stop-Starter 'invalid-argument' 'Cannot open the starter source.' }
    $root = [IO.Path]::GetFullPath($SourceRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if (-not [IO.File]::Exists([IO.Path]::Combine($root, 'engine-version')) -or
        -not [IO.File]::Exists([IO.Path]::Combine($root, 'runtime', 'files.tsv'))) {
        Stop-Starter 'invalid-argument' 'Incomplete starter payload. Use the complete starter archive.'
    }
    if (-not [IO.File]::Exists([IO.Path]::Combine($root, $Bundle, 'files.tsv'))) { Stop-Starter 'invalid-argument' "Unknown bundle: $Bundle" }
    $templatesRoot = [IO.Path]::Combine($root, $Bundle, 'templates')
    $templateBase = $null
    if ([IO.Directory]::Exists($templatesRoot)) {
        if (-not $Template) {
            $available = (@([IO.Directory]::GetDirectories($templatesRoot) | ForEach-Object { [IO.Path]::GetFileName($_) }) -join ' ')
            Stop-Starter 'invalid-argument' "Bundle $Bundle needs -Template. Available: $available"
        }
        $templateBase = [IO.Path]::Combine($templatesRoot, $Template)
        if (-not [IO.File]::Exists([IO.Path]::Combine($templateBase, 'files.tsv'))) { Stop-Starter 'invalid-argument' "Unknown template: $Template" }
    } elseif ($Template) {
        Stop-Starter 'invalid-argument' "Bundle $Bundle has no templates."
    }

    $isWindowsHost = ($PSVersionTable.PSEdition -eq 'Desktop') -or [bool](Get-Variable IsWindows -ValueOnly -ErrorAction SilentlyContinue)
    $os = if ($isWindowsHost) { 'windows' } elseif ([bool](Get-Variable IsMacOS -ValueOnly -ErrorAction SilentlyContinue)) { 'macos' } else { 'linux' }

    $target = [IO.Path]::GetFullPath($Destination)
    if ($target -match '[\x00-\x1f]') { Stop-Starter 'invalid-argument' 'Control character in destination.' }
    if ([IO.File]::Exists($target)) { Stop-Starter 'invalid-argument' "Destination is a file: $target" }
    $separator = [IO.Path]::DirectorySeparatorChar
    $comparison = if ($isWindowsHost) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    $targetRoot = $target.TrimEnd($separator)
    if ($targetRoot -eq '' -or $targetRoot -match '^[A-Za-z]:$' -or [IO.Path]::GetPathRoot($target).TrimEnd($separator) -eq $targetRoot) {
        Stop-Starter 'invalid-argument' 'Choose a destination other than a drive or file-system root.'
    }
    if ([string]::Equals($targetRoot, $root, $comparison) -or ($targetRoot + $separator).StartsWith($root + $separator, $comparison) -or
        ($root + $separator).StartsWith($targetRoot + $separator, $comparison)) {
        Stop-Starter 'invalid-argument' 'Choose a destination outside the starter payload.'
    }

    # Telemetry preference: an existing file is never rewritten. An invalid one
    # is treated as disabled and does not fail setup.
    $preferenceFile = [IO.Path]::Combine($target, $preferencePath)
    $preferenceAttributes = Get-PathAttributes $preferenceFile
    $preferenceExists = $null -ne $preferenceAttributes
    $preferenceEnabled = -not $NoTelemetry
    if ($preferenceExists) {
        $preferenceEnabled = $false
        if (-not ($preferenceAttributes -band [IO.FileAttributes]::Directory) -and -not ($preferenceAttributes -band [IO.FileAttributes]::ReparsePoint)) {
            try {
                $preferenceText = [IO.File]::ReadAllText($preferenceFile)
                $preferenceEnabled = $preferenceText -cmatch '\A[ \t\r\n]*\{[ \t\r\n]*"enabled"[ \t\r\n]*:[ \t\r\n]*true[ \t\r\n]*\}[ \t\r\n]*\z'
            } catch { $preferenceEnabled = $false }
        }
    }

    $selected = New-Object Collections.Generic.List[object]
    $destinations = @{}
    $manifests = @(@{ Group = 'runtime'; Base = [IO.Path]::Combine($root, 'runtime') }, @{ Group = 'bundle'; Base = [IO.Path]::Combine($root, $Bundle) })
    if ($templateBase) { $manifests += @{ Group = 'bundle'; Base = $templateBase } }
    foreach ($manifest in $manifests) {
        foreach ($line in [IO.File]::ReadAllLines([IO.Path]::Combine($manifest.Base, 'files.tsv'))) {
            $fields = $line.Split("`t")
            if ($fields.Count -ne 4 -or $fields[0] -cnotin $scopes -or $fields[1] -cnotmatch '^[0-9a-f]{64}$') {
                Stop-Starter 'integrity-failed' 'Invalid manifest row.'
            }
            $scope, $digest, $relativeSource, $relativeTarget = $fields
            Assert-SafePath $relativeSource
            Assert-SafePath $relativeTarget
            if (-not (Test-Selected $scope)) { continue }
            $key = $relativeTarget.ToLowerInvariant()
            if ($destinations.ContainsKey($key)) { Stop-Starter 'integrity-failed' "Duplicate destination in manifest: $relativeTarget" }
            $destinations[$key] = $true
            Assert-NoLink $manifest.Base $relativeSource
            Assert-NoLink $target $relativeTarget
            $source = [IO.Path]::Combine($manifest.Base, $relativeSource)
            if (-not [IO.File]::Exists($source) -or (Get-Digest $source) -cne $digest) {
                Stop-Starter 'integrity-failed' "A payload file does not match its hash; nothing was written: $relativeSource"
            }
            $selected.Add([PSCustomObject]@{ Group = $manifest.Group; Scope = $scope; Digest = $digest; Source = $source; Output = $relativeTarget })
        }
    }
    if ($selected.Count -eq 0) { Stop-Starter 'integrity-failed' 'The manifest selects no files.' }

    $records = @{ runtime = (Read-Record 'runtime'); bundle = (Read-Record $Bundle) }
    $states = New-Object Collections.Generic.List[object]
    foreach ($entry in $selected) {
        $path = [IO.Path]::Combine($target, $entry.Output)
        $attributes = Get-PathAttributes $path
        if (Test-UserOwned $entry.Scope $entry.Output) {
            if ($null -eq $attributes) { $state = 'missing' }
            elseif (-not ($attributes -band [IO.FileAttributes]::Directory) -and (Get-Digest $path) -ceq $entry.Digest) { $state = 'user-installed' }
            elseif (-not ($attributes -band [IO.FileAttributes]::Directory) -and [IO.File]::ReadAllText($path).Contains($hookMarker)) { $state = 'user-merged' }
            else { $state = 'user-needs-merge' }
        } elseif ($null -eq $attributes) {
            $state = 'missing'
        } elseif (($attributes -band [IO.FileAttributes]::Directory) -or ($attributes -band [IO.FileAttributes]::ReparsePoint)) {
            $state = 'conflict'
        } else {
            $actual = Get-Digest $path
            $baseline = $records[$entry.Group].Files[$entry.Output]
            if ($actual -ceq $entry.Digest) { $state = 'current' }
            elseif ($null -eq $baseline) { $state = 'conflict' }
            elseif ($baseline -ceq $actual) { $state = 'outdated' }
            else { $state = 'modified' }
        }
        if ($state -eq 'conflict') { $conflicts.Add($entry.Output) }
        $states.Add([PSCustomObject]@{ State = $state; Group = $entry.Group; Scope = $entry.Scope; Digest = $entry.Digest; Source = $entry.Source; Output = $entry.Output })
    }
    if ($conflicts.Count -gt 0) {
        Stop-Starter 'conflict' 'Existing files differ from the starter and have no install record; nothing was written. Move or reconcile them, then retry.'
    }

    $missing = @($states | Where-Object { $_.State -eq 'missing' })
    $created = 0
    if (-not $Check) {
        foreach ($entry in $missing) {
            $output = [IO.Path]::Combine($target, $entry.Output)
            $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output))
            try {
                # CreateNew refuses a file created concurrently after preflight.
                $stream = [IO.File]::Open($output, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
                try {
                    $bytes = [IO.File]::ReadAllBytes($entry.Source)
                    $stream.Write($bytes, 0, $bytes.Length)
                } finally { $stream.Dispose() }
            } catch {
                Stop-Starter 'conflict' "Could not create $($entry.Output); files created before it remain. No existing file was overwritten."
            }
            $created++
        }
    }
    $runtimeCommit = $records.runtime.Commit
    $bundleCommit = $records.bundle.Commit
    if (-not $Check -and $created -gt 0) {
        if (Write-Record 'runtime' 'runtime' $records.runtime) { $runtimeCommit = $Commit }
        if (Write-Record $Bundle 'bundle' $records.bundle) { $bundleCommit = $Commit }
    }

    $hookState = 'absent'
    $hookSnippet = $null
    if ($preferenceEnabled) {
        $hookEntry = @($states | Where-Object { $_.Scope -eq "hook-$Agent" -and -not $_.Output.StartsWith('.azure-functions-skills/') }) | Select-Object -First 1
        if ($null -ne $hookEntry) {
            switch ($hookEntry.State) {
                'missing' { $hookState = if ($Check) { 'absent' } else { 'installed' } }
                { $_ -in @('current', 'outdated', 'user-installed') } { $hookState = 'installed' }
                'user-merged' { $hookState = 'merged' }
                default {
                    if ([IO.File]::ReadAllText([IO.Path]::Combine($target, $hookEntry.Output)).Contains($hookMarker)) { $hookState = 'merged' }
                    else { $hookState = 'needs-merge'; $hookSnippet = ".azure-functions-skills/hooks/$Agent.json" }
                }
            }
        }
    }

    $coexistence = 'none'
    $githubSkills = [IO.Path]::Combine($target, '.github', 'skills')
    if (([IO.Directory]::Exists($githubSkills) -and @([IO.Directory]::GetDirectories($githubSkills, 'azure-functions-*')).Count -gt 0) -or
        @('.github', '.claude', '.codex' | Where-Object { [IO.File]::Exists([IO.Path]::Combine($target, $_, 'hooks', 'runtime', 'telemetry.mjs')) }).Count -gt 0) {
        $coexistence = 'workspace'
    }

    $missingTools = New-Object Collections.Generic.List[object]
    foreach ($line in [IO.File]::ReadAllLines([IO.Path]::Combine($root, $Bundle, 'tools.tsv'))) {
        $fields = $line.Split("`t")
        if ($fields.Count -ne 6 -or $fields[2] -ne $os) { continue }
        $found = $false
        foreach ($probe in $fields[1].Split(',')) {
            if ($null -ne (Get-Command $probe -CommandType Application -ErrorAction SilentlyContinue)) { $found = $true; break }
        }
        if (-not $found) {
            $missingTools.Add([PSCustomObject]@{ Tool = $fields[0]; Reason = $fields[3]; Docs = $fields[4]; Command = $(if ($fields[5] -eq '-') { $null } else { $fields[5] }) })
        }
    }

    $ready = $true
    $exitCode = 0
    if ($Check -and $missing.Count -gt 0) { $ready = $false; $exitCode = 1 }

    $send = (-not $Check) -and $created -gt 0 -and (-not $NoTelemetry) -and $preferenceEnabled
    foreach ($name in @('AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY', 'AZURE_MCP_COLLECT_TELEMETRY')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value -and $value.ToLowerInvariant() -eq 'false') { $send = $false }
    }
    $directory = $target
    while ($send -and $directory) {
        foreach ($candidate in @('.azure-functions-skills/telemetry.config.json', '.github/hooks/telemetry.config.json', '.claude/hooks/telemetry.config.json', '.codex/hooks/telemetry.config.json')) {
            if (Test-OptOutFile ([IO.Path]::Combine($directory, $candidate))) { $send = $false; break }
        }
        $directory = [IO.Path]::GetDirectoryName($directory)
    }
    if ($ResultFile) {
        [IO.File]::WriteAllText($ResultFile, "send=$(if ($send) { 1 } else { 0 })`nos=$os`ncreated=$created`n", $utf8)
    }

    $counts = @{}
    foreach ($name in @('current', 'outdated', 'modified')) { $counts[$name] = @($states | Where-Object { $_.State -eq $name }).Count }
    $skills = New-Object Collections.Generic.List[string]
    foreach ($entry in $states) {
        if ($entry.Output -cmatch '^\.(agents|claude)/skills/([^/]+)/SKILL\.md$' -and -not $skills.Contains($Matches[2])) { $skills.Add($Matches[2]) }
    }
    $mode = if ($Check) { 'check' } else { 'apply' }
    if ($Json) {
        $toolsJson = @($missingTools | ForEach-Object {
            "{`"tool`":$(ConvertTo-JsonString $_.Tool),`"reason`":$(ConvertTo-JsonString $_.Reason),`"command`":$(ConvertTo-JsonString $_.Command),`"docs`":$(ConvertTo-JsonString $_.Docs)}"
        }) -join ','
        $skillsJson = @($skills | ForEach-Object { ConvertTo-JsonString $_ }) -join ','
        Write-Line ('{"schemaVersion":1,"mode":"' + $mode + '","ready":' + $ready.ToString().ToLowerInvariant() +
            ',"bundle":' + (ConvertTo-JsonString $Bundle) + ',"template":' + $(if ($Template) { ConvertTo-JsonString $Template } else { 'null' }) +
            ',"agent":' + (ConvertTo-JsonString $Agent) + ',"destination":' + (ConvertTo-JsonString $target) +
            ',"sourceCommit":' + (ConvertTo-JsonString $Commit) +
            ',"installed":{"bundleCommit":' + (ConvertTo-JsonString $bundleCommit) + ',"runtimeCommit":' + (ConvertTo-JsonString $runtimeCommit) + '}' +
            ',"skills":[' + $skillsJson + ']' +
            ',"files":{"created":' + $created + ',"current":' + $counts.current + ',"outdated":' + $counts.outdated + ',"modified":' + $counts.modified + '}' +
            ',"missingTools":[' + $toolsJson + ']' +
            ',"telemetry":{"preferenceEnabled":' + ([bool]$preferenceEnabled).ToString().ToLowerInvariant() + ',"hooks":"' + $hookState + '","hookSnippet":' + (ConvertTo-JsonString $hookSnippet) + '}' +
            ',"coexistence":"' + $coexistence + '","error":null}')
    } else {
        Write-Line "Ready: $($ready.ToString().ToLowerInvariant()) ($mode)"
        Write-Line "Bundle: $Bundle$(if ($Template) { " / $Template" })"
        Write-Line "Agent: $Agent"
        Write-Line "Destination: $target"
        Write-Line "Source commit: $Commit"
        Write-Line "Files: created $created, current $($counts.current), outdated $($counts.outdated), modified $($counts.modified)"
        if ($missingTools.Count -gt 0) {
            Write-Line 'Missing tools:'
            foreach ($tool in $missingTools) {
                Write-Line "  $($tool.Tool): $($tool.Reason)"
                Write-Line "    $($tool.Docs)"
                if ($tool.Command) { Write-Line "    Install: $($tool.Command)" }
            }
        }
        Write-Line "Telemetry preference enabled: $(([bool]$preferenceEnabled).ToString().ToLowerInvariant()); hooks: $hookState"
        if ($hookSnippet) { Write-Line "Hook snippet to merge: $hookSnippet" }
        if ($coexistence -ne 'none') { Write-Line 'Plugin-style workspace assets were found; usage may be counted twice.' }
    }
    return $exitCode
} catch {
    $text = [string]$_.Exception.Message
    if ($text -match '^afs-error\|([a-z-]+)\|(.*)$') { $code = $Matches[1]; $message = $Matches[2] }
    else { $code = 'invalid-argument'; $message = $text }
    if ($Json) {
        $files = ''
        if ($code -eq 'conflict' -and $conflicts.Count -gt 0) {
            $files = ',"files":[' + ((@($conflicts) | ForEach-Object { ConvertTo-JsonString $_ }) -join ',') + ']'
        }
        Write-Line ('{"schemaVersion":1,"ready":false,"error":{"code":"' + $code + '","message":' + (ConvertTo-JsonString $message) + $files + '}}')
    } else {
        [Console]::Error.WriteLine("Starter setup failed ($code): $message")
        foreach ($file in $conflicts) { [Console]::Error.WriteLine("  $file") }
    }
    return 2
}
