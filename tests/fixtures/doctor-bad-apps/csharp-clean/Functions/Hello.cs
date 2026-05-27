using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace CleanApp.Functions;

public class Hello
{
    private readonly ILogger<Hello> _logger;
    private readonly IHttpClientFactory _httpClientFactory;

    public Hello(ILogger<Hello> logger, IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _httpClientFactory = httpClientFactory;
    }

    [Function("Hello")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation("C# HTTP trigger function processed a request.");

        var client = _httpClientFactory.CreateClient();
        var response = await client.GetAsync("https://api.example.com/health", cancellationToken);

        var result = req.CreateResponse(System.Net.HttpStatusCode.OK);
        await result.WriteStringAsync($"Hello! API status: {response.StatusCode}");
        return result;
    }
}
