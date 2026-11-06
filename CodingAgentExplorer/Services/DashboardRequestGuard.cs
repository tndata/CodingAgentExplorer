namespace CodingAgentExplorer.Services;

/// <summary>
/// Endpoint filter for the settings endpoints (API upstream and MCP destination). These settings decide
/// where the proxy sends traffic, and with it the API key or MCP tokens, so only the dashboard itself may
/// change them:
/// - the Host header must be a loopback name (blocks DNS rebinding: a web page whose own host name resolves
///   to 127.0.0.1 still sends its own name as Host), and
/// - if the browser sends an Origin header, it must be the dashboard on port 5000 or 5001 (blocks other
///   web pages and other local web apps). Clients without Origin (curl, scripts) are allowed, because they
///   already run on this machine.
/// </summary>
internal static class DashboardRequestGuard
{
    private static readonly HashSet<string> LoopbackHosts =
        new(StringComparer.OrdinalIgnoreCase) { "localhost", "127.0.0.1", "[::1]", "::1" };

    internal static bool IsAllowed(string? host, string? origin)
    {
        if (string.IsNullOrEmpty(host) || !LoopbackHosts.Contains(host))
            return false;

        if (string.IsNullOrEmpty(origin))
            return true;

        return Uri.TryCreate(origin, UriKind.Absolute, out var o)
            && LoopbackHosts.Contains(o.Host)
            && o.Port is 5000 or 5001;
    }

    internal static bool IsDashboardPort(int localPort) => localPort is 5000 or 5001;

    /// <summary>
    /// Applies the same check to every request on the dashboard ports: the pages, the hook endpoint and above all
    /// the SignalR hub, which sends all captured traffic to whoever connects. WebSockets are not covered by CORS,
    /// so without this any web page could open ws://localhost:5000/hub and read it.
    /// </summary>
    public static async Task Middleware(HttpContext context, RequestDelegate next)
    {
        if (IsDashboardPort(context.Connection.LocalPort)
            && !IsAllowed(context.Request.Host.Host, context.Request.Headers.Origin.ToString()))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        await next(context);
    }

    public static async ValueTask<object?> Filter(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.HttpContext.Request;
        if (!IsAllowed(request.Host.Host, request.Headers.Origin.ToString()))
            return Results.Problem(
                "Settings can only be changed from the CodingAgentExplorer dashboard on localhost.",
                statusCode: StatusCodes.Status403Forbidden);

        return await next(context);
    }
}
