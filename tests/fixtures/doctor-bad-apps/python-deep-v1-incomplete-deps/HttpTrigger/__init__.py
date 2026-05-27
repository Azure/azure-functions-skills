import logging
import azure.functions as func
from azure.cosmos import CosmosClient  # BAD: PY-003 — not in requirements.txt

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Python HTTP trigger (v1 model)")

    name = req.params.get("name")
    if not name:
        try:
            req_body = req.get_json()
        except ValueError:
            pass
        else:
            name = req_body.get("name")

    # BAD: PY-003 — Using azure-cosmos which isn't in requirements.txt
    client = CosmosClient("https://mydb.documents.azure.com:443/", credential="key==")
    database = client.get_database_client("mydb")

    if name:
        return func.HttpResponse(f"Hello, {name}!")
    else:
        return func.HttpResponse("Pass a name", status_code=400)
