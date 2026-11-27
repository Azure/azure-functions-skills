# Functions Host Admin Core

Rules for calls to the Functions host admin API on the app's own host name.

## Host name and key

- Host: `https://<properties.defaultHostName>` from `{site}` (slot: from `{slotSite}`).
- Admin calls need the **master key**: `POST {site}/host/default/listkeys?{av}` → `masterKey`.
  For a slot, use `POST {slotSite}/host/default/listkeys?{av}`; slot keys differ.
- Send it only in the `x-functions-key` header. Never put keys in a URL query string, a file in the
  repository, a log, or chat output.
- The master key grants full admin access. Fetch it immediately before the call, keep it in a
  shell variable only, and unset the variable afterward.

## Endpoints used by this skill

| Purpose | Request |
| --- | --- |
| Host status | `GET /admin/host/status` |
| Run a non-HTTP-triggered function | `POST /admin/functions/{functionName}` with `Content-Type: application/json` and body `{"input":"<string>"}` |

Rules:

- `202 Accepted` from `/admin/functions/{functionName}` means queued, not succeeded. Confirm the
  outcome with the logs queries in [../inspection.md](../inspection.md).
- HTTP-triggered functions are invoked through their normal URL, not this admin endpoint. Use the
  function `invoke_url_template` from `GET {site}/functions/{functionName}?{av}` and, when the auth
  level is `function`, a function key sent as `x-functions-key`.
- `403` with `Ip Forbidden` means access restrictions block the caller. Report it; do not change
  restrictions to work around it.
- Admin endpoints are unreachable when the app is stopped or has no public network access.
