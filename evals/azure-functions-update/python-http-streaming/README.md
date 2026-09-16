# Python HTTP streaming migration

Scenario ID: `python-http-streaming`.

Migrate Count and Echo to the same HTTP streaming extension. Count must send
five ordered SSE events incrementally. Echo must retain function authorization,
POST /api/echo, UTF-8 success bodies and exact invalid-input responses.
Preserve the Python 3.12 target and set its required init-indexing value.

See the [Python migration guide](../python-migrations.md) for isolated
installation, free grader checks, and focused free/paid commands.
The [fixed source notes](fixtures/guidance.md) state the review basis.
Direct ASGI checks do not prove host indexing, auth enforcement or network
streaming.
