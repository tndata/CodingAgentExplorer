using CodingAgentExplorer.Services;
using Microsoft.AspNetCore.SignalR;

namespace CodingAgentExplorer.Hubs;

internal class DashboardHub : Hub
{
    private readonly RequestStore _store;
    private readonly HookEventStore _hookStore;
    private readonly McpRequestStore _mcpStore;
    private readonly McpProxyConfig _mcpConfig;

    public DashboardHub(RequestStore store, HookEventStore hookStore,
        McpRequestStore mcpStore, McpProxyConfig mcpConfig)
    {
        _store = store;
        _hookStore = hookStore;
        _mcpStore = mcpStore;
        _mcpConfig = mcpConfig;
    }

    public override async Task OnConnectedAsync()
    {
        await Clients.Caller.SendAsync("History", _store.GetAll());
        await Clients.Caller.SendAsync("HookHistory", _hookStore.GetAll());
        await Clients.Caller.SendAsync("McpHistory", _mcpStore.GetAll());
        await Clients.Caller.SendAsync("McpConfigChanged", new { destinationUrl = _mcpConfig.DestinationUrl });
        await base.OnConnectedAsync();
    }

    public async Task ClearAll()
    {
        _store.Clear();
        _hookStore.Clear();
        _mcpStore.Clear();
        await Clients.All.SendAsync("Cleared");
        await Clients.All.SendAsync("McpCleared");
    }

    public async Task ClearMcp()
    {
        _mcpStore.Clear();
        await Clients.All.SendAsync("McpCleared");
    }
}
