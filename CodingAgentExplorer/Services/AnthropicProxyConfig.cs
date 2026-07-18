using Microsoft.Extensions.Primitives;

namespace CodingAgentExplorer.Services;

public class AnthropicProxyConfig
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
}
