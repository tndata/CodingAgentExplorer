using CodingAgentExplorer.Hubs;
using CodingAgentExplorer.Models;
using CodingAgentExplorer.Proxy;
using CodingAgentExplorer.Services;
using Microsoft.AspNetCore.SignalR;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Transforms.Builder;

const string DashboardPort5000 = "*:5000";
const string DashboardPort5001 = "*:5001";

var builder = WebApplication.CreateBuilder(args);

// Configure Kestrel endpoints
builder.WebHost.ConfigureKestrel(options =>
{
    // Port 8888: Claude API proxy (HTTP)
    options.ListenLocalhost(8888);
    // Port 9999: MCP proxy (HTTP)
    options.ListenLocalhost(9999);
    // Port 5000: Dashboard (HTTP)
    options.ListenLocalhost(5000);
    // Port 5001: Dashboard (HTTPS)
    options.ListenLocalhost(5001, listenOptions => listenOptions.UseHttps());
});

// Services
builder.Services.AddSingleton<RequestStore>();
builder.Services.AddSingleton<HookEventStore>();
builder.Services.AddSingleton<McpProxyConfig>();
builder.Services.AddSingleton<McpRequestStore>();
builder.Services.AddSingleton<ITransformProvider, CaptureTransformProvider>();
builder.Services.AddSignalR()
    .AddJsonProtocol(options =>
    {
        options.PayloadSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase;
    });

// YARP with dynamic config (handles both Claude on :8888 and MCP on :9999)
builder.Services.AddReverseProxy();
builder.Services.AddSingleton<IProxyConfigProvider, DynamicProxyConfigProvider>();

var app = builder.Build();

// Serve static files only on dashboard ports
app.UseWhen(
    ctx => ctx.Connection.LocalPort is 5000 or 5001,
    branch => branch.UseStaticFiles());

// Dashboard endpoints (ports 5000/5001 only)
app.MapHub<DashboardHub>("/hub").RequireHost(DashboardPort5000, DashboardPort5001);

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
.RequireHost(DashboardPort5000, DashboardPort5001);   // NOT on :8888 (YARP proxy port)

// MCP destination config endpoints
app.MapGet("/api/mcp-destination", (McpProxyConfig mcpConfig) =>
    Results.Ok(new { destinationUrl = mcpConfig.DestinationUrl }))
.RequireHost(DashboardPort5000, DashboardPort5001);

app.MapPost("/api/mcp-destination", async (
    HttpContext ctx,
    McpProxyConfig mcpConfig,
    McpRequestStore mcpStore,
    IHubContext<DashboardHub> hub) =>
{
    var body = await ctx.Request.ReadFromJsonAsync<McpDestinationRequest>();
    mcpConfig.SetDestination(body?.Url);
    mcpStore.Clear();
    await hub.Clients.All.SendAsync("McpConfigChanged", new { destinationUrl = mcpConfig.DestinationUrl });
    await hub.Clients.All.SendAsync("McpCleared");
    return Results.Ok();
})
.RequireHost(DashboardPort5000, DashboardPort5001);

app.MapFallbackToFile("index.html").RequireHost(DashboardPort5000, DashboardPort5001);

// YARP reverse proxy (port 8888 only, via Hosts match in appsettings.json)
app.MapReverseProxy();

// Fallback for port 9999 when no MCP destination is configured (YARP has no route).
// Returns a JSON-RPC error so Claude Code gets a parseable response instead of an empty body,
// which would otherwise trigger OAuth discovery and "not authenticated" state.
app.MapFallback(() => Results.Json(new
{
    jsonrpc = "2.0",
    id = (object?)null,
    error = new
    {
        code = -32603,
        message = "MCP proxy destination not configured. Set the destination URL in the CodingAgentExplorer dashboard."
    }
}, statusCode: 200)).RequireHost("*:9999");

await app.RunAsync();
