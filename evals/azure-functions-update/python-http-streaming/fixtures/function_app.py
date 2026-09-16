import azure.functions as func
from events import count_events

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)


@app.function_name(name="Count")
@app.route(route="count", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
async def count(req: func.HttpRequest) -> func.HttpResponse:
    events = [event async for event in count_events()]
    return func.HttpResponse("".join(events), mimetype="text/event-stream")


@app.function_name(name="Echo")
@app.route(route="echo", methods=["POST"])
async def echo(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
    except ValueError:
        return func.HttpResponse("Invalid JSON", status_code=400)
    if not isinstance(data, dict) or not isinstance(data.get("message"), str):
        return func.HttpResponse("Missing message", status_code=422)
    return func.HttpResponse(data["message"], status_code=200)
