using Microsoft.Extensions.Primitives;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Forwarder;
using CodingAgentExplorer.Services;

namespace CodingAgentExplorer.Proxy;

public class DynamicProxyConfigProvider(
    McpProxyConfig mcpConfig,
    ApiUpstreamConfig apiUpstream) : IProxyConfigProvider
{
    private static readonly ForwarderRequestConfig LongTimeout = new()
    {
        ActivityTimeout = TimeSpan.FromMinutes(10),
        AllowResponseBuffering = false
    };

    public IProxyConfig GetConfig()
    {
        // API upstream (port 8888), e.g. "https://api.anthropic.com" or "http://localhost:1234".
        // A path in the URL (a gateway under "/anthropic") is prepended to every request path.
        var (apiHost, apiPathPrefix) = ApiUpstreamConfig.Split(apiUpstream.ActiveUrl);

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
                },
                Transforms = string.IsNullOrEmpty(apiPathPrefix)
                    ? null
                    : [new Dictionary<string, string> { ["PathPrefix"] = apiPathPrefix }]
            }
        };

        var clusters = new List<ClusterConfig>
        {
            new()
            {
                ClusterId = "anthropic-cluster",
                Destinations = new Dictionary<string, DestinationConfig>
                {
                    ["dest"] = new() { Address = apiHost }
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

        // Reload when either the MCP destination or the API upstream changes
        var combinedChangeToken = new CompositeChangeToken(
        [
            mcpConfig.GetChangeToken(),
            apiUpstream.GetChangeToken()
        ]);

        return new InMemoryProxyConfig(routes, clusters, combinedChangeToken);
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
