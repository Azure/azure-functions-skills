# Fixed review basis: Python HTTP streaming

Sources checked on 2026-09-15:

- [HTTP streams reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger?pivots=programming-language-python#http-streams-1): Python v2, Functions runtime 4.34.1 or later; add azurefunctions-extensions-http-fastapi and import its Request and StreamingResponse. All HTTP functions in an app must use the extension-compatible model.
- [Python 3.13+ updates](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python#python-313-updates): Python 3.13+ HTTP streaming needs no special app setting. For this Python 3.12 fixture, the HTTP reference's PYTHON_ENABLE_INIT_INDEXING=1 setting applies.
- [Historical announcement](https://techcommunity.microsoft.com/blog/azurecompute/azure-functions-support-for-http-streams-in-python-is-now-in-preview/4146697): context only. Do not treat its Preview label as current guidance.

Keep this app on Python 3.12 and current Functions v4. app-settings.json is a
non-secret fixture record, not a deployment file. Preserve its unrelated values.
Do not require local.settings.json or an Azure change.

Count remains anonymous GET /api/count, HTTP 200 text/event-stream, with five
ordered count events from events.count_events. Forward them as they arrive.
Do not eagerly buffer them or block async code with time.sleep.
Echo remains function-authorized POST /api/echo. It returns the string message
as text/plain UTF-8 with status 200, including an empty string. Invalid JSON
returns 400 "Invalid JSON". Missing/non-string message or a non-object body
returns 422 "Missing message". Preserve both registered function names.

All HTTP handlers use the extension Request. A small response can use the
extension's regular Response or JSONResponse when that preserves its contract;
not every response needs a StreamingResponse. func.HttpRequest/HttpResponse
cannot remain in one endpoint while another uses the streaming extension.

The offline grader checks real SDK registration and invokes real ASGI
responses. It controls the event source and requires each previous event to
reach ASGI send before the next item is requested. It also checks Echo's body,
status and request parsing. Judge the submitted producer separately: replacing
the source during grading does not verify the submitted producer itself.
No host indexing, auth enforcement or network/proxy streaming is established.
