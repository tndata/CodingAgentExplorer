using CodingAgentExplorer.Services;

namespace CodingAgentExplorer.Tests;

public class ListeningPortGuardTests
{
    [Theory]
    [InlineData(5000, 5000)]
    [InlineData(5001, 5001)]
    [InlineData(8888, 8888)]
    [InlineData(9999, 9999)]
    public void Host_port_matching_the_listening_port_is_allowed(int hostPort, int localPort)
    {
        Assert.True(ListeningPortGuard.IsAllowed(hostPort, localPort));
    }

    [Theory]
    [InlineData(5000, 8888)]   // dashboard endpoints reached through the API proxy port
    [InlineData(5000, 9999)]   // dashboard endpoints reached through the MCP proxy port
    [InlineData(8888, 5000)]   // API proxy reached through the dashboard port
    [InlineData(9999, 5001)]   // MCP proxy reached through the dashboard port
    public void Host_port_for_another_listener_is_rejected(int hostPort, int localPort)
    {
        Assert.False(ListeningPortGuard.IsAllowed(hostPort, localPort));
    }

    [Fact]
    public void Host_without_port_is_rejected()
    {
        // No listener runs on port 80 or 443, so a Host header without a port never names this listener.
        Assert.False(ListeningPortGuard.IsAllowed(null, 5000));
    }
}
