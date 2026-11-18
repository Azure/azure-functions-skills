import json

import azure.functions as func

app = func.FunctionApp()


@app.route(route="items/{id}", methods=["GET"], auth_level=func.AuthLevel.FUNCTION)
@app.blob_input(arg_name="item", path="items/{id}.json", connection="AzureWebJobsStorage")
def get_item(req: func.HttpRequest, item: str) -> func.HttpResponse:
    if not item:
        return func.HttpResponse(status_code=404)
    return func.HttpResponse(item, mimetype="application/json")


@app.route(route="items/{id}", methods=["PUT"], auth_level=func.AuthLevel.FUNCTION)
@app.blob_output(arg_name="item", path="items/{id}.json", connection="AzureWebJobsStorage")
def put_item(req: func.HttpRequest, item: func.Out[str]) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse("Expected JSON", status_code=400)
    if not isinstance(body, dict) or not isinstance(body.get("name"), str):
        return func.HttpResponse("name must be a string", status_code=400)
    item.set(json.dumps({"id": req.route_params["id"], "name": body["name"]}))
    return func.HttpResponse(status_code=204)
