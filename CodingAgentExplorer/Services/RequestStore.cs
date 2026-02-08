using System.Collections.Concurrent;
using CodingAgentExplorer.Models;

namespace CodingAgentExplorer.Services;

public class RequestStore
{
    private readonly ConcurrentQueue<ProxiedRequest> _requests = new();
    private readonly int _maxSize;

    public RequestStore(int maxSize = 1000)
    {
        _maxSize = maxSize;
    }

    public void Add(ProxiedRequest request)
    {
        _requests.Enqueue(request);

        while (_requests.Count > _maxSize)
        {
            _requests.TryDequeue(out _);
        }
    }

    public List<ProxiedRequest> GetAll()
    {
        return _requests.ToList();
    }

    public ProxiedRequest? GetById(string id)
    {
        return _requests.FirstOrDefault(r => r.Id == id);
    }

    public void Clear()
    {
        while (_requests.TryDequeue(out _)) { }
    }

    public int Count => _requests.Count;
}
