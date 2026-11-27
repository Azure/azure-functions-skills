# Operations Mode (runtime control)

Read [core/ARM-CORE.md](core/ARM-CORE.md) and [core/COMMON-CLI.md](core/COMMON-CLI.md) first.
For running a function also read [core/HOST-CORE.md](core/HOST-CORE.md).

Follow the Authoring "Write protocol": resolve, read state, present plan and tier, get approval,
call, verify. Operations calls return quickly; verify by reading state, not by the status code.

| Operation | Tier | Request | Verify |
| --- | --- | --- | --- |
| Restart | R1 | Tool: `restart --app <app> --approve` (sends once, verifies). REST: `POST {site}/restart?{av}&softRestart=false&synchronous=false` | `GET {site}?{av}` → `state` `Running`; host status |
| Stop | R2 | `POST {site}/stop?{av}` | `state` `Stopped` |
| Start | R1 | `POST {site}/start?{av}` | `state` `Running`; host status |
| Sync triggers | R1 | `POST {site}/syncfunctiontriggers?{av}` | `GET {site}/functions?{av}` |
| Swap slot into production | R2 | Tool: `slots swap --app <app> --slot <source> --check-function <http function> --approve` (pre-checks, sends once, verifies, re-syncs a slot whose keys are rejected). REST: `POST {site}/slots/{sourceSlot}/slotsswap?{av}` body `{"targetSlot":"production","preserveVnet":true}` | production `slotSwapStatus`; both hosts Running; deployments on both SCM hosts; Key Vault references; the function on both slots |
| Swap two slots | R1 | Tool: `slots swap ... --target <other slot>`. REST: `POST {site}/slots/{sourceSlot}/slotsswap?{av}` body `{"targetSlot":"<other slot>","preserveVnet":true}` | both slots |
| Run a non-HTTP function | R1 | Tool: `functions invoke --app <app> --function <name> [--body <input>] --approve`. REST: host admin `POST /admin/functions/{functionName}` (HOST-CORE) | `202`, then logs (Inspection "Logs") |
| Call an HTTP function | R0 for GET, else R1 | Tool: `functions invoke --app <app> [--slot <s>] --function <name> [--query k=v] [--path /api/x/1]` (key fetched through ARM, never printed). REST: function `invoke_url_template` (HOST-CORE) | response status, time, and body |

Slot paths: use `{slotSite}` in place of `{site}` to restart, stop, start, or sync a slot.

Rules:

- **Stop** makes every trigger and endpoint unavailable. State the outage before approval.
- **Swap into production** changes what users run. Before approval, run `slots list` and show the
  source slot's last deployment, slot-sticky settings (`settings set --sticky` to add one), and the
  rollback: the same swap again (source slot → `production`).
- Slots created with `--configuration-source` copy `WEBSITE_CONTENTSHARE`; `slots list` reports
  `SharedContentShare`. Give each slot its own share (sticky) before deploying to it.
- Each slot has its own managed identity; Key Vault references on a slot need their own role
  assignment. `slots swap` reports `KeyVaultReferenceUnresolved` per slot.
- `KeyRejected` (401 with a key from ARM) after a swap or deployment: sync that slot's triggers
  once (`POST {slotSite}/syncfunctiontriggers`), wait 20 seconds, and call again. Restarting does
  not fix it. Never print key values while investigating; `functions invoke` keeps them hidden.
- Always call swap on the **source slot** path with `production` as `targetSlot`. Do not call
  `{site}/slotsswap` with a slot as `targetSlot`: that warms up production with the slot's
  settings instead of warming up the slot.
- Swap, stop, and run are not idempotent. If a call times out or returns `5xx`, re-read state
  before deciding anything, and get approval again before repeating it.
- Running a function processes real data and may trigger side effects (messages, writes, emails).
  Ask for the input payload and confirm side effects. `202` means queued, not succeeded.
- Do not restart repeatedly to fix a failing app. After one restart, switch to Inspection
  (Health, Logs, Diagnose and solve) and report findings.
- Flex Consumption has no slots and does not support Kudu log streaming. Say so if asked.
