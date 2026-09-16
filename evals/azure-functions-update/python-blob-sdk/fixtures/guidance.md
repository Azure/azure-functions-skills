# Fixed review basis: Python Blob SDK migration

Sources checked on 2026-09-15:

- [Blob input reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-blob-input?pivots=programming-language-python): Python SDK types are generally available, v2-model only, and synchronous only.
- [SDK support table](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings?pivots=programming-language-python#sdk-types): BlobClient, ContainerClient and StorageStreamDownloader support both Blob inputs and triggers at GA.
- [Official sample](https://github.com/Azure-Samples/azure-functions-blob-sdk-bindings-python): add azurefunctions-extensions-bindings-blob; import azurefunctions.extensions.bindings.blob; annotate the bound argument with its BlobClient.
- [BlobClient API](https://learn.microsoft.com/en-us/python/api/azure-storage-blob/azure.storage.blob.blobclient) and [downloader API](https://learn.microsoft.com/en-us/python/api/azure-storage-blob/azure.storage.blob.storagestreamdownloader): download_blob returns a downloader; readall reads all remaining content. read(size=1) does not preserve a complete file.
- [Historical announcement](https://techcommunity.microsoft.com/blog/azurecompute/azure-functions-sdk-type-bindings-for-azure-blob-storage-with-azure-functions-in/4146744): historical context, not the current Preview/GA authority.

This fixture is Python v2 on Python 3.12 and current Functions v4. The existing
v4 extension bundle is not part of this migration. The function is ReadFile:
function-authorized GET /api/file with a blob INPUT at
python-worker-tests/test-filelike.txt using AzureWebJobsStorage. Keep HTTP 200,
text/plain UTF-8 and the complete original contents. Do not add a blob trigger.
Adapt all InputStream uses to supported SDK calls and preserve error behavior.

The offline grader uses actual Python decorator registration and SDK classes.
Storage is mocked with autospecced BlobClient and StorageStreamDownloader
objects. It checks empty, complete, multibyte and larger content. This is not
Functions host indexing, binding conversion, trigger delivery, auth enforcement
or live storage validation. No Azure success is established. Do not penalize
the absence of authorized integration checks or require a specific complete-read
syntax when another supported API preserves the same contract.
