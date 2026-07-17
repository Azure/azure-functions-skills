import azure.functions as func
import requests

app = func.FunctionApp()


@app.route(route="lookup")
def lookup(req: func.HttpRequest) -> func.HttpResponse:
    response = requests.get("https://example.com", timeout=5)
    return func.HttpResponse(str(response.status_code))
