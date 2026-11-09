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
builder.Services.AddSingleton<ApiUpstreamConfig>();
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

// Show where port 8888 forwards to (fails at startup if the configured URL is invalid)
var apiUpstream = app.Services.GetRequiredService<ApiUpstreamConfig>();
var apiUpstreamUrl = apiUpstream.ActiveUrl;
var apiUpstreamSource = apiUpstream.StartupSource;
app.Logger.LogInformation("API upstream (port 8888): {Url} (from {Source})",
    apiUpstreamUrl, apiUpstreamSource);

// The port in the Host header must be the port the request arrived on (see ListeningPortGuard),
// so the RequireHost port checks below and the YARP host matches really bind to the listening port.
app.Use(ListeningPortGuard.Middleware);

// Dashboard ports (pages, hub, hook endpoint): loopback Host only, and a browser Origin must be the dashboard.
// Blocks other web pages (cross-site WebSocket to the hub) and DNS rebinding. HookAgent and scripts send no Origin.
app.Use(DashboardRequestGuard.Middleware);

// Serve static files only on dashboard ports. UseDefaultFiles makes a folder URL such as
// /inspector/ serve that folder's index.html instead of falling through to the start page.
app.UseWhen(
    ctx => ctx.Connection.LocalPort is 5000 or 5001,
    branch => branch.UseDefaultFiles().UseStaticFiles());

// Route after the static files: otherwise routing runs first and the index.html fallback below
// already claims /inspector/ before UseDefaultFiles can rewrite it.
app.UseRouting();

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
    hookEvent.Stdout = "";                     // empty: stdout from some hooks is added to Claude's context, and an observer must not change what it observes
    hookEvent.Stderr = "";

    hookStore.Add(hookEvent);
    await hub.Clients.All.SendAsync("NewHookEvent", hookEvent);

    return Results.Ok(new {
        exitCode = hookEvent.ExitCode,
        stdout   = hookEvent.Stdout,
        stderr   = hookEvent.Stderr
    });
})
.RequireHost(DashboardPort5000, DashboardPort5001);   // dashboard ports only, not the proxy ports (ListeningPortGuard)

// Settings endpoints. They decide where the proxies send traffic (and with it the API key or MCP tokens),
// so DashboardRequestGuard only lets the dashboard itself change them.

// MCP destination (port 9999)
app.MapGet("/api/mcp-destination", (McpProxyConfig mcpConfig) =>
    Results.Ok(new { destinationUrl = mcpConfig.DestinationUrl }))
.RequireHost(DashboardPort5000, DashboardPort5001)
.AddEndpointFilter(DashboardRequestGuard.Filter);

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
.RequireHost(DashboardPort5000, DashboardPort5001)
.AddEndpointFilter(DashboardRequestGuard.Filter);

// API upstream (port 8888): where Claude Code's model requests go. Set on the Settings page.
app.MapGet("/api/settings/api-upstream", (ApiUpstreamConfig upstream) =>
    Results.Ok(upstream.Describe()))
.RequireHost(DashboardPort5000, DashboardPort5001)
.AddEndpointFilter(DashboardRequestGuard.Filter);

app.MapPost("/api/settings/api-upstream", async (
    ApiUpstreamRequest body,
    ApiUpstreamConfig upstream,
    IHubContext<DashboardHub> hub,
    ILogger<ApiUpstreamConfig> logger) =>
{
    if (!upstream.TrySetOverride(body.Url, out var error))
        return Results.BadRequest(new { error });

    // The URL is normalised by TryNormalize (Uri escapes control characters), but strip line breaks
    // anyway so a value from the Settings page can never forge an extra log line.
    var loggedUrl = upstream.ActiveUrl.Replace("\r", "").Replace("\n", "");
    logger.LogInformation("API upstream (port 8888) changed to {Url} (from {Source})",
        loggedUrl, upstream.ActiveSource);
    var state = upstream.Describe();
    await hub.Clients.All.SendAsync("ApiUpstreamChanged", state);
    return Results.Ok(state);
})
.RequireHost(DashboardPort5000, DashboardPort5001)
.AddEndpointFilter(DashboardRequestGuard.Filter);

app.MapFallbackToFile("index.html").RequireHost(DashboardPort5000, DashboardPort5001);

// YARP reverse proxy (routes built in DynamicProxyConfigProvider: 8888 to the API upstream, 9999 to MCP)
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
