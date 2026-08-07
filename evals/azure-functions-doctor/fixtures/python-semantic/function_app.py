import urllib.request

import azure.functions as func

from jobs import jobs

app = func.FunctionApp()
app.register_functions(jobs)


@app.route(route="status")
async def get_status(req: func.HttpRequest) -> func.HttpResponse:
    with urllib.request.urlopen("https://example.com/status", timeout=10) as response:
        return func.HttpResponse(str(response.status))
