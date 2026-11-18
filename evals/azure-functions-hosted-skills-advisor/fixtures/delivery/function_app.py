import json
import logging
import re

import azure.functions as func

app = func.FunctionApp()


@app.service_bus_queue_trigger(arg_name="message", queue_name="data-ingestion",
                               connection="ServiceBusConnection")
@app.blob_output(arg_name="output", path="processed-data/{rand-guid}.json",
                 connection="AzureWebJobsStorage")
def ingest(message: func.ServiceBusMessage, output: func.Out[str]) -> None:
    try:
        record = json.loads(message.get_body())
        validate_record(record)
    except (ValueError, TypeError, KeyError):
        logging.exception("Invalid ingestion record; delivery will fail")
        raise
    record["source"] = re.sub(r"[^a-z0-9]+", "-", record["source"].lower()).strip("-")
    output.set(json.dumps(record))


def validate_record(record: dict) -> None:
    if not isinstance(record["record_id"], str) or not record["record_id"]:
        raise ValueError("record_id must be a nonempty string")
    if not isinstance(record["source"], str) or not record["source"].strip():
        raise ValueError("source must be a nonempty string")
    if isinstance(record["value"], bool) or not isinstance(record["value"], (int, float)):
        raise TypeError("value must be numeric")
