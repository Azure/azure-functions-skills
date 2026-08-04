import azure.functions as func
import requests
from jobs import jobs

app = func.FunctionApp()


@app.route(route="status")
async def get_status(req: func.HttpRequest) -> func.HttpResponse:
    response = requests.get("https://example.com/status", timeout=10)
    return func.HttpResponse(str(response.status_code))
