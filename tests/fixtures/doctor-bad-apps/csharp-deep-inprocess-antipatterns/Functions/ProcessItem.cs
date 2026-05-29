using System;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.Extensions.Logging;

namespace InProcessApp.Functions;

public class ProcessItem
{
    // BAD: CS-004 — Static HttpClient with disposal in finalizer
    private static HttpClient _client = new HttpClient();
    private readonly HttpClient _injectedClient;

    public ProcessItem(HttpClient injectedClient)
    {
        _injectedClient = injectedClient;
    }

    // BAD: CS-002 — In-process function attribute style (FunctionName instead of Function)
    [FunctionName("ProcessItem")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req,
        // BAD: CS-003 — No CancellationToken
        ILogger log)
    {
        log.LogInformation("Processing item");

        // BAD: Uses static client and injected client interchangeably
        var externalData = await _client.GetStringAsync("https://api.example.com/items");
        var result = await _injectedClient.PostAsync("https://api.example.com/process",
            new StringContent(externalData));

        // BAD: CQ-007 — No error handling
        return new OkObjectResult(new { processed = true, data = externalData });
    }

    // BAD: Finalizer tries to dispose static HttpClient — this is wrong
    ~ProcessItem()
    {
        _client?.Dispose();
    }
}
