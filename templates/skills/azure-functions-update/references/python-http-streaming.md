# Python HTTP Streaming

Use this reference to enable streaming in a Python v2 Functions app.

1. Read [HTTP streams](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger?pivots=programming-language-python#http-streams-1) and [Python 3.13+ updates](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python#python-313-updates). Use current support guidance, not the Preview label or old version examples in the [2024 announcement](https://techcommunity.microsoft.com/blog/azurecompute/azure-functions-support-for-http-streams-in-python-is-now-in-preview/4146697).
2. Confirm Python programming model v2, a currently supported Python version, and Functions runtime 4.34.1 or later. The historical Python 3.8 feature minimum is not a recommendation to use an unsupported language version.
3. Add `azurefunctions-extensions-http-fastapi` to `requirements.txt`; keep `azure-functions`. Import `Request` and `StreamingResponse` from `azurefunctions.extensions.http.fastapi`.
4. For Python 3.12 and earlier, set `PYTHON_ENABLE_INIT_INDEXING` to `"1"` in app settings and local settings. Python 3.13 and later do not require a special app setting for HTTP streaming. Do not upgrade Python only to avoid this setting. Preserve unrelated settings.
5. Migrate **all HTTP functions in the same app**, including blueprints. Mixed old and streaming HTTP models are not supported. Use the extension `Request` and `req.query_params` instead of `req.params`. For JSON bodies, `await req.json()` is the usual replacement for `req.get_json()`; check the existing parsing and error contracts where the app depends on them. Adapt other request uses as needed. Keep routes, methods, authorization and function names.
6. Return `StreamingResponse(generator, media_type="text/event-stream")` for SSE. The generator must yield events as they become available. Do not collect it into a list or join all events before returning. Use async waits rather than `time.sleep` in async code. Handle cancellation and resource cleanup for long-lived streams. For small non-streamed bodies in other endpoints, use compatible `Response` or `JSONResponse` from the same extension; those endpoints do not need artificial chunking.

Response defaults change: unlike `func.HttpResponse`, the extension's base
`Response` does not set `text/plain` by default. For an existing text response,
set the media type explicitly:

```python
from azurefunctions.extensions.http.fastapi import Response

return Response(content=text, status_code=status, media_type="text/plain")
```

Preserve status, body and Content-Type for both success and error responses.
JSON and SSE responses retain their own media types; do not change them to text.

## Checks

1. Check registration, routes, methods and authorization for every HTTP function, including blueprints.
2. Check success and error status, body and Content-Type for each endpoint, not only the streaming endpoint.
3. Use a finite event source to check order, incremental delivery and termination without buffering.

Direct ASGI checks do not prove Functions host indexing, authentication
enforcement, or network/proxy streaming. Report these limits and run host/network
checks separately when authorized.
