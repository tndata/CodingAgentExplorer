using System.Collections.Concurrent;
using CodingAgentExplorer.Models;

namespace CodingAgentExplorer.Services;

public class McpRequestStore
{
    private readonly ConcurrentQueue<ProxiedRequest> _requests = new();
    private const int MaxSize = 500;

    public void Add(ProxiedRequest request)
    {
        _requests.Enqueue(request);
        while (_requests.Count > MaxSize)
            _requests.TryDequeue(out _);
    }

    public List<ProxiedRequest> GetAll() => _requests.ToList();

    public void Clear() => _requests.Clear();
}
