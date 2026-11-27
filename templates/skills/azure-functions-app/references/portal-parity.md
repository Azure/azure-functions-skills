# Portal Parity Map

The v2 goal: every routine Azure Functions portal task can be done from the coding agent.
"Gap" means this skill does not cover the blade yet.

| Portal blade or action | Mode | Reference section |
| --- | --- | --- |
| Function App list, Overview | Inspection | inspection.md §1 |
| Functions list, function detail, Integration (bindings) | Inspection | inspection.md §3 |
| Function Keys, App keys (view) | Inspection | inspection.md §3 |
| Environment variables (view) | Inspection | inspection.md §2 |
| Configuration > General settings (view) | Inspection | inspection.md §1 |
| Deployment Center logs | Inspection | inspection.md §4 |
| Diagnose and solve problems | Inspection | inspection.md §5 |
| Resource Health | Inspection | inspection.md §5 |
| Scale out (observed instances) | Inspection | inspection.md §6a |
| Metrics | Inspection | inspection.md §6 |
| Logs, Application Insights failures/performance | Inspection | inspection.md §7 |
| Activity log | Inspection | inspection.md §8 |
| Environment variables (edit), connection strings | Authoring | authoring.md "App settings", "Connection strings" |
| Function Enable / Disable | Authoring | authoring.md "Enable or disable one function" |
| CORS, General settings (edit) | Authoring | authoring.md "Site configuration and CORS" |
| Scale and concurrency (Flex) | Authoring | authoring.md "Flex Consumption scale and runtime" |
| Scale out (Premium / Dedicated) | Authoring | authoring.md "Premium and Dedicated scale" |
| Identity | Authoring | authoring.md "Managed identity" |
| Function Keys, App keys (add, renew, delete) | Authoring | authoring.md "Keys" |
| Deployment slots (add, delete) | Authoring | authoring.md "Deployment slots" |
| Deployment Center (push deploy) | Authoring | authoring.md "Deploy code" |
| Create Function App | Authoring | authoring.md "Create a new Function App" |
| Delete | Authoring | authoring.md "Delete a Function App" |
| Start, Stop, Restart | Operations | operations.md |
| Swap | Operations | operations.md |
| Code + Test / Test and Run | Operations | operations.md |
| Log stream | Gap | Use narrow Application Insights queries (inspection.md §7) |
| Networking (view, connectivity diagnosis) | Inspection | networking.md §1, §2 |
| Networking > VNet integration, outbound routing | Authoring | networking.md §3 to §5 |
| Networking > Access restrictions, public network access | Authoring | networking.md §6 |
| Networking > Private endpoints | Authoring | networking.md §7 |
| Hybrid connections, NSG / route table / NAT gateway edits | Gap | networking.md "Not covered" |
| Authentication (Easy Auth) | Gap | Not covered |
| Custom domains, certificates | Gap | Not covered |
| Backups, Advanced tools (Kudu console) | Gap | Not covered |
| Durable Functions monitoring | Gap | Planned as a separate capability skill |
