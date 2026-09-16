"""Offline SDK registration and incremental ASGI response checks."""

import asyncio
import importlib
import inspect
import json
from pathlib import Path
import re
import sys
import typing
from unittest.mock import patch


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def check_settings(settings):
    version = tuple(int(part) for part in settings["pythonVersion"].split("."))
    require(version >= (3, 10), "Use a supported Python version")
    values = settings["Values"]
    require(values.get("FUNCTIONS_WORKER_RUNTIME") == "python"
            and values.get("FUNCTIONS_EXTENSION_VERSION") == "~4"
            and values.get("APP_LABEL") == "migration-fixture", "Keep unrelated app settings")
    if version <= (3, 12):
        require(values.get("PYTHON_ENABLE_INIT_INDEXING") == "1",
                "Python 3.12 and earlier require PYTHON_ENABLE_INIT_INDEXING=1")


def scope(method, path):
    return {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
            "http_version": "1.1", "method": method, "scheme": "http",
            "path": path, "raw_path": path.encode(), "query_string": b"",
            "headers": [(b"content-type", b"application/json")],
            "server": ("localhost", 80), "client": ("localhost", 1234)}


async def grade():
    import azure.functions as func
    from azurefunctions.extensions.http.fastapi import Request, Response, StreamingResponse

    requirements = Path("requirements.txt").read_text(encoding="utf-8")
    for name in ("azure-functions", "azurefunctions-extensions-http-fastapi"):
        require(re.search(r"(?m)^" + re.escape(name) + r"\s*(?:[<>=!~;#\[]|$)", requirements),
                f"Missing requirement: {name}")
    settings = json.loads(Path("app-settings.json").read_text())
    check_settings(settings)
    require(settings["pythonVersion"] == "3.12", "Keep the app's Python 3.12 target")
    host = json.loads(Path("host.json").read_text())
    require(host.get("version") == "2.0"
            and host.get("extensions", {}).get("http", {}).get("routePrefix", "api") == "api",
            "Keep host schema and /api route prefix")
    sent = bytearray()
    produced = []

    async def source():
        for number in range(5):
            if number:
                require(f"data: {number - 1}\n\n".encode() in sent,
                        "The prior event must reach ASGI send before the next source item is requested")
            produced.append(number)
            yield f"data: {number}\n\n"
            await asyncio.sleep(0)

    sys.path.insert(0, str(Path.cwd()))
    events = importlib.import_module("events")
    original = events.count_events()
    actual = []
    try:
        if hasattr(original, "__aiter__"):
            async for event in original:
                actual.append(event)
                require(len(actual) <= 5, "The submitted event source must terminate after five events")
        else:
            for event in original:
                actual.append(event)
                require(len(actual) <= 5, "The submitted event source must terminate after five events")
    finally:
        if hasattr(original, "aclose"):
            await original.aclose()
        elif hasattr(original, "close"):
            original.close()
    require(actual == [f"data: {number}\n\n" for number in range(5)],
            "Keep the submitted event source's ordered count data")
    with patch.object(events, "count_events", source):
        module = importlib.import_module("function_app")
        functions = module.app.get_functions()
        require({item.get_function_name() for item in functions} == {"Count", "Echo"}
                and len(functions) == 2, "Register both original HTTP functions")
        handlers = {}
        for item in functions:
            name = item.get_function_name()
            bindings = item.get_dict_repr()["bindings"]
            trigger = [binding for binding in bindings if binding["type"] == "httpTrigger"]
            require(len(bindings) == 2 and len(trigger) == 1, "Keep HTTP trigger and output")
            route, method, auth = (("count", func.HttpMethod.GET, func.AuthLevel.ANONYMOUS)
                                   if name == "Count" else ("echo", func.HttpMethod.POST, func.AuthLevel.FUNCTION))
            require(trigger[0].get("route") == route and trigger[0].get("methods") == [method]
                    and trigger[0].get("authLevel") == auth, f"Keep {name} route, method and auth")
            handler = item.get_user_function()
            require(typing.get_type_hints(handler).get(trigger[0]["name"]) is Request,
                    f"{name} must use the extension Request, not func.HttpRequest")
            handlers[name] = (handler, trigger[0]["name"])

        async def invoke(name, request):
            handler, argument = handlers[name]
            response = handler(**{argument: request})
            return await response if inspect.isawaitable(response) else response

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        count_scope = scope("GET", "/api/count")
        response = await invoke("Count", Request(count_scope, receive))
        require(isinstance(response, StreamingResponse), "Count must return StreamingResponse")
        require(response.status_code == 200 and response.media_type == "text/event-stream",
                "Keep count status and SSE content type")
        messages = []

        async def send(message):
            messages.append(message)
            if message["type"] == "http.response.body":
                sent.extend(message.get("body", b""))

        await response(count_scope, receive, send)
        require(produced == list(range(5)), "Consume the existing bounded event source")
        require(bytes(sent) == b"".join(f"data: {number}\n\n".encode() for number in range(5)),
                "Keep all count events in order")
        bodies = [message for message in messages if message["type"] == "http.response.body"]
        require(sum(bool(message.get("body")) for message in bodies) >= 5
                and not bodies[-1].get("more_body", False), "Send separate events and terminate the stream")
        for body, status, expected in [
            (b'{"message":"hello"}', 200, b"hello"),
            ('{"message":"caf\u00e9"}'.encode(), 200, "caf\u00e9".encode()),
            (b'{"message":""}', 200, b""),
            (b"{", 400, b"Invalid JSON"),
            (b"{}", 422, b"Missing message"),
            (b'{"message":7}', 422, b"Missing message"),
            (b"[]", 422, b"Missing message"),
        ]:
            async def receive_body():
                return {"type": "http.request", "body": body, "more_body": False}

            echo_scope = scope("POST", "/api/echo")
            response = await invoke("Echo", Request(echo_scope, receive_body))
            require(isinstance(response, Response), "Echo must also return an extension-compatible response")
            require(response.status_code == status, "Keep Echo success and error statuses")
            require(response.headers.get("content-type", "").startswith("text/plain"),
                    "Keep Echo text/plain content type")
            sent.clear()
            await response(echo_scope, receive_body, send)
            require(bytes(sent) == expected, "Keep Echo success and error response bodies")
    return ["Both HTTP functions registered with original routes, methods and authorization",
            "ASGI send received each count event before the next source item; stream terminated",
            "Extension requests and responses preserve Echo success, UTF-8 and error semantics",
            "Python 3.12 init indexing and unrelated settings preserved"]


if __name__ == "__main__":
    result = {"passed": False, "checks": [], "scope": "offline SDK registration and ASGI, no host",
              "error": None}
    try:
        with patch("time.sleep", side_effect=AssertionError("Do not block with time.sleep")):
            result["checks"] = asyncio.run(asyncio.wait_for(grade(), timeout=15))
        result["passed"] = True
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
    output = Path("grading-evidence")
    output.mkdir(exist_ok=True)
    (output / "execution.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))
    sys.exit(0 if result["passed"] else 1)
