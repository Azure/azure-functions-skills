# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Blob starter: summarize each text document uploaded to the ``documents`` container.

The hosted skill itself is ``document_summary.agent.md``. A blob trigger only tells the
skill *which* blob arrived (name, URI, size), not what is in it, so this small function
reads the file and hands its text to the skill. That keeps the skill free of custom tools.
"""

import logging
import os

import azure.functions as func
from azure_functions_agents import HostedSkill, create_function_app

app = create_function_app()

TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".log", ".html", ".xml"}
MAX_CHARS = 100_000

# Flex Consumption runs blob triggers through Event Grid. Azurite has no Event Grid,
# so local runs scan the container instead. Set by the DOCUMENTS_BLOB_SOURCE app setting.
BLOB_SOURCE = (
    func.BlobSource.EVENT_GRID
    if os.environ.get("DOCUMENTS_BLOB_SOURCE", "EventGrid") == "EventGrid"
    else func.BlobSource.LOGS_AND_CONTAINER_SCAN
)


@app.function_name("summarize_document")
@app.blob_trigger(arg_name="blob", path="documents/{name}", connection="AzureWebJobsStorage", source=BLOB_SOURCE)
@app.hosted_skill(arg_name="skill", agent_name="document_summary")
async def summarize_document(blob: func.InputStream, skill: HostedSkill) -> None:
    name = blob.name.split("/", 1)[-1]
    extension = os.path.splitext(name)[1].lower()
    if extension not in TEXT_EXTENSIONS:
        logging.warning("Skipping %s: only text files (%s) are summarized.", name, ", ".join(sorted(TEXT_EXTENSIONS)))
        return

    text = blob.read().decode("utf-8", errors="replace")
    note = f" (truncated to the first {MAX_CHARS} characters)" if len(text) > MAX_CHARS else ""
    prompt = (
        f"Document name: {name}\n"
        f"Size: {blob.length} bytes{note}\n\n"
        "<document>\n"
        f"{text[:MAX_CHARS]}\n"
        "</document>"
    )
    result = await skill.run(prompt)
    logging.info("Summary for %s:\n%s", name, result.content)
