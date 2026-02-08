using CodingAgentExplorer.Services;
using Microsoft.AspNetCore.SignalR;

namespace CodingAgentExplorer.Hubs;

internal class DashboardHub : Hub
{
    private readonly RequestStore _store;

    public DashboardHub(RequestStore store)
    {
        _store = store;
    }

    public override async Task OnConnectedAsync()
    {
        // Send all existing requests to the newly connected client
        var requests = _store.GetAll();
        await Clients.Caller.SendAsync("History", requests);
        await base.OnConnectedAsync();
    }

    public async Task ClearAll()
    {
        _store.Clear();
        await Clients.All.SendAsync("Cleared");
    }
}
