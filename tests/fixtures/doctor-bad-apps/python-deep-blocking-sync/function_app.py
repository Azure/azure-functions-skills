import azure.functions as func
import logging
import time
import requests
from azure.storage.blob import BlobServiceClient

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

@app.route(route="process")
def process_data(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Processing data request")

    # BAD: PY-004 / CQ-001 — Creating BlobServiceClient per invocation
    # Should be created at module level and reused across invocations
    blob_client = BlobServiceClient.from_connection_string(
        req.headers.get("x-storage-connection", "")
    )

    # BAD: PY-002 — Using synchronous requests library
    # Should use aiohttp or httpx with async
    response = requests.get("https://api.example.com/data")
    data = response.json()

    # BAD: CQ-006 — Using time.sleep for rate limiting
    # Blocks the entire worker thread; should use async delay or exponential backoff
    time.sleep(5)

    # BAD: PY-002 — Another synchronous HTTP call
    result = requests.post("https://api.example.com/results", json=data)

    # BAD: CQ-006 — Another blocking sleep
    time.sleep(2)

    container_client = blob_client.get_container_client("results")
    blob = container_client.get_blob_client(f"result-{time.time()}.json")
    blob.upload_blob(str(result.json()))

    return func.HttpResponse("Processed", status_code=200)
