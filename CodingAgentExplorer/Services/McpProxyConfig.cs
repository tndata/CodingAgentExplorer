using Microsoft.Extensions.Primitives;

namespace CodingAgentExplorer.Services;

public class McpProxyConfig
{
    private volatile string? _destinationUrl;
    private CancellationTokenSource _cts = new();
    private readonly object _lock = new();

    public string? DestinationUrl => _destinationUrl;

    public IChangeToken GetChangeToken() => new CancellationChangeToken(_cts.Token);

    public void SetDestination(string? url)
    {
        lock (_lock)
        {
            _destinationUrl = string.IsNullOrWhiteSpace(url) ? null : url.Trim();
            var old = _cts;
            _cts = new CancellationTokenSource();
            old.Cancel(); // signals YARP to call GetConfig() again
        }
    }

    // Split e.g. "https://gitmcp.io/tndata/CloudDebugger"
    // into host "https://gitmcp.io" and pathPrefix "/tndata/CloudDebugger"
    public (string host, string pathPrefix)? ParseDestination()
    {
        if (_destinationUrl is null) return null;
        if (!Uri.TryCreate(_destinationUrl, UriKind.Absolute, out var uri)) return null;
        var host = $"{uri.Scheme}://{uri.Authority}";
        var pathPrefix = uri.AbsolutePath.TrimEnd('/');
        return (host, pathPrefix);
    }
}
