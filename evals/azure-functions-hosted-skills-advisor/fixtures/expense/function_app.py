import json
import re
from decimal import Decimal

import azure.functions as func

app = func.FunctionApp()


@app.queue_trigger(arg_name="message", queue_name="expense-requests",
                   connection="AzureWebJobsStorage")
@app.queue_output(arg_name="approved", queue_name="expense-approved",
                  connection="AzureWebJobsStorage")
@app.queue_output(arg_name="review", queue_name="expense-review",
                  connection="AzureWebJobsStorage")
@app.queue_output(arg_name="flagged", queue_name="expense-flagged",
                  connection="AzureWebJobsStorage")
def process_expense(message: func.QueueMessage, approved: func.Out[str],
                    review: func.Out[str], flagged: func.Out[str]) -> None:
    text = message.get_body().decode("utf-8")
    amount_match = re.search(r"(?:USD|\$)\s*(\d+(?:\.\d{1,2})?)", text)
    if amount_match is None:
        flagged.set(json.dumps({"request": text, "reason": "Amount needs manual review"}))
        return
    amount = Decimal(amount_match.group(1))
    lowered = text.lower()
    if "flight" in lowered or "hotel" in lowered:
        category = "travel"
    elif "client dinner" in lowered or "external guest" in lowered:
        category = "client-entertainment"
    elif "lunch" in lowered or "coffee" in lowered:
        category = "meals"
    elif "monitor" in lowered or "laptop" in lowered:
        category = "equipment"
    else:
        category = "general"
    decision = json.dumps({"amount": str(amount), "category": category})
    if category == "client-entertainment":
        review.set(decision)
    elif category == "travel" and amount <= Decimal("500"):
        approved.set(decision)
    elif category == "equipment" and amount <= Decimal("1000"):
        approved.set(decision)
    elif category == "meals" and amount <= Decimal("150"):
        approved.set(decision)
    else:
        review.set(decision)
