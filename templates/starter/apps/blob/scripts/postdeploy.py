# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""azd postdeploy hook: subscribe the function's blob trigger to Event Grid.

On Flex Consumption, blob triggers use Event Grid. The webhook needs the function
app's ``blobs_extension`` system key, which exists only after the code is deployed
and the host has started, so this runs after ``azd deploy`` instead of in Bicep.
Running it again updates the same subscription.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

FUNCTION_NAME = "summarize_document"
SUBSCRIPTION_NAME = "documents-blob-created"
API_VERSION = "2022-06-15"


def az(*args: str) -> str:
    executable = shutil.which("az")
    if executable is None:
        raise SystemExit("Azure CLI (az) is required for the postdeploy hook: https://aka.ms/azure-cli")
    # Keep '&' and other shell characters out of the arguments: on Windows az is a .cmd
    # script that cmd.exe parses. The webhook URL goes in a request body file instead.
    result = subprocess.run([executable, *args, "--only-show-errors"], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"az exited with {result.returncode}")
    return result.stdout.strip()


def retry(action, what: str, attempts: int = 12, delay: int = 15):
    error = ""
    for attempt in range(1, attempts + 1):
        try:
            value = action()
            if value:
                return value
            error = "not available yet"
        except RuntimeError as exc:
            error = str(exc).splitlines()[-1]
        if attempt < attempts:
            print(f"  {what}: {error}; retrying in {delay}s [{attempt}/{attempts}]")
            time.sleep(delay)
    raise SystemExit(f"Gave up waiting for {what}: {error}")


def put_subscription(uri: str, body: dict) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(body, f)
        body_path = f.name
    try:
        az("rest", "--method", "put", "--uri", uri, "--body", f"@{body_path}", "--output", "none")
    finally:
        os.unlink(body_path)

    # Event Grid validates the webhook asynchronously after the PUT.
    for _ in range(30):
        state = json.loads(az("rest", "--method", "get", "--uri", uri))["properties"]["provisioningState"]
        if state == "Succeeded":
            return state
        if state in ("Failed", "Canceled"):
            raise RuntimeError(f"subscription provisioning {state}")
        time.sleep(5)
    raise RuntimeError("subscription provisioning timed out")


def main() -> int:
    try:
        subscription_id = os.environ["AZURE_SUBSCRIPTION_ID"]
        resource_group = os.environ["AZURE_RESOURCE_GROUP"]
        app_name = os.environ["AZURE_FUNCTION_NAME"]
        topic_name = os.environ["DOCUMENTS_SYSTEM_TOPIC_NAME"]
        container = os.environ.get("DOCUMENTS_CONTAINER", "documents")
    except KeyError as exc:
        raise SystemExit(f"Missing azd environment value {exc}. Run 'azd provision' first.") from exc

    print(f"Connecting Event Grid topic '{topic_name}' to {app_name}/{FUNCTION_NAME}...")
    host = az(
        "functionapp", "show", "-g", resource_group, "-n", app_name,
        "--subscription", subscription_id,
        "--query", "properties.defaultHostName", "-o", "tsv",
    )
    key = retry(
        lambda: az(
            "functionapp", "keys", "list", "-g", resource_group, "-n", app_name,
            "--subscription", subscription_id,
            "--query", "systemKeys.blobs_extension", "-o", "tsv",
        ),
        "blobs_extension key",
    )

    uri = (
        f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}"
        f"/providers/Microsoft.EventGrid/systemTopics/{topic_name}/eventSubscriptions/{SUBSCRIPTION_NAME}"
        f"?api-version={API_VERSION}"
    )
    body = {
        "properties": {
            "destination": {
                "endpointType": "WebHook",
                "properties": {
                    "endpointUrl": (
                        f"https://{host}/runtime/webhooks/blobs"
                        f"?functionName=Host.Functions.{FUNCTION_NAME}&code={key}"
                    ),
                },
            },
            "filter": {
                "includedEventTypes": ["Microsoft.Storage.BlobCreated"],
                "subjectBeginsWith": f"/blobServices/default/containers/{container}/",
            },
            "eventDeliverySchema": "EventGridSchema",
        }
    }
    # Validation fails until the host is ready to answer the handshake, so retry.
    retry(lambda: put_subscription(uri, body), "Event Grid subscription", attempts=8, delay=20)
    print(f"Event Grid subscription '{SUBSCRIPTION_NAME}' is ready. Upload documents to the '{container}' container.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
