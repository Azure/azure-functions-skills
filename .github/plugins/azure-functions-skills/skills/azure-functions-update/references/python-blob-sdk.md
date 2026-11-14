# Python Blob SDK Type Bindings

Use this reference to replace `func.InputStream` with a Blob SDK type.
Do not confuse a blob input binding with a blob trigger.

1. Read the Python sections of the [Blob input reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-blob-input?pivots=programming-language-python) and the [SDK support table](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings?pivots=programming-language-python#sdk-types). For a blob trigger, also read the [trigger reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-blob-trigger?pivots=programming-language-python).
2. Confirm the prerequisites: Python programming model v2, a supported Python version, the current Functions v4 runtime, and a compatible Blob binding extension. Use the [official sample](https://github.com/Azure-Samples/azure-functions-blob-sdk-bindings-python) for package setup. Python Blob SDK input and trigger bindings are generally available. Only synchronous SDK types are supported. The 2024 [announcement](https://techcommunity.microsoft.com/blog/azurecompute/azure-functions-sdk-type-bindings-for-azure-blob-storage-with-azure-functions-in/4146744) used a Preview label; do not use that label as current support guidance.
3. Add `azurefunctions-extensions-bindings-blob` to `requirements.txt`. Keep `azure-functions`. Import `azurefunctions.extensions.bindings.blob as blob` and change the bound argument annotation to `blob.BlobClient`.
4. Adapt every use of the argument to the [Azure Storage Blob SDK API](https://learn.microsoft.com/en-us/python/api/azure-storage-blob/azure.storage.blob.blobclient). The bound value is now a client, not a file-like stream. To preserve `file.read().decode("utf-8")`, use `file.download_blob().readall().decode("utf-8")`, or an equivalent complete read. Do not copy the sample's `read(size=1)` when the response must contain the entire blob. Preserve decoding, response status, content type and error behavior.
5. Keep the decorator's argument mapping, path and connection name. An HTTP function with `@app.blob_input` remains HTTP-triggered. For `@app.blob_trigger`, keep the existing trigger and adapt its argument uses in the same way. Do not replace it with an HTTP route or claim that input tests cover trigger delivery.
6. Check registration and test full, empty, multibyte and larger content with SDK mocks. Check host indexing and storage access separately when an authorized test environment is available. Do not create storage or obtain credentials just to complete a local migration.

SDK bindings permit richer access; they do not automatically make a complete
HTTP response a streaming response or remove all memory use.

## Definition of done

These stable IDs are shared by planning, phase review, final review, and evaluation.
For each app and phase, record `pass`, `fail`, `blocked`, or `not-applicable`, with
artifact, proof, and applicability reason. N/A needs a condition below, not a tool or
permission gap.

| ID | Required condition | Evidence and applicability |
| --- | --- | --- |
| PB-01 | Prerequisites: Python programming model v2, a supported Python version, Functions v4, and a compatible Blob extension | Effective versions and `host.json` |
| PB-02 | `azurefunctions-extensions-bindings-blob` is in `requirements.txt`, and `azure-functions` stays | `requirements.txt` diff |
| PB-03 | The argument uses `blob.BlobClient`, and the decorator keeps its argument name, path, and connection name | Source diff |
| PB-04 | Each use of the argument reads the complete content and keeps decoding, status, content type, and error behavior | Tests with full, empty, multibyte, and larger content |
| PB-05 | A Blob trigger stays a Blob trigger, and an HTTP function stays HTTP | Trigger type before and after; N/A for the other kind |
| PB-06 | Registration succeeds; host indexing and storage access are checked only in an authorized environment | Function list, and the reason if the host check is blocked |
