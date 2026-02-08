using CodingAgentExplorer.Hubs;
using CodingAgentExplorer.Proxy;
using CodingAgentExplorer.Services;
using Yarp.ReverseProxy.Transforms.Builder;

var builder = WebApplication.CreateBuilder(args);

// Configure dual-port Kestrel
builder.WebHost.ConfigureKestrel(options =>
{
    // Port 8888: Proxy
    options.ListenLocalhost(8888);
    // Port 5001: Dashboard
    options.ListenLocalhost(5001);
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

// Serve static files only on dashboard port
app.UseWhen(
    ctx => ctx.Connection.LocalPort == 5001,
    branch => branch.UseStaticFiles());

// Dashboard endpoints (port 5001 only)
app.MapHub<DashboardHub>("/hub").RequireHost("*:5001");
app.MapFallbackToFile("index.html").RequireHost("*:5001");

// YARP reverse proxy (port 8888 only, via Hosts match in appsettings.json)
app.MapReverseProxy();

app.Run();
