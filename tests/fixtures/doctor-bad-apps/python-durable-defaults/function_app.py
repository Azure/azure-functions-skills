import azure.durable_functions as df

app = df.DFApp()


@app.orchestration_trigger(context_name="context")
def orchestrator(context: df.DurableOrchestrationContext):
    result = yield context.call_activity("work")
    return result


@app.activity_trigger(input_name="activity_input")
def work(activity_input: str) -> str:
    return activity_input
