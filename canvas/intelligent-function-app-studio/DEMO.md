# Functions Hosted Skills Studio, end to end demo

## Bootstrap the demo

```bash
copilot plugin marketplace add coreai-microsoft/canvases-cloud-foundation
copilot plugin install intelligent-function-app-studio@canvases-cloud-foundation
```

Reload extensions, then start a fresh chat or child session. The plugin install contributes both the canvas extension and its launcher skill, so the prompt works from any repository.

A short walkthrough of the Functions Hosted Skills Studio canvas: open it from the daily-digest prompt, let it prepare the working copy and local runtime, run the real trigger flow, then test and observe the app before handing it off.

The story arc: **prompt -> discover canvas -> watch the working copy appear -> run the Timer trigger -> load test and observe telemetry -> hand off to a GitHub session or Azure deployment.**

---

## Act 1, Discover the canvas from a prompt

Close the canvas, then start from the same request a developer would use in a fresh chat or child session:

> Build a daily digest app that scans a GitHub repo for work items, issues, pull requests, workflow failures, and other changes, then creates an intelligent summary.

The launcher skill opens **Functions Hosted Skills Studio**. It should open the Studio before any native Automation flow or hand-written implementation starts. If you already know where you want to go, you can also say *"Open Functions Hosted Skills Studio"*.

Point: *I described the app I wanted, and the right canvas opened with the template and runtime choices already lined up for that scenario.*

---

## Act 2, Watch the working copy and local runtime come up

1. As soon as the canvas opens, it clones the daily-digest template. There is no separate **Load template** step. Watch the first **Commands** entry to confirm the clone started.
2. The Timer agent instructions become the working copy, and the canvas generates HTTP, Queue, and Microsoft 365 Inbox siblings from those same instructions.
3. Check the collapsed **MODEL ENDPOINT** summary, or expand it to pick an existing Microsoft Foundry or AI Gateway model. Stay on existing endpoints here. **New** is visible but marked **NYI**.
4. Wait for the local setup to finish. The canvas creates the Python virtual environment, installs the app requirements, starts Azure Functions Core Tools, and uses Azurite for the Timer schedule store.
5. Leave the cadence on **Daily**, or choose **Weekly** with a weekday and local time, or **Hourly** with a minute offset. The Studio writes the corresponding NCRONTAB schedule into the generated Timer agent source.

Point: *The working copy, model binding, and local Functions host come up automatically, so I can move from prompt to a runnable app without manual setup steps inside the canvas.*

---

## Act 3, Invoke the Timer trigger and follow the real run

1. Leave **Trigger** on **Timer** and click **Invoke Trigger**.
2. The canvas calls the local Functions admin API to start the run, then keeps tracking the asynchronous execution through completion.
3. Follow **Trigger activity** as the digest runs. You can watch start and completion state, GitHub MCP call progress, raw-to-compacted result bytes, retries, duration, and the final **Agent digest** card.
4. Expand **Commands** and the local host log when you want the underlying `func`, REST, and runtime details.
5. Want a direct request and response instead? Switch **Trigger** to **HTTP** and click **Invoke Trigger** again. That path uses the generated HTTP twin and waits for the response synchronously.
6. Choose **Queue** to create the workspace's isolated `agent-input-<12hex>` queue in local Azurite and enqueue one representative JSON message. Choose **Connector** to exercise the Microsoft 365 Inbox agent through its chat endpoint with safe `RUN MODE: DRY RUN` trigger data. The Connector path does not call Microsoft 365 or emulate its private webhook envelope.

Point: *This is not a mock run. I can watch the real Timer execution from the admin API acknowledgement through GitHub retrieval and the final digest output.*

---

## Act 4, Load test it, then watch telemetry

1. Click **Load test** to send `oha` bursts at the HTTP endpoint and update the chart with RPS, latency, and error numbers from `oha`'s own output.
2. You can aim that load test at local or Azure HTTP endpoints, depending on what you want to inspect.
3. If you switch **Source** to an **Azure Function App**, **Open in Application Insights** jumps to the matched Application Insights resource.
4. Turn on live telemetry polling for the selected Azure app to watch near-real-time request and failure data while the load test runs.

Point: *I can move from functional validation to throughput and observability without leaving the canvas flow.*

---

## Act 5, Hand off the working app

1. Under **New local function**, confirm that **Local function path** points at `functions/daily-repo-digest`. The Studio creates it automatically; use **Change** to move the complete app to another unoccupied subfolder.
2. Open **Change** and click **Remove generated skill** before editing generated files to remove the Studio-owned folder safely. Added, removed, or modified files block removal, and the Studio does not recreate an explicitly removed app unless you click **Create here**.
3. Click **Deploy to Azure** only when you are ready to run the template's own `azd up` flow.
4. The canvas does not provision or mutate Azure resources on its own. Azure changes happen only after the user explicitly starts that deployment action.

Point: *The canvas gets me to a working local app, then hands me off cleanly for code work or an explicit deployment step.*

---

## One-liner

*Prompt -> open the daily-digest canvas -> let it clone and bind a model -> run the Timer trigger -> load test and observe telemetry -> hand off to a GitHub session or explicit `azd up`.*

Runtime background:
<https://learn.microsoft.com/en-us/azure/azure-functions/functions-serverless-agents-runtime>
