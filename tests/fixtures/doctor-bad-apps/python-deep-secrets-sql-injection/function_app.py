import azure.functions as func
import logging
import pyodbc

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# BAD: SC-001 — SAS token hardcoded in source
BLOB_SAS_URL = (
    "https://mystorage.blob.core.windows.net/data"
    "?sv=2021-06-08&ss=b&srt=sco"
    "&sp=rwdlacyx&se=2025-12-31T23:59:59Z"
    "&st=2024-01-01T00:00:00Z"
    "&spr=https&sig=aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5zA%3D"
)

# BAD: SC-001 — Database connection string with credentials in source
DB_CONNECTION = "Driver={ODBC Driver 18 for SQL Server};Server=tcp:myserver.database.windows.net,1433;Database=mydb;Uid=adminuser;Pwd=SuperSecret123!;Encrypt=yes;TrustServerCertificate=no;"


@app.route(route="users/{userId}")
def get_user(req: func.HttpRequest) -> func.HttpResponse:
    user_id = req.route_params.get("userId", "")
    action = req.params.get("action", "select")

    # BAD: SC-009 — SQL injection via f-string
    query = f"SELECT * FROM users WHERE id = '{user_id}' AND status = '{action}'"
    logging.info(f"Executing query: {query}")

    # BAD: CQ-007 — No error handling for database operations
    conn = pyodbc.connect(DB_CONNECTION)
    cursor = conn.cursor()
    cursor.execute(query)
    rows = cursor.fetchall()

    # BAD: CQ-001 — Connection not properly closed (no context manager)
    result = [{"id": row[0], "name": row[1]} for row in rows]

    return func.HttpResponse(str(result), status_code=200)


@app.route(route="report")
def generate_report(req: func.HttpRequest) -> func.HttpResponse:
    # BAD: SC-009 — Another SQL injection vector
    table_name = req.params.get("table", "users")
    columns = req.params.get("columns", "*")
    query = f"SELECT {columns} FROM {table_name}"

    conn = pyodbc.connect(DB_CONNECTION)
    cursor = conn.cursor()
    cursor.execute(query)
    data = cursor.fetchall()
    conn.close()

    return func.HttpResponse(str(data), status_code=200)
