using Microsoft.Azure.Functions.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection;

[assembly: FunctionsStartup(typeof(InProcessApp.Startup))]

namespace InProcessApp;

public class Startup : FunctionsStartup
{
    public override void Configure(IFunctionsHostBuilder builder)
    {
        // BAD: DI anti-pattern — registering concrete HttpClient as singleton
        // Should use IHttpClientFactory
        builder.Services.AddSingleton(new HttpClient());
    }
}
