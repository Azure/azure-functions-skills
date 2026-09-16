"""Offline registration and SDK contract checks. No host or storage access."""

import asyncio
import importlib
import inspect
import io
import json
from pathlib import Path
import re
import sys
import typing
from unittest.mock import create_autospec


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def grade():
    import azure.functions as func
    import azurefunctions.extensions.bindings.blob as blob
    from azure.storage.blob import BlobClient, StorageStreamDownloader

    requirements = Path("requirements.txt").read_text(encoding="utf-8")
    for name in ("azure-functions", "azurefunctions-extensions-bindings-blob"):
        require(re.search(r"(?m)^" + re.escape(name) + r"\s*(?:[<>=!~;#\[]|$)", requirements),
                f"Missing requirement: {name}")
    host = json.loads(Path("host.json").read_text())
    require(host.get("version") == "2.0", "Keep host schema version 2.0")
    require(host.get("extensions", {}).get("http", {}).get("routePrefix", "api") == "api",
            "Keep /api route prefix")
    require(host.get("extensionBundle") == {
        "id": "Microsoft.Azure.Functions.ExtensionBundle", "version": "[4.0.0, 5.0.0)"
    }, "Keep the existing extension bundle")
    sys.path.insert(0, str(Path.cwd()))
    app = importlib.import_module("function_app").app
    functions = app.get_functions()
    require(len(functions) == 1 and functions[0].get_function_name() == "ReadFile",
            "Register only the existing ReadFile function")
    function = functions[0]
    bindings = function.get_dict_repr()["bindings"]
    trigger = [item for item in bindings if item["type"] == "httpTrigger"]
    inputs = [item for item in bindings if item["type"] == "blob"]
    require(len(bindings) == 3 and len(trigger) == 1 and len(inputs) == 1,
            "Keep HTTP trigger plus blob input and HTTP output, not a blob trigger")
    require(trigger[0].get("route") == "file"
            and trigger[0].get("methods") == [func.HttpMethod.GET]
            and trigger[0].get("authLevel") == func.AuthLevel.FUNCTION,
            "Keep GET /api/file with function authorization")
    binding = inputs[0]
    require(binding.get("path") == "python-worker-tests/test-filelike.txt"
            and binding.get("connection") == "AzureWebJobsStorage", "Keep blob path and connection")
    handler = function.get_user_function()
    require(typing.get_type_hints(handler).get(binding["name"]) is blob.BlobClient,
            "Use the extension BlobClient binding annotation")
    calls = []

    for payload in (b"", b"all bytes, not the first byte", "caf\u00e9 \u65e5\u672c\nend".encode("utf-8"),
                    ("large \u20ac\n" * 8192).encode("utf-8"), b"\xff"):
        client = create_autospec(BlobClient, instance=True, spec_set=True)

        def download(offset=None, length=None, **kwargs):
            require(set(kwargs) <= {"encoding"}, "Mock supports only download encoding and range options")
            content = payload[offset or 0:][:length]
            buffer = io.BytesIO(content)
            encoding = kwargs.get("encoding")
            downloader = create_autospec(StorageStreamDownloader, instance=True, spec_set=True)

            def read(size=-1):
                data = buffer.read(size)
                return data.decode(encoding) if encoding else data

            downloader.read.side_effect = read
            downloader.readall.side_effect = lambda: read()
            downloader.readinto.side_effect = lambda target: target.write(buffer.read())
            downloader.chunks.side_effect = lambda: iter(
                [content[index:index + 7] for index in range(0, len(content), 7)])
            return downloader

        client.download_blob.side_effect = download
        try:
            response = handler(**{
                trigger[0]["name"]: func.HttpRequest("GET", "http://localhost/api/file", body=b""),
                binding["name"]: client,
            })
            if inspect.isawaitable(response):
                response = asyncio.run(response)
        except UnicodeDecodeError:
            require(payload == b"\xff" and client.download_blob.called,
                    "Valid UTF-8 must not fail decoding")
            continue
        require(payload != b"\xff", "Keep the original invalid UTF-8 decoding failure")
        require(isinstance(response, func.HttpResponse), "Keep the HTTP response contract")
        require(response.status_code == 200 and response.get_body() == payload,
                "Return all original UTF-8 contents, including empty and multibyte blobs")
        require(response.mimetype == "text/plain" and response.charset.lower() == "utf-8",
                "Keep text/plain UTF-8")
        require(client.download_blob.called, "Read the bound client with the SDK")
        calls.append(len(payload))
    return ["Python SDK registered ReadFile with its original HTTP and blob bindings",
            f"Mock SDK downloads preserve complete UTF-8 responses for byte lengths {calls}",
            "Invalid UTF-8 still raises a decoding error"]


if __name__ == "__main__":
    result = {"passed": False, "checks": [], "scope": "offline SDK registration and mock storage",
              "error": None}
    try:
        result["checks"] = grade()
        result["passed"] = True
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
    output = Path("grading-evidence")
    output.mkdir(exist_ok=True)
    (output / "execution.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))
    sys.exit(0 if result["passed"] else 1)
