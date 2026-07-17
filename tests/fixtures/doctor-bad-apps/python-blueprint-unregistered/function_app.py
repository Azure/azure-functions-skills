import azure.functions as func

app = func.FunctionApp()
jobs = func.Blueprint()


@jobs.queue_trigger(arg_name="message", queue_name="jobs", connection="Storage")
def process_job(message: func.QueueMessage) -> None:
    print(message.get_body().decode())
