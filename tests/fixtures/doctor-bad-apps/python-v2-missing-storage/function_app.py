import azure.functions as func

app = func.FunctionApp()


@app.queue_trigger(arg_name="message", queue_name="jobs", connection="Storage")
def process_job(message: func.QueueMessage) -> None:
    print(message.get_body().decode())
