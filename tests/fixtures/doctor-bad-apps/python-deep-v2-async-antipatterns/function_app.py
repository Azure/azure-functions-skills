import azure.functions as func
import logging
import requests  # sync HTTP library
from azure.cosmos import CosmosClient
from azure.storage.blob import BlobServiceClient

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

# BAD: Module-level expensive initialization — runs on every cold start
# and blocks the worker during import
_cosmos_client = CosmosClient(
    "https://expensive-init.documents.azure.com:443/",
    credential="placeholder-key-that-will-fail-on-import=="
)
_heavy_data = requests.get("https://api.example.com/config").json()  # BAD: blocks on import

# BAD: CQ-002 — Mutable global state used as business state
request_counter = 0
processed_items = []
error_log = {}


@app.route(route="process")
async def process_data(req: func.HttpRequest) -> func.HttpResponse:
    """Async handler that improperly uses sync operations."""
    global request_counter, processed_items
    logging.info("Processing request")

    # BAD: CQ-002 — Mutating global state for business logic
    # This is shared across invocations in the same worker but NOT across workers
    request_counter += 1
    current_count = request_counter

    body = req.get_json()

    # BAD: PY-002 — Using sync requests in async handler (blocks event loop)
    response = requests.get(f"https://api.example.com/items/{body.get('id')}")
    item_data = response.json()

    # BAD: PY-004 — Creating new client per invocation instead of reusing module-level
    cosmos = CosmosClient(
        "https://mydb.documents.azure.com:443/",
        credential="placeholder=="
    )
    database = cosmos.get_database_client("mydb")
    container = database.get_container_client("items")

    # BAD: CQ-002 — Appending to mutable global list
    processed_items.append(body.get("id"))

    # BAD: PY-002 — sync SDK call in async handler
    container.upsert_item({"id": body.get("id"), "data": item_data, "count": current_count})

    return func.HttpResponse(f"Processed item #{current_count}", status_code=200)


@app.route(route="stats")
async def get_stats(req: func.HttpRequest) -> func.HttpResponse:
    """Returns unreliable stats from global mutable state."""
    # BAD: CQ-002 — Reading from mutable global state that's per-worker
    return func.HttpResponse(
        f"Processed {request_counter} items: {processed_items}",
        status_code=200
    )
