import azure.functions as func
import numpy as np

app = func.FunctionApp()


@app.route(route="health")
def health(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(f"numpy {np.__version__}")
