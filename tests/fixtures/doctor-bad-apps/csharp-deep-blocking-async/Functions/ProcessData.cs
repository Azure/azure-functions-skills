using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace BlockingApp.Functions;

public class ProcessData
{
    private readonly ILogger<ProcessData> _logger;

    public ProcessData(ILogger<ProcessData> logger)
    {
        _logger = logger;
    }

    // BAD: CS-003 — No CancellationToken parameter
    [Function("ProcessData")]
    public HttpResponseData Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
    {
        _logger.LogInformation("Processing data request");

        // BAD: CS-004 — Creating HttpClient per invocation instead of using IHttpClientFactory
        var httpClient = new HttpClient();

        // BAD: CS-001 — Blocking async call with .Result
        var apiResponse = httpClient.GetAsync("https://api.example.com/data").Result;
        var content = apiResponse.Content.ReadAsStringAsync().Result;
        var data = JsonSerializer.Deserialize<JsonElement>(content);

        // BAD: CS-001 — Blocking with .Wait()
        httpClient.PostAsync("https://api.example.com/log",
            new StringContent(JsonSerializer.Serialize(new { processed = true }))).Wait();

        // BAD: CS-004 — Another HttpClient, not disposed properly
        var notificationClient = new HttpClient();
        notificationClient.PostAsync("https://api.notifications.example.com/send",
            new StringContent("Data processed")).Wait();

        var response = req.CreateResponse(System.Net.HttpStatusCode.OK);
        response.WriteString("Processed");
        return response;
    }

    // BAD: async void — exceptions will crash the process, not be caught by the runtime
    [Function("ProcessAsync")]
    public async void RunAsync(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "process-async")] HttpRequestData req)
    {
        _logger.LogInformation("Async processing");

        // BAD: CS-004 — Yet another HttpClient
        var client = new HttpClient();
        var result = await client.GetAsync("https://api.example.com/data");
        _logger.LogInformation($"Result: {result.StatusCode}");

        // BAD: No response returned from async void method — runtime behavior undefined
    }
}
