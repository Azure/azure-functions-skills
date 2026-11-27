# Azure Functions App skill: evaluation scenarios

Kept outside the skill payload so agents under test do not read the checklist.
Vary the plan (Flex Consumption, Premium, Dedicated), OS, and language between runs to check that
the skill is not tuned to one app.

## Scenarios

Live evaluation targets for this skill. Use a dedicated test app with one HTTP function that can
return success and a deliberate error. Every write restores its previous value unless the
scenario says otherwise.

| # | Mode | Scenario | Evidence to verify |
| --- | --- | --- | --- |
| 1 | Authoring | Create a Function App and deploy code | authoring.md "Create a new Function App" and "Deploy code": What-If shown before approval, deployment tracked to `status` 4, expected functions listed |
| 2 | Inspection | Find the app across subscriptions | ARM-CORE resolution: exact match used; ambiguity leads to a question, not a guess |
| 3 | Inspection | Summarize runtime, plan, and configuration | inspection.md §1: plan classified correctly |
| 4 | Inspection | List functions, triggers, and bindings | inspection.md §3 |
| 5 | Inspection | Show app settings and keys with secrets redacted | inspection.md §2–§3: no secret value printed |
| 6 | Inspection | Investigate deployment history and a failed deployment log | inspection.md §4 |
| 7 | Inspection | Check host status and Resource Health | inspection.md §5 |
| 8 | Inspection | Find executions and failures in metrics and Application Insights | inspection.md §6–§7: queries filtered by this app's Application Insights resource |
| 9 | Inspection | Find recent changes in the Activity Log | inspection.md §8 |
| 10 | Authoring | Add, verify, and restore a test app setting | full-collection merge; other settings unchanged |
| 11 | Authoring | Change, verify, and restore CORS | full list sent |
| 12 | Authoring | Disable and re-enable a function | `isDisabled` read back |
| 13 | Operations | Restart and confirm recovery | host status `Running` after restart |
| 14 | Operations | Sync triggers and confirm the function list | operations.md |
| 15 | Operations | Invoke the HTTP function and match it to execution logs | response and `AppRequests` entry correlate |
| 16 | Authoring | Change, verify, and restore Flex scale settings (maximum instances, instance memory) | authoring.md "Flex Consumption scale and runtime": full `functionAppConfig` sent |
| 17 | Inspection | Observe actual scale under an approved short HTTP load | inspection.md §6a: peak instances and time from metrics and Application Insights, compared with the configured maximum |
| 18 | Authoring | Enable managed identity and verify an identity-based storage connection | authoring.md "Managed identity": role assignment approved separately; host `Running` with `AzureWebJobsStorage__accountName` |
| 19 | Authoring | VNet integration (outbound) | networking.md §3–§4: integration subnet and delegation read back; a test function reaches an approved private target |
| 20 | Authoring | Private endpoint (inbound) | networking.md §7: from an authorized network the host name resolves to the private IP and the function responds; public access checked separately |
| 21 | Inspection | Diagnose a connectivity failure | networking.md §2: DNS, network access, and authorization failures distinguished with evidence; inconclusive results reported |
| 22 | Authoring | Deploy through a private network | SCM-CORE and authoring.md "Deploy code": from an authorized environment, SCM reachable and the expected functions indexed |
| 23 | Authoring | Add a Key Vault reference setting on a slot, then remove it | `settings set --slot`: reference status reported (`KeyVaultReferenceUnresolved` until the identity has access) |
| 24 | Operations | Swap a staging slot into production and back | operations.md: preview, approval, and verification of both slots |
| 25 | Authoring | Add and remove a connection string | `settings set --connection-string`: type kept, other entries unchanged |

Scenarios 19–22 need a Premium, Dedicated, or Flex Consumption app and a VNet in the same region.
Scenario 17 sends synthetic load; agree on request count and duration first.

Agree on the target, budget, trial count, and resource-retention policy before a live evaluation.
Network changes and deployment need explicit approval. Do not change access rules to bypass a
connectivity failure.
