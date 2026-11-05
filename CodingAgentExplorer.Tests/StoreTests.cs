using CodingAgentExplorer.Models;
using CodingAgentExplorer.Services;

namespace CodingAgentExplorer.Tests;

public class StoreTests
{
    [Fact]
    public void RequestStore_keeps_only_the_newest_items_up_to_max_size()
    {
        var store = new RequestStore(maxSize: 3);
        for (var i = 1; i <= 5; i++)
            store.Add(new ProxiedRequest { Id = $"r{i}" });

        Assert.Equal(3, store.Count);
        Assert.Equal(["r3", "r4", "r5"], store.GetAll().Select(r => r.Id));
        Assert.Null(store.GetById("r1"));
        Assert.NotNull(store.GetById("r5"));
    }

    [Fact]
    public void RequestStore_Clear_empties_it()
    {
        var store = new RequestStore();
        store.Add(new ProxiedRequest());
        store.Clear();

        Assert.Equal(0, store.Count);
    }

    [Fact]
    public void HookEventStore_keeps_only_the_newest_items_up_to_max_size()
    {
        var store = new HookEventStore(maxSize: 2);
        for (var i = 1; i <= 4; i++)
            store.Add(new HookEvent { Id = $"h{i}" });

        Assert.Equal(["h3", "h4"], store.GetAll().Select(e => e.Id));
    }
}
