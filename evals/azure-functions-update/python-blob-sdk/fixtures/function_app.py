import azure.functions as func

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)


@app.function_name(name="ReadFile")
@app.route(route="file", methods=["GET"])
@app.blob_input(
    arg_name="file",
    path="python-worker-tests/test-filelike.txt",
    connection="AzureWebJobsStorage",
)
def read_file(req: func.HttpRequest, file: func.InputStream) -> func.HttpResponse:
    return func.HttpResponse(
        file.read().decode("utf-8"), status_code=200, mimetype="text/plain"
    )
