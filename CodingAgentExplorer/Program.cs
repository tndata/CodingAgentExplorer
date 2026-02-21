using CodingAgentExplorer.Hubs;
using CodingAgentExplorer.Models;
using CodingAgentExplorer.Proxy;
using CodingAgentExplorer.Services;
using Microsoft.AspNetCore.SignalR;
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
builder.Services.AddSingleton<HookEventStore>();
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

app.MapPost("/api/hook-event", async (
    HttpContext ctx,
    HookEventStore hookStore,
    IHubContext<DashboardHub> hub) =>
{
    var hookEvent = await ctx.Request.ReadFromJsonAsync<HookEvent>();
    if (hookEvent is null) return Results.BadRequest();

    hookEvent.Timestamp = DateTime.UtcNow;     // server clock for timeline accuracy
    hookEvent.ExitCode = 0;
    hookEvent.Stdout = $"Hook '{hookEvent.HookEventName}' captured";
    hookEvent.Stderr = "";

    hookStore.Add(hookEvent);
    await hub.Clients.All.SendAsync("NewHookEvent", hookEvent);

    return Results.Ok(new {
        exitCode = hookEvent.ExitCode,
        stdout   = hookEvent.Stdout,
        stderr   = hookEvent.Stderr
    });
})
.RequireHost("*:5000", "*:5001");   // NOT on :8888 (YARP proxy port)

app.MapFallbackToFile("index.html").RequireHost("*:5000", "*:5001");

// YARP reverse proxy (port 8888 only, via Hosts match in appsettings.json)
app.MapReverseProxy();

await app.RunAsync();
