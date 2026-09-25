#Requires -Version 7.2
<#
.SYNOPSIS
    Produces the deterministic azure-functions-update dotnet-isolated definition-of-done result.
.DESCRIPTION
    Runs the offline checks for the stable scenario IDs, records one status and its
    evidence per requirement, and writes grading-evidence/checklist.json. The judge
    reads that file; it is never allowed to convert a missing or failed check into a pass.
    Every check runs against the submitted workspace and the staged baseline fixture.
#>
[CmdletBinding()]
param(
    [string]$Checklist = 'grading-evidence/definition-of-done.json',
    [string]$EvidenceRoot = 'grading-evidence',
    [string]$BaselineRoot = 'grading-evidence/baseline',
    [int]$HostReadySeconds = 90
)

$ErrorActionPreference = 'Stop'
$definition = Get-Content -LiteralPath $Checklist -Raw | ConvertFrom-Json
$expected = $definition.expectations
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null

$state = [ordered]@{}
$logs = [ordered]@{}
. (Join-Path $PSScriptRoot 'AzuriteContract.ps1')

function Add-Log {
    param([string]$Name, [string]$Content)
    $path = Join-Path $EvidenceRoot $Name
    Set-Content -LiteralPath $path -Value ($Content ?? '') -Encoding utf8
    $logs[$Name] = $path
    return $path
}

function Invoke-Recorded {
    param([string]$Name, [string]$File, [string[]]$ArgumentList)
    $standard = New-TemporaryFile
    $failure = New-TemporaryFile
    try {
        $process = Start-Process -FilePath $File -ArgumentList $ArgumentList -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $standard -RedirectStandardError $failure
        $output = (((Get-Content -LiteralPath $standard -Raw) ?? '') + "`n" + ((Get-Content -LiteralPath $failure -Raw) ?? '')).Trim()
        $path = Add-Log -Name "$Name.log" -Content "$File $($ArgumentList -join ' ')`nexit=$($process.ExitCode)`n$output"
        return [pscustomobject]@{
            Command  = "$File $($ArgumentList -join ' ')"
            ExitCode = $process.ExitCode
            Output   = $output
            Log      = $path
        }
    } catch {
        return [pscustomobject]@{
            Command  = "$File $($ArgumentList -join ' ')"
            ExitCode = -1
            Output   = $_.Exception.Message
            Log      = Add-Log -Name "$Name.log" -Content $_.Exception.Message
        }
    } finally {
        Remove-Item -LiteralPath $standard, $failure -Force -ErrorAction SilentlyContinue
    }
}

function Get-AppSource {
    Get-ChildItem -Path . -Filter *.cs -Recurse -File |
        Where-Object { $_.FullName -notmatch '[\\/](bin|obj|grading-evidence)[\\/]' }
}

function Get-HostFunctionNames {
    param([int]$Port)
    $inventory = Invoke-RestMethod -TimeoutSec 5 -NoProxy -MaximumRedirection 0 `
        -Uri "http://127.0.0.1:$Port/admin/functions"
    if (@($inventory | Where-Object { $_.name -isnot [string] -or -not $_.name }).Count -ne 0) {
        throw [FormatException]::new('The host returned an invalid function inventory.')
    }
    return @($inventory | ForEach-Object { $_.name })
}

function Get-EffectiveProjectFile {
    @($expected.project) + @('Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props') |
        Where-Object { Test-Path -LiteralPath $_ }
}

function Get-PackageReference {
    param([string]$Id)
    $found = @()
    foreach ($file in Get-EffectiveProjectFile) {
        $content = Get-Content -LiteralPath $file -Raw
        foreach ($match in [regex]::Matches($content, '<PackageReference\s+Include="(?<id>[^"]+)"(?<rest>[^>]*)')) {
            if ($match.Groups['id'].Value -eq $Id) {
                $version = [regex]::Match($match.Groups['rest'].Value, 'Version="(?<v>[^"]+)"')
                $found += [pscustomobject]@{
                    File    = $file
                    Id      = $Id
                    Version = $version.Success ? $version.Groups['v'].Value : '(central version management)'
                }
            }
        }
    }
    return $found
}

function Get-DeclaredPackageId {
    $ids = @()
    foreach ($file in Get-EffectiveProjectFile) {
        $content = Get-Content -LiteralPath $file -Raw
        $ids += [regex]::Matches($content, '<PackageReference\s+Include="(?<id>[^"]+)"') |
            ForEach-Object { $_.Groups['id'].Value }
    }
    return @($ids | Sort-Object -Unique)
}

function Get-TargetFramework {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $content = Get-Content -LiteralPath $Path -Raw
    $single = [regex]::Match($content, '<TargetFramework>\s*(?<tfm>[^<]+?)\s*</TargetFramework>')
    if ($single.Success) { return $single.Groups['tfm'].Value }
    $multiple = [regex]::Match($content, '<TargetFrameworks>\s*(?<tfm>[^<]+?)\s*</TargetFrameworks>')
    return $multiple.Success ? $multiple.Groups['tfm'].Value : $null
}

function Get-RuntimeInstruction {
    # local.settings.json is a user file that git ignores. A migration can instead document the
    # setting in a settings example, a README, or a plan. Skill payloads and grader input do not count.
    param([Parameter(Mandatory)][string]$Root)
    $pattern = 'FUNCTIONS_WORKER_RUNTIME[\s`''":=]*(?:(?:to|as|is)\s+[`''"]*)?dotnet-isolated(?![\w-])'
    # A warning such as "do not set ..." is not an instruction. Examine each sentence or line.
    $negation = '(?i)\b(?:not|never|don''t|doesn''t|avoid|instead\s+of|remove[sd]?|without|legacy|obsolete|wrong|incorrect)\b'
    $extensions = @('.md', '.txt', '.json', '.jsonc', '.example', '.sample', '.template')
    $skipped = @('bin', 'obj', 'node_modules', 'grading-evidence')
    $found = [Collections.Generic.List[string]]::new()
    $pending = [Collections.Generic.Queue[string]]::new()
    $pending.Enqueue((Resolve-Path -LiteralPath $Root).Path)
    $base = $pending.Peek()
    while ($pending.Count -gt 0) {
        $directory = $pending.Dequeue()
        if ($directory -ne $base -and (Test-Path -LiteralPath (Join-Path $directory 'SKILL.md'))) { continue }
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            if ($item.PSIsContainer) {
                if (-not $item.Name.StartsWith('.') -and $skipped -notcontains $item.Name.ToLowerInvariant()) {
                    $pending.Enqueue($item.FullName)
                }
            } elseif ($item.Name -ne 'local.settings.json' -and $item.Length -le 262144 -and
                $extensions -contains $item.Extension.ToLowerInvariant()) {
                $sentences = [regex]::Split([string](Get-Content -LiteralPath $item.FullName -Raw), '(?<=[.;!?])\s+|\r?\n')
                if (@($sentences | Where-Object { $_ -match $pattern -and $_ -notmatch $negation }).Count -gt 0) {
                    $found.Add([IO.Path]::GetRelativePath($base, $item.FullName).Replace('\', '/'))
                }
            }
        }
    }
    return @($found | Sort-Object)
}

function Set-Result {
    param(
        [Parameter(Mandatory)] $Requirement,
        [Parameter(Mandatory)][ValidateSet('pass', 'fail', 'blocked', 'not-applicable')][string]$Status,
        [string[]]$Evidence = @(),
        [string]$Reason = ''
    )
    $state[$Requirement.id] = [ordered]@{
        id            = $Requirement.id
        title         = $Requirement.title
        gates         = @($Requirement.gates)
        status        = $Status
        evidence      = @($Evidence)
        reason        = $Reason
        judgeRequired = [bool](@($Requirement.gates) -contains 'judge')
    }
}

# --- Shared observations -----------------------------------------------------

$project = [string]$expected.project
$baselineProject = Join-Path $BaselineRoot 'UpgradeApp.csproj.txt'
$baselineHost = Join-Path $BaselineRoot 'host.json.txt'
$baselineSourceFile = Join-Path $BaselineRoot 'Hello.cs.txt'
$projectPresent = Test-Path -LiteralPath $project
$projectText = $projectPresent ? (Get-Content -LiteralPath $project -Raw) : ''
$sources = @(Get-AppSource)
$sourceText = (@($sources | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw })) -join "`n"
$declaredPackages = Get-DeclaredPackageId
$baselineTfm = Get-TargetFramework -Path $baselineProject
$currentTfm = $projectPresent ? (Get-TargetFramework -Path $project) : $null
$publishDirectory = Join-Path 'bin' ('eval-publish-' + [guid]::NewGuid())

$restore = $projectPresent ? (Invoke-Recorded -Name 'restore' -File 'dotnet' -ArgumentList @('restore', $project)) : $null
$build = ($restore -and $restore.ExitCode -eq 0) ?
    (Invoke-Recorded -Name 'build' -File 'dotnet' -ArgumentList @('build', $project, '--configuration', 'Release', '--no-restore')) : $null
$publish = ($build -and $build.ExitCode -eq 0) ?
    (Invoke-Recorded -Name 'publish' -File 'dotnet' -ArgumentList @(
        'publish', $project, '--configuration', 'Release', '--no-build', '--output', $publishDirectory)) : $null

$projectInventory = @(Get-ChildItem -Path . -Filter *.csproj -Recurse -File |
    Where-Object { $_.FullName -notmatch '[\\/](bin|obj|grading-evidence)[\\/]' })
$appProjectPath = $projectPresent ? (Resolve-Path -LiteralPath $project).Path : ''
$testProjects = @($projectInventory | Where-Object { $_.FullName -ne $appProjectPath } | Where-Object {
    $text = Get-Content -LiteralPath $_.FullName -Raw
    $text -match 'Microsoft\.NET\.Test\.Sdk' -or $text -match '<IsTestProject>\s*true'
})
$testRuns = @()
foreach ($testProject in $testProjects) {
    $testRuns += Invoke-Recorded -Name ('test-' + $testProject.BaseName) -File 'dotnet' `
        -ArgumentList @('test', $testProject.FullName, '--nologo')
}

# --- Host and trigger evidence ----------------------------------------------

$hostEvidence = [ordered]@{
    started       = $false
    ready         = $false
    registered    = @()
    missing       = @($expected.functions)
    inventoryFailure = ''
    responses     = @()
    failureReason = ''
    stdout        = Join-Path $EvidenceRoot 'func-stdout.log'
    stderr        = Join-Path $EvidenceRoot 'func-stderr.log'
    port          = 0
}
$hostProcess = $null
$storage = @{ available = $false; sent = $false; ready = $false; matches = $false; body = ''; reason = '' }
$ownedStorage = [Collections.Generic.List[object]]::new()
$requestId = [guid]::NewGuid().ToString('N')
$cleanupFailure = ''
$executionFailure = ''
$previousRuntime = $env:FUNCTIONS_WORKER_RUNTIME
$previousStorage = $env:AzureWebJobsStorage
try {
    if (-not $publish -or $publish.ExitCode -ne 0) {
        $hostEvidence.failureReason = 'No publish artifact: the Functions host check could not run.'
    } else {
        try {
            Initialize-StorageCase -Contract $expected.storage -Owned $ownedStorage
            $storage.available = $true
        } catch [System.Net.Http.HttpRequestException] {
            $storage.reason = "Azurite is unavailable: $($_.Exception.Message)"
        } catch [System.Threading.Tasks.TaskCanceledException] {
            $storage.reason = "Azurite did not respond: $($_.Exception.Message)"
        } catch [InvalidOperationException] {
            $storage.reason = $_.Exception.Message
        }
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $hostEvidence.port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
        $listener.Stop()
        $func = (Get-Command func.ps1 -ErrorAction SilentlyContinue) ?? (Get-Command func -ErrorAction SilentlyContinue)
        if (-not $storage.available) {
            $hostEvidence.failureReason = $storage.reason
        } elseif (-not $func) {
            $hostEvidence.failureReason = 'Azure Functions Core Tools (func) is not available on PATH.'
        } else {
            $shell = (Get-Command pwsh -ErrorAction Stop).Source
            $command = "& '$($func.Source.Replace("'", "''"))' start --no-build --port $($hostEvidence.port)"
            $env:FUNCTIONS_WORKER_RUNTIME = 'dotnet-isolated'
            $env:AzureWebJobsStorage = 'UseDevelopmentStorage=true'
            $hostProcess = Start-Process -FilePath $shell `
                -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', $command) `
                -WorkingDirectory (Resolve-Path -LiteralPath $publishDirectory) `
                -RedirectStandardOutput $hostEvidence.stdout -RedirectStandardError $hostEvidence.stderr -PassThru
            $hostEvidence.started = $true
            $deadline = [DateTime]::UtcNow.AddSeconds($HostReadySeconds)
            $probe = $null
            do {
                if ($hostProcess.HasExited) {
                    $hostEvidence.failureReason = "Functions host exited with code $($hostProcess.ExitCode) before it was ready."
                    break
                }
                try {
                    $probe = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 `
                        -Uri "http://127.0.0.1:$($hostEvidence.port)$($expected.responses[0].path)"
                } catch {
                    $probe = $null
                    Start-Sleep -Milliseconds 500
                }
            } until ($probe -or [DateTime]::UtcNow -ge $deadline)
            $hostEvidence.ready = [bool]$probe
            if (-not $probe -and -not $hostEvidence.failureReason) {
                $hostEvidence.failureReason = "The Functions host was not ready within $HostReadySeconds seconds."
            }
            if ($hostEvidence.ready) {
                try {
                    $hostEvidence.registered = @(Get-HostFunctionNames -Port $hostEvidence.port)
                } catch [System.Net.Http.HttpRequestException] {
                    $hostEvidence.inventoryFailure = "Host function inventory is unavailable: $($_.Exception.Message)"
                } catch [System.Threading.Tasks.TaskCanceledException] {
                    $hostEvidence.inventoryFailure = 'Host function inventory request timed out.'
                } catch [FormatException] {
                    $hostEvidence.inventoryFailure = $_.Exception.Message
                }
                $hostEvidence.missing = @($expected.functions | Where-Object { $hostEvidence.registered -notcontains $_ })
                foreach ($contract in $expected.responses) {
                    try {
                        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 `
                            -Uri "http://127.0.0.1:$($hostEvidence.port)$($contract.path)"
                        $hostEvidence.responses += [ordered]@{
                            path        = [string]$contract.path
                            status      = [int]$response.StatusCode
                            body        = [string]$response.Content
                            contentType = [string]$response.Headers['Content-Type']
                            matches     = ([int]$response.StatusCode -eq [int]$contract.status -and
                                [string]$response.Content -ceq [string]$contract.body)
                        }
                    } catch {
                        $hostEvidence.responses += [ordered]@{
                            path = [string]$contract.path; status = 0; body = $_.Exception.Message
                            contentType = ''; matches = $false
                        }
                    }
                }
                Send-StorageInput -Contract $expected.storage -RequestId $requestId
                $storage.sent = $true
                $deadline = [DateTime]::UtcNow.AddSeconds($HostReadySeconds)
                do {
                    $observed = Read-StorageOutput -Contract $expected.storage -RequestId $requestId
                    if ($observed.ready) { break }
                    Start-Sleep -Milliseconds 500
                } until ([DateTime]::UtcNow -ge $deadline)
                $storage.ready = $observed.ready
                $storage.matches = $observed.matches
                $storage.body = $observed.body
                if (-not $storage.ready) { $storage.reason = 'No output blob appeared before the E2E timeout.' }
            }
        }
    }
} catch {
    $executionFailure = $_.Exception.Message
    $hostEvidence.failureReason = "Host or storage check failed: $executionFailure"
} finally {
    if ($hostProcess -and -not $hostProcess.HasExited) {
        try {
            $hostProcess.Kill($true)
            $hostProcess.WaitForExit()
        } catch {
            $cleanupFailure = "Host process $($hostProcess.Id): $($_.Exception.Message)"
        }
        Start-Sleep -Milliseconds 500
    }
    try {
        Remove-StorageCase -Owned $ownedStorage
    } catch {
        $cleanupFailure += " Storage: $($_.Exception.Message)"
    }
    $env:FUNCTIONS_WORKER_RUNTIME = $previousRuntime
    $env:AzureWebJobsStorage = $previousStorage
}
$storageLog = Add-Log -Name 'storage-e2e.json' -Content ($storage | ConvertTo-Json)

# --- Requirement checks ------------------------------------------------------

foreach ($Requirement in $definition.requirements) {
    if (-not $Requirement.check) { continue }
    switch ($Requirement.check) {
        'supported-tuple-current-tfm' {
            $sdkVersion = (Invoke-Recorded -Name 'dotnet-version' -File 'dotnet' -ArgumentList @('--version')).Output
            $evidence = @("baseline target framework: $baselineTfm", "submitted target framework: $currentTfm",
                "dotnet SDK: $sdkVersion", "operating system: $([Environment]::OSVersion.VersionString)",
                "AzureFunctionsVersion in project: $([regex]::Match($projectText, '<AzureFunctionsVersion>\s*(?<v>[^<]+)').Groups['v'].Value)")
            if (-not $projectPresent) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason "$project is missing from the submitted workspace."
            } elseif ($currentTfm -ne $baselineTfm) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason "The model phase must keep the current target framework $baselineTfm; the submission uses $currentTfm."
            } else {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            }
        }
        'restore-and-build' {
            if (-not $projectPresent) {
                Set-Result -Requirement $Requirement -Status 'fail' -Reason "$project is missing from the submitted workspace."
            } elseif ($restore.ExitCode -ne 0) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence @($restore.Command, $restore.Log) `
                    -Reason "Restore exited with $($restore.ExitCode)."
            } elseif ($build.ExitCode -ne 0) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence @($build.Command, $build.Log) `
                    -Reason "Build exited with $($build.ExitCode)."
            } else {
                Set-Result -Requirement $Requirement -Status 'pass' `
                    -Evidence @($restore.Command, $restore.Log, $build.Command, $build.Log)
            }
        }
        'existing-tests' {
            if ($testProjects.Count -eq 0) {
                Set-Result -Requirement $Requirement -Status 'not-applicable' `
                    -Evidence @("project inventory: $((@($projectInventory | ForEach-Object { $_.Name })) -join ', ')") `
                    -Reason 'The inventory contains no unit or local test project; end-to-end evidence is recorded separately under DI-05.'
            } else {
                $failedTests = @($testRuns | Where-Object { $_.ExitCode -ne 0 })
                Set-Result -Requirement $Requirement -Status ($failedTests.Count -eq 0 ? 'pass' : 'fail') `
                    -Evidence @($testRuns | ForEach-Object { "$($_.Command) -> exit $($_.ExitCode) ($($_.Log))" }) `
                    -Reason ($failedTests.Count -eq 0 ? '' : "$($failedTests.Count) existing test command(s) failed.")
            }
        }
        'host-registration' {
            $evidence = @("inventory endpoint: http://127.0.0.1:$($hostEvidence.port)/admin/functions",
                "registered: $((@($hostEvidence.registered)) -join ', ')",
                "expected: $((@($expected.functions)) -join ', ')")
            if (-not $hostEvidence.ready) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence $evidence `
                    -Reason ($hostEvidence.failureReason ? $hostEvidence.failureReason : 'The Functions host check could not run.')
            } elseif ($hostEvidence.inventoryFailure) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence $evidence `
                    -Reason $hostEvidence.inventoryFailure
            } elseif (@($hostEvidence.missing).Count -ne 0) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason "Expected function(s) were not registered: $((@($hostEvidence.missing)) -join ', ')."
            } elseif (-not $storage.available) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence $evidence -Reason $storage.reason
            } elseif (-not $storage.matches) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence ($evidence + @($storageLog)) `
                    -Reason 'Storage trigger execution did not meet the contract.'
            } else {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            }
        }
        'trigger-e2e' {
            $evidence = @($hostEvidence.responses | ForEach-Object {
                "$($_.path) -> status $($_.status), body '$($_.body)', content-type '$($_.contentType)'" })
            if (-not $hostEvidence.ready) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence $evidence `
                    -Reason ($hostEvidence.failureReason ? $hostEvidence.failureReason : 'No running host: the agreed HTTP paths could not be exercised.')
            } elseif (-not $storage.available) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence ($evidence + @($storageLog)) -Reason $storage.reason
            } elseif (-not $storage.matches -or @($hostEvidence.responses | Where-Object { -not $_.matches }).Count -ne 0) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason 'At least one agreed trigger path did not return the original business output.'
            } else {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            }
        }
        'explicit-worker-package' {
            $worker = @(Get-PackageReference -Id 'Microsoft.Azure.Functions.Worker')
            $evidence = @($worker | ForEach-Object { "$($_.File): $($_.Id) $($_.Version)" })
            if ($worker.Count -eq 0) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence @("declared packages: $((@($declaredPackages)) -join ', ')") `
                    -Reason 'The application does not declare Microsoft.Azure.Functions.Worker explicitly.'
            } elseif ($build -and $build.ExitCode -eq 0) {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence ($evidence + @("resolved by: $($build.Command) ($($build.Log))"))
            } else {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence $evidence `
                    -Reason 'The declaration exists but no successful build proves that it resolves compatibly.'
            }
        }
        'legacy-surface-migrated' {
            $legacyPackages = @($declaredPackages | Where-Object {
                $_ -like 'Microsoft.Azure.WebJobs*' -or $_ -eq 'Microsoft.NET.Sdk.Functions' -or
                $_ -like 'Microsoft.Azure.Functions.Extensions*' })
            $legacySource = @($sources | Where-Object {
                $text = Get-Content -LiteralPath $_.FullName -Raw
                $text -match 'Microsoft\.Azure\.WebJobs' -or $text -match '\[FunctionName\(' -or
                $text -match 'Microsoft\.Azure\.Functions\.Extensions' -or $text -match 'IAsyncCollector<' -or
                $text -match 'IBinder\b'
            } | ForEach-Object { $_.FullName })
            $evidence = @("declared packages: $((@($declaredPackages)) -join ', ')",
                "application sources scanned, excluding bin/obj generated host-extension output: $((@($sources | ForEach-Object { $_.Name })) -join ', ')")
            if ($legacyPackages.Count -ne 0 -or $legacySource.Count -ne 0) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence ($evidence + $legacySource) `
                    -Reason "Direct legacy in-process surface remains: $((@($legacyPackages + $legacySource)) -join ', ')."
            } else {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            }
        }
        'function-signatures' {
            $name = @($expected.functions)[0]
            $escaped = [regex]::Escape($name)
            $hasAttribute = $sourceText -match "\[Function\(\s*(""$escaped""|nameof\($escaped\))\s*\)\]"
            $trigger = [regex]::Match($sourceText, '\[HttpTrigger\((?<args>[^\]]*)\]')
            $arguments = $trigger.Success ? $trigger.Groups['args'].Value : ''
            $routeMatch = [regex]::Match($arguments, 'Route\s*=\s*"(?<route>[^"]*)"')
            $route = $routeMatch.Success ? $routeMatch.Groups['route'].Value : ''
            $anonymous = $arguments -match 'AuthorizationLevel\.Anonymous'
            $getMethod = $arguments -match '"get"'
            $expectedRoute = ([string]$expected.route) -replace '^api/', ''
            $evidence = @("[Function] attribute for $($name): $hasAttribute", "HttpTrigger arguments: $arguments",
                "route: '$route' (expected '$expectedRoute')", "anonymous: $anonymous", "GET: $getMethod")
            if ($hasAttribute -and $trigger.Success -and $anonymous -and $getMethod -and $route -eq $expectedRoute) {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            } else {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason 'The isolated function attribute, route, authorization level, or HTTP method does not preserve the baseline contract.'
            }
        }
        'worker-startup' {
            $startup = @($sources | Where-Object {
                $text = Get-Content -LiteralPath $_.FullName -Raw
                $text -match 'FunctionsApplication\.CreateBuilder' -or $text -match 'ConfigureFunctionsWorkerDefaults' -or
                $text -match 'ConfigureFunctionsWebApplication' -or $text -match 'HostBuilder\(\)'
            } | ForEach-Object { $_.Name })
            $legacyStartup = $sourceText -match 'FunctionsStartup'
            $evidence = @("worker startup sources: $((@($startup)) -join ', ')", "FunctionsStartup present: $legacyStartup")
            if ($startup.Count -ne 0 -and -not $legacyStartup) {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            } else {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason 'No isolated worker host startup was found, or an in-process FunctionsStartup remains.'
            }
        }
        'http-integration-coherent' {
            $aspNet = @(Get-PackageReference -Id 'Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore').Count -ne 0
            $builtIn = @(Get-PackageReference -Id 'Microsoft.Azure.Functions.Worker.Extensions.Http').Count -ne 0
            $aspNetTypes = $sourceText -match 'HttpRequest\b' -or $sourceText -match 'IActionResult'
            $builtInTypes = $sourceText -match 'HttpRequestData' -or $sourceText -match 'HttpResponseData'
            $webApplication = $sourceText -match 'ConfigureFunctionsWebApplication'
            $evidence = @("ASP.NET Core integration package: $aspNet", "built-in HTTP extension package: $builtIn",
                "ASP.NET Core request types used: $aspNetTypes", "worker HTTP data types used: $builtInTypes",
                "web application startup: $webApplication")
            $coherent = ($aspNet -and $webApplication -and ($aspNetTypes -or $builtInTypes)) -or
                ($builtIn -and $builtInTypes -and -not $aspNetTypes)
            if ($coherent) {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            } else {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason 'The HTTP extension package, request and response types, and startup do not describe one coherent supported HTTP integration.'
            }
        }
        'output-contract-preserved' {
            $baselineSource = (Test-Path -LiteralPath $baselineSourceFile) ?
                (Get-Content -LiteralPath $baselineSourceFile -Raw) : ''
            $wrongMedia = @($hostEvidence.responses | Where-Object { $_.contentType -and $_.contentType -notmatch 'text/plain' })
            $evidence = @("baseline contract: $((@($expected.responses | ForEach-Object { "$($_.path) -> $($_.status) '$($_.body)'" })) -join '; ')",
                "observed: $((@($hostEvidence.responses | ForEach-Object { "$($_.path) -> $($_.status) '$($_.body)' $($_.contentType)" })) -join '; ')",
                "baseline fixture: $baselineSourceFile ($($baselineSource.Length) characters)")
            if (-not $hostEvidence.ready) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence $evidence `
                    -Reason 'Without a running host the output contract cannot be compared with the baseline fixture.'
            } elseif (-not $storage.available) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence ($evidence + @($storageLog)) -Reason $storage.reason
            } elseif (-not $storage.matches -or @($hostEvidence.responses | Where-Object { -not $_.matches }).Count -ne 0 -or $wrongMedia.Count -ne 0) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason 'The response body or media type differs from the baseline plain-text contract.'
            } else {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            }
        }
        'runtime-configuration' {
            $hasLocalSettings = Test-Path -LiteralPath 'local.settings.json'
            $localSettings = $hasLocalSettings ?
                (Get-Content -LiteralPath 'local.settings.json' -Raw | ConvertFrom-Json) : $null
            $runtime = $localSettings ? [string]$localSettings.Values.FUNCTIONS_WORKER_RUNTIME : ''
            $instructions = @(Get-RuntimeInstruction -Root (Get-Location).Path)
            $workerConfigPath = Join-Path $publishDirectory 'worker.config.json'
            $workerLanguage = (Test-Path -LiteralPath $workerConfigPath) ?
                [string](Get-Content -LiteralPath $workerConfigPath -Raw | ConvertFrom-Json).description.language : ''
            $currentHostText = (Test-Path -LiteralPath 'host.json') ? (Get-Content -LiteralPath 'host.json' -Raw) : ''
            $baselineHostText = (Test-Path -LiteralPath $baselineHost) ? (Get-Content -LiteralPath $baselineHost -Raw) : ''
            $hostVersion = [regex]::Match($currentHostText, '"version"\s*:\s*"(?<v>[^"]+)"').Groups['v'].Value
            $baselineVersion = [regex]::Match($baselineHostText, '"version"\s*:\s*"(?<v>[^"]+)"').Groups['v'].Value
            $connectionCount = [regex]::Matches(
                $sourceText, 'Connection\s*=\s*"AzureWebJobsStorage"').Count
            $evidence = @("local.settings.json present: $hasLocalSettings; FUNCTIONS_WORKER_RUNTIME: '$runtime'",
                "documented FUNCTIONS_WORKER_RUNTIME=dotnet-isolated in: $(($instructions -join ', ') ?? '')",
                "binding references to AzureWebJobsStorage: $connectionCount",
                "published worker language: '$workerLanguage'",
                "host.json version: '$hostVersion' (baseline '$baselineVersion')",
                "published host.json present: $(Test-Path -LiteralPath (Join-Path $publishDirectory 'host.json'))")
            # A real local.settings.json must have the correct value. Without it, a written instruction is enough.
            $localRuntimeOk = $hasLocalSettings ? ($runtime -eq 'dotnet-isolated') : ($instructions.Count -gt 0)
            $problems = @()
            if ($hasLocalSettings -and -not $localRuntimeOk) {
                $problems += "local.settings.json sets FUNCTIONS_WORKER_RUNTIME to '$runtime', not dotnet-isolated."
            } elseif (-not $localRuntimeOk) {
                $problems += 'No local.settings.json, settings example, README, or plan states FUNCTIONS_WORKER_RUNTIME=dotnet-isolated.'
            }
            if ($connectionCount -lt 3) { $problems += "Only $connectionCount binding(s) use the AzureWebJobsStorage connection; 3 are expected." }
            if ($workerLanguage -ne 'dotnet-isolated') { $problems += "The published worker language is '$workerLanguage', not dotnet-isolated." }
            if ($hostVersion -ne $baselineVersion) { $problems += "host.json version '$hostVersion' differs from the baseline '$baselineVersion'." }
            if (-not $publish -or $publish.ExitCode -ne 0) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence $evidence `
                    -Reason 'No publish artifact: the effective worker runtime configuration could not be read.'
            } elseif ($problems.Count -eq 0) {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            } else {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence -Reason ($problems -join ' ')
            }
        }
        'project-sdk-effective' {
            $sdkMatch = [regex]::Match($projectText, '<Project\s+Sdk="(?<sdk>[^"]+)"')
            $sdkValue = $sdkMatch.Success ? $sdkMatch.Groups['sdk'].Value : ''
            $globalJson = (Test-Path -LiteralPath 'global.json') ?
                (Get-Content -LiteralPath 'global.json' -Raw | ConvertFrom-Json) : $null
            $globalSdk = $globalJson ? [string]$globalJson.'msbuild-sdks'.'Azure.Functions.Sdk' : ''
            $obsolete = @($declaredPackages | Where-Object {
                $_ -eq 'Microsoft.Azure.Functions.Worker.Sdk' -or $_ -eq 'Microsoft.NET.Sdk.Functions' })
            $indexing = $projectText -match 'FunctionsEnableWorkerIndexing'
            $evidence = @("project SDK: '$sdkValue'", "global.json Azure.Functions.Sdk: '$globalSdk'",
                "obsolete SDK packages: $((@($obsolete)) -join ', ')", "FunctionsEnableWorkerIndexing present: $indexing",
                "build evidence: $($build ? $build.Log : 'none')")
            $sdkOk = ($sdkValue -match '^Azure\.Functions\.Sdk/.+$') -or ($sdkValue -eq 'Azure.Functions.Sdk' -and $globalSdk)
            if ($sdkOk -and $obsolete.Count -eq 0 -and -not $indexing -and $build -and $build.ExitCode -eq 0) {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            } elseif (-not $build -or $build.ExitCode -ne 0) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason 'No successful build proves that the declared project SDK and build setup resolve.'
            } else {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason 'The effective project SDK is not a resolvable Azure.Functions.Sdk, or an obsolete SDK package or worker indexing property remains.'
            }
        }
        'packaging-and-secrets' {
            $published = ($publish -and $publish.ExitCode -eq 0) ?
                @(Get-ChildItem -Path $publishDirectory -File -Recurse | ForEach-Object { $_.Name }) : @()
            $secretPattern = 'AccountKey=|SharedAccessSignature=|DefaultEndpointsProtocol=[^"]*AccountKey'
            $secretFiles = @(Get-ChildItem -Path . -File -Recurse |
                Where-Object { $_.FullName -notmatch '[\\/](bin|obj|grading-evidence)[\\/]' -and
                    $_.Extension -in @('.json', '.cs', '.props', '.csproj', '.yml', '.yaml') } |
                Where-Object { ((Get-Content -LiteralPath $_.FullName -Raw) ?? '') -match $secretPattern } |
                ForEach-Object { $_.Name })
            $ignore = (Test-Path -LiteralPath '.gitignore') ? (Get-Content -LiteralPath '.gitignore' -Raw) : ''
            $localIgnored = -not (Test-Path -LiteralPath 'local.settings.json') -or $ignore -match 'local\.settings\.json'
            $evidence = @("published files: $((@($published)) -join ', ')",
                "local.settings.json in publish output: $([bool](@($published) -contains 'local.settings.json'))",
                "local.settings.json absent or ignored: $localIgnored",
                "files matching secret patterns: $((@($secretFiles)) -join ', ')")
            if (-not $publish -or $publish.ExitCode -ne 0) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence $evidence `
                    -Reason 'No publish artifact: packaging could not be inspected.'
            } elseif ((@($published) -notcontains 'host.json') -or (@($published) -contains 'local.settings.json') -or
                $secretFiles.Count -ne 0 -or -not $localIgnored) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence $evidence `
                    -Reason 'The publish artifact lacks host.json, contains local settings, or a workspace file carries secret-shaped values.'
            } else {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence $evidence
            }
        }
        'binding-contracts' {
            $otherTriggers = @([regex]::Matches($sourceText, '\[(?<trigger>[A-Za-z]+Trigger)\(') |
                ForEach-Object { $_.Groups['trigger'].Value } | Sort-Object -Unique |
                Where-Object { $_ -ne 'HttpTrigger' })
            $durable = $sourceText -match 'DurableTask' -or $sourceText -match 'IDurableOrchestrationContext' -or
                $sourceText -match 'TaskOrchestrationContext'
            $evidence = @("non-HTTP trigger attributes: $((@($otherTriggers)) -join ', ')",
                "Durable Functions surface present: $durable",
                "projects in workspace: $((@($projectInventory | ForEach-Object { $_.Name })) -join ', ')")
            if (-not $storage.available -or -not $hostEvidence.ready) {
                Set-Result -Requirement $Requirement -Status 'blocked' -Evidence ($evidence + @($storageLog)) `
                    -Reason 'The agreed storage binding path could not run.'
            } elseif ($otherTriggers -notcontains 'QueueTrigger' -or
                $sourceText -notmatch '\[BlobInput\(' -or $sourceText -notmatch '\[BlobOutput\(' -or
                -not $storage.matches) {
                Set-Result -Requirement $Requirement -Status 'fail' -Evidence ($evidence + @($storageLog)) `
                    -Reason 'The extension trigger/input/output binding surface or original storage output was not preserved.'
            } else {
                Set-Result -Requirement $Requirement -Status 'pass' -Evidence ($evidence + @($storageLog)) `
                    -Reason 'Queue trigger, blob input and blob output completed locally. This does not prove Azure integration.'
            }
        }
        default {
            throw "Unknown deterministic check '$($Requirement.check)' for $($Requirement.id)."
        }
    }
}

foreach ($Requirement in $definition.requirements) {
    if ($state.Contains($Requirement.id)) { continue }
    if ($Requirement.id -eq 'DI-10') {
        Set-Result -Requirement $Requirement -Status ($sources.Count -gt 0 ? 'pass' : 'blocked') `
            -Evidence @('Source review is assigned to the LLM judge. No runtime log assertion is made.') `
            -Reason 'This status only permits source review. DI-10 is not accepted until the judge passes.'
    } elseif ($Requirement.id -eq 'DI-POST-01' -and $currentTfm -and $baselineTfm -and $currentTfm -ne $baselineTfm) {
        Set-Result -Requirement $Requirement -Status 'fail' `
            -Evidence @("baseline target framework: $baselineTfm", "submitted target framework: $currentTfm") `
            -Reason 'The target framework changed although this trial requested no language handoff and no approved destination exists.'
    } else {
        Set-Result -Requirement $Requirement -Status 'not-applicable' `
            -Evidence @("requested language handoff: $($expected.languageHandoff)") -Reason ([string]$Requirement.applicability)
    }
}

$requirements = @($definition.requirements | ForEach-Object { $state[$_.id] })
$failed = @($requirements | Where-Object { $_.status -eq 'fail' })
$blocked = @($requirements | Where-Object { $_.status -eq 'blocked' })
$overall = ($failed.Count -ne 0 -or $cleanupFailure -or $executionFailure) ? 'fail' : ($blocked.Count -ne 0 ? 'blocked' : 'pass')
$report = [ordered]@{
    scenario     = $definition.scenario
    skill        = $definition.skill
    generatedUtc = [DateTime]::UtcNow.ToString('o')
    overall      = $overall
    authority    = 'Deterministic statuses are authoritative. A judge may lower a pass it can disprove from this evidence; it can never raise fail, blocked, or missing evidence to pass.'
    coverage     = 'Runtime log output is not assessed. DI-10 is a source-only judge gate, not a runtime logging pass.'
    environment  = [ordered]@{
        operatingSystem = [Environment]::OSVersion.VersionString
        powerShell      = $PSVersionTable.PSVersion.ToString()
        publishOutput   = $publishDirectory
        hostPort        = $hostEvidence.port
    }
    logs         = $logs
    cleanupFailure = $cleanupFailure
    executionFailure = $executionFailure
    requirements = $requirements
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'checklist.json') -Encoding utf8

$summary = (@($requirements | ForEach-Object { "$($_.id): $($_.status)" })) -join '; '
if ($overall -ne 'pass') {
    Write-Error "Definition of done did not pass: $summary"
    exit 1
}
Write-Output "Deterministic definition-of-done checks passed. $summary"
