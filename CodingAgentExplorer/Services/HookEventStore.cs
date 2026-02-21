using System.Collections.Concurrent;
using CodingAgentExplorer.Models;

namespace CodingAgentExplorer.Services;

public class HookEventStore
{
    private readonly ConcurrentQueue<HookEvent> _events = new();
    private readonly int _maxSize;

    public HookEventStore(int maxSize = 1000)
    {
        _maxSize = maxSize;
    }

    public void Add(HookEvent hookEvent)
    {
        _events.Enqueue(hookEvent);

        while (_events.Count > _maxSize)
        {
            _events.TryDequeue(out _);
        }
    }

    public List<HookEvent> GetAll()
    {
        return _events.ToList();
    }

    public HookEvent? GetById(string id)
    {
        return _events.FirstOrDefault(e => e.Id == id);
    }

    public void Clear()
    {
        while (_events.TryDequeue(out _))
        {
            // Intentionally empty — drain the queue
        }
    }

    public int Count => _events.Count;
}
