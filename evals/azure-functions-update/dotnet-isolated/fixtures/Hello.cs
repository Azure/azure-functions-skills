using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;

namespace UpgradeApp;

public static class Hello
{
    [FunctionName("Hello")]
    public static IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "hello")] HttpRequest request)
    {
        string name = request.Query["name"];
        return new OkObjectResult($"Hello, {(string.IsNullOrEmpty(name) ? "world" : name)}!");
    }
}