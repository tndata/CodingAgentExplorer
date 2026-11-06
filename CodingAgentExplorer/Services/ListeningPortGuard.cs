namespace CodingAgentExplorer.Services;

/// <summary>
/// Keeps the four ports apart. Endpoints are matched on the Host header (RequireHost("*:5000") and the
/// YARP routes for localhost:8888 and localhost:9999), and the Host header is chosen by the client, not by
/// the port the request arrived on. Without this check, a request to port 8888 with "Host: localhost:5000"
/// would reach the dashboard endpoints, and a request to port 5000 with "Host: localhost:8888" would be
/// proxied to the API. So the port in the Host header must be the port the request arrived on.
/// </summary>
internal static class ListeningPortGuard
{
    internal static bool IsAllowed(int? hostPort, int localPort) => hostPort == localPort;

    public static async Task Middleware(HttpContext context, RequestDelegate next)
    {
        if (!IsAllowed(context.Request.Host.Port, context.Connection.LocalPort))
        {
            context.Response.StatusCode = StatusCodes.Status421MisdirectedRequest;
            return;
        }

        await next(context);
    }
}
