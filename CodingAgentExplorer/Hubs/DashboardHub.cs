using CodingAgentExplorer.Services;
using Microsoft.AspNetCore.SignalR;

namespace CodingAgentExplorer.Hubs;

internal class DashboardHub : Hub
{
    private readonly RequestStore _store;
    private readonly HookEventStore _hookStore;

    public DashboardHub(RequestStore store, HookEventStore hookStore)
    {
        _store = store;
        _hookStore = hookStore;
    }

    public override async Task OnConnectedAsync()
    {
        // Send all existing requests and hook events to the newly connected client
        await Clients.Caller.SendAsync("History", _store.GetAll());
        await Clients.Caller.SendAsync("HookHistory", _hookStore.GetAll());
        await base.OnConnectedAsync();
    }

    public async Task ClearAll()
    {
        _store.Clear();
        _hookStore.Clear();
        await Clients.All.SendAsync("Cleared");
    }
}
