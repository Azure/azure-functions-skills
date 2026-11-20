# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Send sample support messages and run a best-effort hosted-skill smoke check.

Usage (from the template folder):

    python scripts/demo.py send                  # send all samples to the deployed app
    python scripts/demo.py send --sample T-1001
    python scripts/demo.py e2e                   # send unique copies and check for successful invocations

Add ``--local`` to ``send`` to target ``func start`` with Azurite instead of the azd environment.
The triage result is in the function logs (and in your inbox when TO_EMAIL is set).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

TEMPLATE_DIR = Path(__file__).resolve().parent.parent
SAMPLES_DIR = TEMPLATE_DIR / "samples"
FUNCTION_NAME = "support_triage"
QUEUE_NAME = "support-requests"


def azd_values() -> dict[str, str]:
    out = subprocess.run(
        ["azd", "env", "get-values"], cwd=TEMPLATE_DIR, capture_output=True, text=True, check=True,
        shell=os.name == "nt",
    ).stdout
    values = {}
    for line in out.splitlines():
        key, sep, value = line.partition("=")
        if sep:
            values[key.strip()] = value.strip().strip('"')
    return values


def credential():
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential(exclude_interactive_browser_credential=True)


def load_samples(only: str | None = None) -> list[dict[str, Any]]:
    samples = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(SAMPLES_DIR.glob("*.json"))]
    samples = [s for s in samples if only is None or s["ticket_id"] == only]
    if not samples:
        raise SystemExit(f"No sample found for {only!r} in {SAMPLES_DIR}")
    return samples


def send(messages: list[dict[str, Any]], local: bool) -> None:
    from azure.core.exceptions import ResourceExistsError
    from azure.storage.queue import QueueClient

    if local:
        queue = QueueClient.from_connection_string("UseDevelopmentStorage=true", QUEUE_NAME)
        try:
            queue.create_queue()
        except ResourceExistsError:
            pass
    else:
        account = azd_values()["AZURE_STORAGE_ACCOUNT_NAME"]
        queue = QueueClient(f"https://{account}.queue.core.windows.net", QUEUE_NAME, credential=credential())
    for message in messages:
        queue.send_message(json.dumps(message))
        print(f"sent {message['ticket_id']} -> queue '{QUEUE_NAME}'")


def count_runs(resource_id: str, since: datetime) -> tuple[int, int]:
    """Return (succeeded, failed) runs of the function since ``since`` from Application Insights."""
    from azure.monitor.query import LogsQueryClient, LogsQueryStatus

    query = (
        f"requests | where timestamp > datetime({since.isoformat()}) and operation_Name == '{FUNCTION_NAME}'"
        " | summarize succeeded = countif(success == true), failed = countif(success == false)"
    )
    result = LogsQueryClient(credential()).query_resource(resource_id, query, timespan=timedelta(days=1))
    if result.status != LogsQueryStatus.SUCCESS or not result.tables or not result.tables[0].rows:
        return 0, 0
    succeeded, failed = result.tables[0].rows[0]
    return int(succeeded), int(failed)


def e2e(timeout: int) -> int:
    resource_id = azd_values()["APPLICATIONINSIGHTS_RESOURCE_ID"]
    run_id = uuid.uuid4().hex[:6]
    messages = [{**s, "ticket_id": f"{s['ticket_id']}-{run_id}"} for s in load_samples()]
    started = datetime.now(timezone.utc) - timedelta(seconds=30)
    send(messages, local=False)
    print("Application Insights can lag a few minutes behind the run.")
    deadline = time.monotonic() + timeout
    succeeded = failed = 0
    while time.monotonic() < deadline:
        succeeded, failed = count_runs(resource_id, started)
        print(f"waiting... saw {succeeded}/{len(messages)} successful invocations, {failed} failed")
        if succeeded >= len(messages):
            print("smoke check passed")
            return 0
        time.sleep(20)
    print(f"FAIL saw {succeeded}/{len(messages)} successful invocations ({failed} failed)", file=sys.stderr)
    print("smoke check failed")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("send")
    p.add_argument("--local", action="store_true", help="Send to Azurite for func start.")
    p.add_argument("--sample", help="Send one sample by ticket_id, for example T-1001.")
    p = sub.add_parser("e2e")
    p.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args(argv)

    if args.command == "send":
        send(load_samples(args.sample), args.local)
        return 0
    return e2e(args.timeout)


if __name__ == "__main__":
    sys.exit(main())
