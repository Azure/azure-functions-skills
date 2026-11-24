using Microsoft.Azure.Functions.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection;
using UpgradeApp;

[assembly: FunctionsStartup(typeof(Startup))]

namespace UpgradeApp;

public sealed class Startup : FunctionsStartup
{
    public override void Configure(IFunctionsHostBuilder builder)
    {
        builder.Services.AddSingleton<GreetingService>();
    }
}
