using Microsoft.Extensions.Primitives;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Forwarder;
using CodingAgentExplorer.Services;

namespace CodingAgentExplorer.Proxy;

public class DynamicProxyConfigProvider(McpProxyConfig mcpConfig) : IProxyConfigProvider
{
    private static readonly ForwarderRequestConfig LongTimeout = new()
    {
        ActivityTimeout = TimeSpan.FromMinutes(10),
        AllowResponseBuffering = false
    };

    public IProxyConfig GetConfig()
    {
        var routes = new List<RouteConfig>
        {
            new()
            {
                RouteId = "anthropic-route",
                ClusterId = "anthropic-cluster",
                Match = new RouteMatch
                {
                    Hosts = ["localhost:8888", "127.0.0.1:8888"],
                    Path = "{**catch-all}"
                }
            }
        };

        var clusters = new List<ClusterConfig>
        {
            new()
            {
                ClusterId = "anthropic-cluster",
                Destinations = new Dictionary<string, DestinationConfig>
                {
                    ["dest"] = new() { Address = "https://api.anthropic.com" }
                },
                HttpRequest = LongTimeout
            }
        };

        // Add MCP route only when a destination is configured
        var mcp = mcpConfig.ParseDestination();
        if (mcp.HasValue)
        {
            var (host, pathPrefix) = mcp.Value;
            routes.Add(new RouteConfig
            {
                RouteId = "mcp-route",
                ClusterId = "mcp-cluster",
                Match = new RouteMatch
                {
                    Hosts = ["localhost:9999", "127.0.0.1:9999"],
                    Path = "{**catch-all}"
                },
                // Prepend the path from the destination URL (e.g. /tndata/CloudDebugger)
                Transforms = string.IsNullOrEmpty(pathPrefix)
                    ? null
                    : [new Dictionary<string, string> { ["PathPrefix"] = pathPrefix }]
            });

            clusters.Add(new ClusterConfig
            {
                ClusterId = "mcp-cluster",
                Destinations = new Dictionary<string, DestinationConfig>
                {
                    ["dest"] = new() { Address = host }
                },
                HttpRequest = LongTimeout
            });
        }

        return new InMemoryProxyConfig(routes, clusters, mcpConfig.GetChangeToken());
    }
}

internal sealed class InMemoryProxyConfig(
    IReadOnlyList<RouteConfig> routes,
    IReadOnlyList<ClusterConfig> clusters,
    IChangeToken changeToken) : IProxyConfig
{
    public IReadOnlyList<RouteConfig> Routes { get; } = routes;
    public IReadOnlyList<ClusterConfig> Clusters { get; } = clusters;
    public IChangeToken ChangeToken { get; } = changeToken;
}
