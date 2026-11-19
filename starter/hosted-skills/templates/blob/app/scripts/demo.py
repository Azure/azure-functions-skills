# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Upload sample documents and run a best-effort hosted-skill smoke check.

Usage (from the template folder):

    python scripts/demo.py upload                            # upload all samples to the deployed app
    python scripts/demo.py upload --sample team-sync-notes.md
    python scripts/demo.py e2e                               # upload unique copies and check for successful invocations

Add ``--local`` to ``upload`` to target ``func start`` with Azurite instead of the azd environment.
The summary is in the function logs (and in your inbox when TO_EMAIL is set).
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

TEMPLATE_DIR = Path(__file__).resolve().parent.parent
SAMPLES_DIR = TEMPLATE_DIR / "samples"
FUNCTION_NAME = "summarize_document"
CONTAINER = "documents"


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


def load_samples(only: str | None = None) -> list[Path]:
    samples = [p for p in sorted(SAMPLES_DIR.iterdir()) if p.is_file() and (only is None or p.name == only)]
    if not samples:
        raise SystemExit(f"No sample found for {only!r} in {SAMPLES_DIR}")
    return samples


def upload(files: list[tuple[str, bytes]], local: bool) -> None:
    from azure.core.exceptions import ResourceExistsError
    from azure.storage.blob import ContainerClient

    if local:
        container = ContainerClient.from_connection_string("UseDevelopmentStorage=true", CONTAINER)
        try:
            container.create_container()
        except ResourceExistsError:
            pass
    else:
        account = azd_values()["AZURE_STORAGE_ACCOUNT_NAME"]
        container = ContainerClient(f"https://{account}.blob.core.windows.net", CONTAINER, credential=credential())
    for name, data in files:
        container.upload_blob(name, data, overwrite=True)
        print(f"uploaded {name} -> container '{CONTAINER}'")


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
    files = [(f"{p.stem}-{run_id}{p.suffix}", p.read_bytes()) for p in load_samples()]
    started = datetime.now(timezone.utc) - timedelta(seconds=30)
    upload(files, local=False)
    print("Application Insights can lag a few minutes behind the run.")
    deadline = time.monotonic() + timeout
    succeeded = failed = 0
    while time.monotonic() < deadline:
        succeeded, failed = count_runs(resource_id, started)
        print(f"waiting... saw {succeeded}/{len(files)} successful invocations, {failed} failed")
        if succeeded >= len(files):
            print("smoke check passed")
            return 0
        time.sleep(20)
    print(f"FAIL saw {succeeded}/{len(files)} successful invocations ({failed} failed)", file=sys.stderr)
    print("smoke check failed")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("upload")
    p.add_argument("--local", action="store_true", help="Upload to Azurite for func start.")
    p.add_argument("--sample", help="Upload one sample by file name, for example team-sync-notes.md.")
    p = sub.add_parser("e2e")
    p.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args(argv)

    if args.command == "upload":
        upload([(p.name, p.read_bytes()) for p in load_samples(args.sample)], args.local)
        return 0
    return e2e(args.timeout)


if __name__ == "__main__":
    sys.exit(main())
