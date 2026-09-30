# azure-functions-update plan

- Plan revision: 3
- Scenario: dotnet-isolated (C# in-process to .NET isolated worker)
- App: `UpgradeApp.csproj`, target framework `net8.0`
- Agreed scope: Functions model and configuration only. Keep `net8.0`.
- Language stage: not requested. Hosting plan change: not requested.
- Current phase: model/config migration
- Last accepted checkpoint: step 3
- Resume point: step 4, dotnet-isolated step 2 (project SDK and packages)

| Step | Status | Notes |
| --- | --- | --- |
| 1. Save an initial plan with state | done | This file |
| 2. Check tools, environment, and restore paths | done | .NET SDK and Core Tools found; package restore works |
| 3. Inventory, select the scenario, and agree scope | done | 2 functions: `Hello` (HTTP), `QueueGreeting` (queue and blob); `FunctionsStartup` DI |
| 4. Migrate the Functions model and configuration | pending | Start at dotnet-isolated step 2 |
| 5. Verify behavior | pending | |
| 6. Review the model/config phase | pending | |
| 7. Report the phase result | pending | |
| 8. Hand off the separate language stage | not-applicable | No language stage requested |
| 9. Apply Functions follow-up after the language stage | not-applicable | No language stage requested |
| 10. Perform the final review | pending | |
| 11. Deliver the final report | pending | |
