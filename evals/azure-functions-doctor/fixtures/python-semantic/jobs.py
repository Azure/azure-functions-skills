import logging

import azure.functions as func

jobs = func.Blueprint()


@jobs.queue_trigger(
    arg_name="message",
    queue_name="jobs",
    connection="AzureWebJobsStorage",
)
def process_job(message: func.QueueMessage) -> None:
    logging.info("Processing queue message")
