using System.Text.Json;

namespace CodingAgentExplorer.Models;

public class HookEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..12];
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    // Envelope fields (always present in Claude Code hook JSON)
    public string HookEventName { get; set; } = "";
    public string? SessionId { get; set; }
    public string? Cwd { get; set; }
    public string? PermissionMode { get; set; }
    public string? TranscriptPath { get; set; }

    // Full raw STDIN payload — stored as JsonElement so SignalR serializes
    // it inline (not double-encoded). Supports future UI that reads any field.
    public JsonElement? HookInput { get; set; }

    // Environment variables collected by HookAgent
    public Dictionary<string, string> EnvironmentVariables { get; set; } = [];

    // Configured response — always 0/""/""  now; a future "response editor" UI
    // will PATCH these fields before HookAgent returns them to Claude Code.
    public int ExitCode { get; set; } = 0;
    public string Stdout { get; set; } = "";
    public string Stderr { get; set; } = "";
}
