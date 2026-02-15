using CodingAgentExplorer.Hubs;
using CodingAgentExplorer.Proxy;
using CodingAgentExplorer.Services;
using Yarp.ReverseProxy.Transforms.Builder;

var builder = WebApplication.CreateBuilder(args);

// Configure Kestrel endpoints
builder.WebHost.ConfigureKestrel(options =>
{
    // Port 8888: Proxy (HTTP)
    options.ListenLocalhost(8888);
    // Port 5000: Dashboard (HTTP)
    options.ListenLocalhost(5000);
    // Port 5001: Dashboard (HTTPS)
    options.ListenLocalhost(5001, listenOptions => listenOptions.UseHttps());
});

// Services
builder.Services.AddSingleton<RequestStore>();
builder.Services.AddSingleton<ITransformProvider, CaptureTransformProvider>();
builder.Services.AddSignalR()
    .AddJsonProtocol(options =>
    {
        options.PayloadSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase;
    });

// YARP
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();

// Serve static files only on dashboard ports
app.UseWhen(
    ctx => ctx.Connection.LocalPort is 5000 or 5001,
    branch => branch.UseStaticFiles());

// Dashboard endpoints (ports 5000/5001 only)
app.MapHub<DashboardHub>("/hub").RequireHost("*:5000", "*:5001");
app.MapFallbackToFile("index.html").RequireHost("*:5000", "*:5001");

// YARP reverse proxy (port 8888 only, via Hosts match in appsettings.json)
app.MapReverseProxy();

await app.RunAsync();
