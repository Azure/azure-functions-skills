import azure.functions as func
from azurefunctions.extensions.http.fastapi import Request, StreamingResponse, Response
from events import count_events

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)


@app.function_name(name="Count")
@app.route(route="count", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
async def count(req: Request) -> StreamingResponse:
    return StreamingResponse(count_events(), media_type="text/event-stream")


@app.function_name(name="Echo")
@app.route(route="echo", methods=["POST"])
async def echo(req: Request) -> Response:
    try:
        data = await req.json()
    except ValueError:
        return Response("Invalid JSON", status_code=400, media_type="text/plain")
    if not isinstance(data, dict) or not isinstance(data.get("message"), str):
        return Response("Missing message", status_code=422, media_type="text/plain")
    return Response(data["message"], status_code=200, media_type="text/plain")
