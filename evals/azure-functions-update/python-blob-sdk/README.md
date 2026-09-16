# Python Blob SDK migration

Scenario ID: `python-blob-sdk`.

Migrate ReadFile from InputStream to a BlobClient input binding. Preserve
function-authorized GET /api/file and complete text/plain UTF-8 responses.
This is an HTTP trigger with a Blob input, not a Blob trigger.

See the [Python migration guide](../python-migrations.md) for isolated
installation, free grader checks, and focused free/paid commands.
The [fixed source notes](fixtures/guidance.md) state the review basis.
Offline storage mocks do not prove host indexing or live Blob access.
