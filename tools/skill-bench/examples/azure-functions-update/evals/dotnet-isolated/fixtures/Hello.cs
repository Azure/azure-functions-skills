using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.Extensions.Logging;

namespace UpgradeApp;

public sealed class Hello
{
    private readonly GreetingService _greetings;

    public Hello(GreetingService greetings)
    {
        _greetings = greetings;
    }

    [FunctionName("Hello")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "hello")] HttpRequest request,
        ILogger log)
    {
        string name = request.Query["name"];
        string greeting = _greetings.Create(name);
        log.LogInformation("HTTP greeting: {Greeting}", greeting);
        return new OkObjectResult(greeting);
    }
}