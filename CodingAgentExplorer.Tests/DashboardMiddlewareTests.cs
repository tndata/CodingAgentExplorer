using CodingAgentExplorer.Services;
using Microsoft.AspNetCore.Http;

namespace CodingAgentExplorer.Tests;

// The middleware that guards every request on the dashboard ports (D-05, finding H1).
public class DashboardMiddlewareTests
{
    private static async Task<(int status, bool nextCalled)> Run(int localPort, string host, string path, string? origin)
    {
        var context = new DefaultHttpContext();
        context.Connection.LocalPort = localPort;
        context.Request.Host = new HostString(host);
        context.Request.Path = path;
        if (origin is not null)
            context.Request.Headers.Origin = origin;

        var nextCalled = false;
        await DashboardRequestGuard.Middleware(context, _ => { nextCalled = true; return Task.CompletedTask; });
        return (context.Response.StatusCode, nextCalled);
    }

    [Theory]
    [InlineData("https://evil.example")]                 // any web site opening ws://localhost:5000/hub
    [InlineData("http://localhost:3000")]                // another local web app
    [InlineData("null")]                                 // sandboxed iframe or file:// page
    public async Task Hub_from_a_foreign_origin_is_blocked(string origin)
    {
        var (status, nextCalled) = await Run(5000, "localhost:5000", "/hub", origin);
        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.False(nextCalled);
    }

    [Fact]
    public async Task Dns_rebinding_host_is_blocked()
    {
        var (status, nextCalled) = await Run(5000, "attacker.example:5000", "/hub", null);
        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.False(nextCalled);
    }

    [Theory]
    [InlineData(5000, "localhost:5000", "/hub", "http://localhost:5000")]     // the dashboard itself
    [InlineData(5001, "localhost:5001", "/hub", "https://localhost:5001")]
    [InlineData(5000, "127.0.0.1:5000", "/hub", "http://127.0.0.1:5000")]
    [InlineData(5000, "localhost:5000", "/api/hook-event", null)]            // HookAgent sends no Origin
    [InlineData(5000, "localhost:5000", "/", null)]                          // opening the dashboard page
    public async Task Dashboard_and_local_tools_are_allowed(int port, string host, string path, string? origin)
    {
        var (_, nextCalled) = await Run(port, host, path, origin);
        Assert.True(nextCalled);
    }

    [Theory]
    [InlineData(8888)]
    [InlineData(9999)]
    public async Task Proxy_ports_are_not_affected(int port)
    {
        var (_, nextCalled) = await Run(port, $"localhost:{port}", "/v1/messages", "https://evil.example");
        Assert.True(nextCalled);
    }
}
