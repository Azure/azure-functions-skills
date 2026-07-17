import azure.functions as func
import requests

app = func.FunctionApp()
jobs = func.Blueprint()


@jobs.queue_trigger(
    arg_name="message",
    queue_name="jobs",
    connection="AzureWebJobsStorage",
)
async def process_job(message: func.QueueMessage) -> None:
    requests.get("https://example.com/status", timeout=10)
