using Microsoft.Extensions.Hosting;

var host = new HostBuilder().ConfigureFunctionsWorkerDefaults().Build();
await host.RunAsync();
