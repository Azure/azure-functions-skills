import azure.functions as func

app = func.FunctionApp()


@app.route(route="health")
def health(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("ok")
