using System.IO;
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;

namespace UpgradeApp;

public sealed class QueueGreeting
{
    private readonly GreetingService _greetings;

    public QueueGreeting(GreetingService greetings)
    {
        _greetings = greetings;
    }

    [FunctionName("QueueGreeting")]
    public void Run(
        [QueueTrigger("greeting-requests", Connection = "AzureWebJobsStorage")] string requestId,
        [Blob("greeting-input/{queueTrigger}.txt", FileAccess.Read, Connection = "AzureWebJobsStorage")] string name,
        [Blob("greeting-output/{queueTrigger}.txt", FileAccess.Write, Connection = "AzureWebJobsStorage")] out string output,
        ILogger log)
    {
        output = _greetings.Create(name);
        log.LogInformation("Queue greeting {RequestId}: {Greeting}", requestId, output);
    }
}
