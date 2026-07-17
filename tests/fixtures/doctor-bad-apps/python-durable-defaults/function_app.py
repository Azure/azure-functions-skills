import azure.durable_functions as df

app = df.DFApp()


@app.orchestration_trigger(context_name="context")
def orchestrator(context: df.DurableOrchestrationContext):
    result = yield context.call_activity("work")
    return result
