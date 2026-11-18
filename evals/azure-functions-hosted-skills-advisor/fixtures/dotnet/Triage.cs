using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

public sealed class Triage
{
    [Function("Triage")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData request)
    {
        var text = await new StreamReader(request.Body).ReadToEndAsync();
        var route = Regex.IsMatch(text, "urgent|outage", RegexOptions.IgnoreCase)
            ? "on-call"
            : Regex.IsMatch(text, "invoice|refund", RegexOptions.IgnoreCase)
                ? "billing"
                : "manual-review";
        var response = request.CreateResponse(HttpStatusCode.OK);
        await response.WriteStringAsync(route);
        return response;
    }
}
