# API Reference

This document provides reference documentation for the REST endpoints, SignalR hub protocol, data models, and YARP configuration used by CodingAgentExplorer.

For a high-level overview and user guide, see [README.md](../README.md).
For internal architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## REST API Endpoints

All REST endpoints are served on the dashboard ports (5000 HTTP, 5001 HTTPS). They are not available on the proxy ports (8888, 9999).

### POST /api/hook-event

Receives hook events from HookAgent. The endpoint accepts a JSON payload matching the `HookEvent` DTO and stores it in the `HookEventStore`.

**Request Body:** JSON object matching the `HookEvent` DTO (camelCase field names).

```json
{
  "id": "abc123def456",
  "timestamp": "2026-07-11T12:00:00Z",
  "hookEventName": "PreToolUse",
  "sessionId": "session-123",
  "cwd": "/Users/user/MyProject",
  "permissionMode": "default",
  "transcriptPath": "/Users/user/.claude/transcripts/...",
  "hookInput": { ... },
  "environmentVariables": {
    "CLAUDE_PROJECT_DIR": "/Users/user/MyProject",
    "CLAUDE_CODE_REMOTE": ""
  },
  "exitCode": 0,
  "stdout": "",
  "stderr": ""
}
```

**Response:** `200 OK` (no body)

**Notes:**
- The `id` field is auto-generated if not provided (12-character hex string)
- The `timestamp` field is set server-side if not provided (UTC DateTime)
- Invalid JSON payloads are handled gracefully and do not crash the server

### GET /api/mcp-destination

Returns the current MCP proxy destination URL.

**Response:** JSON object with a `url` field.

```json
{
  "url": "https://gitmcp.io/tndata/CloudDebugger"
}
```

If no destination is configured, the response is:

```json
{
  "url": null
}
```

### POST /api/mcp-destination

Sets the MCP proxy destination URL. This triggers a YARP configuration reload via `IChangeToken`, which updates the MCP route to forward traffic to the new destination.

**Request Body:** JSON object with a `url` field.

```json
{
  "url": "https://gitmcp.io/tndata/CloudDebugger"
}
```

**Response:** `200 OK` (no body)

**Notes:**
- The destination URL is split into host and path prefix by `McpProxyConfig.ParseDestination()`
- For a URL like `https://gitmcp.io/tndata/CloudDebugger`, the host is `https://gitmcp.io` and the path prefix is `/tndata/CloudDebugger`
- The proxy prepends the path prefix when forwarding requests, so `http://localhost:9999/tools/list` becomes `https://gitmcp.io/tndata/CloudDebugger/tools/list`
- Setting the URL to `null` or an empty string clears the destination and deactivates the MCP proxy route

## SignalR Hub Protocol

The `DashboardHub` SignalR hub provides real-time communication between the server and browser clients. It is registered at the default SignalR endpoint (`/dashboardHub`).

### Connection

When a client connects to the hub, the server immediately sends:
- `History` - Full list of stored Claude API requests
- `HookHistory` - Full list of stored hook events
- `McpHistory` - Full list of stored MCP requests
- `McpConfigChanged` - Current MCP destination configuration

This ensures that new clients see all existing data immediately, even if they connect after requests have already been made.

### Server-to-Client Methods

| Method | Data Type | Description |
|--------|-----------|-------------|
| `History` | `ProxiedRequest[]` | Full list of Claude API requests (sent on connect) |
| `HookHistory` | `HookEvent[]` | Full list of hook events (sent on connect) |
| `McpHistory` | `ProxiedRequest[]` | Full list of MCP requests (sent on connect) |
| `NewRequest` | `ProxiedRequest` | Single new Claude API request (pushed in real-time) |
| `NewMcpRequest` | `ProxiedRequest` | Single new MCP request (pushed in real-time) |
| `McpConfigChanged` | `{ url: string? }` | Updated MCP destination config (pushed on change) |
| `Cleared` | void | All stores cleared (broadcast after ClearAll) |
| `McpCleared` | void | MCP store cleared (broadcast after ClearAll or ClearMcp) |

### Client-to-Server Methods

| Method | Parameters | Description |
|--------|------------|-------------|
| `ClearAll` | none | Clears all three stores (RequestStore, HookEventStore, McpRequestStore) and broadcasts `Cleared` + `McpCleared` to all clients |
| `ClearMcp` | none | Clears only the MCP store (McpRequestStore) and broadcasts `McpCleared` to all clients |

### Client Usage Example (JavaScript)

```javascript
// Connect to the SignalR hub
const connection = new signalR.HubConnectionBuilder()
    .withUrl('/dashboardHub')
    .build();

// Handle incoming events
connection.on('NewRequest', (request) => {
    // Update the inspector table or conversation view
    addProxiedRequest(request);
});

connection.on('NewMcpRequest', (request) => {
    // Update the MCP observer table
    addMcpRequest(request);
});

connection.on('History', (requests) => {
    // Populate the table with all historical requests
    renderRequests(requests);
});

connection.on('HookHistory', (events) => {
    // Populate the conversation view with hook events
    renderHookEvents(events);
});

connection.on('McpHistory', (requests) => {
    // Populate the MCP observer with historical requests
    renderMcpRequests(requests);
});

connection.on('Cleared', () => {
    // Clear all tables and panels
    clearAllViews();
});

connection.on('McpCleared', () => {
    // Clear only the MCP table and panel
    clearMcpView();
});

connection.on('McpConfigChanged', (config) => {
    // Update the MCP destination display
    updateMcpDestination(config.url);
});

// Call client methods
await connection.invoke('ClearAll');
await connection.invoke('ClearMcp');

// Start the connection
await connection.start();
```

## Data Models

### ProxiedRequest

The primary data model for captured HTTP request/response pairs. Used by both the Claude API proxy (port 8888) and MCP proxy (port 9999).

| Field | Type | Description |
|-------|------|-------------|
| `Id` | string (12-char hex) | Auto-generated short ID for lookup |
| `Timestamp` | DateTime UTC | When the request was made |
| `Method` | string | HTTP method (GET, POST, etc.) |
| `Path` | string | Full path with query string |
| `RequestHeaders` | Dictionary<string,string> | Request headers (API keys redacted) |
| `ResponseHeaders` | Dictionary<string,string> | Response headers (API keys redacted) |
| `RequestBody` | string? | Raw request body text (decompressed if gzip/br/deflate) |
| `ResponseBody` | string? | Raw response body text (decompressed if gzip/br/deflate) |
| `Model` | string? | Claude model name (parsed from request body, e.g., "claude-sonnet-4-20250514") |
| `IsStreaming` | bool | Whether the response uses SSE streaming |
| `MaxTokens` | int? | Max tokens setting from request |
| `StatusCode` | int? | HTTP status code of the response |
| `MessageId` | string? | Parsed from SSE events or response body |
| `StopReason` | string? | Parsed from SSE events or response body (e.g., "end_turn", "max_tokens") |
| `InputTokens` | int? | Total input tokens from Claude API |
| `OutputTokens` | int? | Total output tokens from Claude API |
| `CacheCreationInputTokens` | int? | Prompt cache write tokens (cache creation) |
| `CacheReadInputTokens` | int? | Prompt cache read tokens |
| `SseEvents` | List<SseEvent> | Captured SSE events for streaming responses |
| `DurationMs` | double? | Total request duration in milliseconds |
| `TimeToFirstTokenMs` | double? | Time from request start to first SSE token event |
| `Error` | string? | Proxy-level error messages (null if no error) |

### HookEvent

Represents a Claude Code hook event captured by HookAgent. See [ARCHITECTURE.md](./ARCHITECTURE.md#hookagent) for details on how HookAgent works.

| Field | Type | Description |
|-------|------|-------------|
| `Id` | string (12-char hex) | Auto-generated short ID for lookup |
| `Timestamp` | DateTime UTC | Server-side timestamp for timeline accuracy |
| `HookEventName` | string | Name of the hook (e.g., "pretooluse", "sessionstart") |
| `SessionId` | string? | Claude Code session ID |
| `Cwd` | string? | Current working directory when hook fired |
| `PermissionMode` | string? | Permission mode at time of hook |
| `TranscriptPath` | string? | Path to Claude Code transcript file |
| `HookInput` | JsonElement? | Full raw STDIN payload (stored as JsonElement to avoid double-encoding through SignalR) |
| `EnvironmentVariables` | Dictionary<string,string> | Env vars collected by HookAgent (CLAUDE_PROJECT_DIR, CLAUDE_CODE_REMOTE, etc.) |
| `ExitCode` | int | Response exit code (always 0 currently; future "response editor" UI will PATCH this) |
| `Stdout` | string | Response text relayed back to Claude Code |
| `Stderr` | string | Error text relayed back to Claude Code |

### SseEvent

Simple DTO for a single SSE event line captured during streaming responses.

| Field | Type | Description |
|-------|------|-------------|
| `EventType` | string? | SSE event type (e.g., "message_start", "content_block_delta", "message_delta") |
| `Data` | string? | The JSON data payload of the SSE event |

### McpDestinationRequest

Simple record for setting the MCP proxy destination URL. Used as the request body for `POST /api/mcp-destination`.

| Field | Type | Description |
|-------|------|-------------|
| `Url` | string? | The MCP server URL to forward traffic to (e.g., "https://gitmcp.io/tndata/CloudDebugger") |

## YARP Configuration

### Static Configuration (appsettings.json)

The base YARP configuration is defined in `CodingAgentExplorer/appsettings.json`:

```json
{
  "ReverseProxy": {
    "Routes": {
      "anthropic-route": {
        "ClusterId": "anthropic-cluster",
        "Match": {
          "Path": "{**catch-all}",
          "Hosts": ["localhost:8888", "127.0.0.1:8888"]
        }
      }
    },
    "Clusters": {
      "anthropic-cluster": {
        "Destinations": {
          "anthropic-api": {
            "Address": "http://localhost:1234"
          }
        },
        "HttpRequest": {
          "ActivityTimeout": "00:10:00",
          "AllowResponseBuffering": false
        }
      }
    }
  }
}
```

Key settings:
- **ActivityTimeout**: 10 minutes, needed for long streaming responses
- **AllowResponseBuffering**: false, important for SSE pass-through behavior

### Dynamic Configuration (DynamicProxyConfigProvider)

The `DynamicProxyConfigProvider` implements YARP's `IProxyConfigProvider` and builds routes dynamically at runtime. It adds the MCP route when a destination URL is configured via `McpProxyConfig.SetDestination()`.

**Anthropic route (always active):**
- Matches `localhost:8888` or `127.0.0.1:8888`, catches all paths
- Forwards to an upstream destination resolved from `CODING_AGENT_EXPLORER_UPSTREAM_URL` env var or `appsettings.json`. Falls back to `https://api.anthropic.com`

**MCP route (only active when destination is configured):**
- Matches `localhost:9999` or `127.0.0.1:9999`, catches all paths
- Prepends the path prefix from the destination URL (e.g., `/tndata/CloudDebugger`)
- Forwards to just the host portion of the destination URL

### Environment Variable Override

The upstream LLM API address can be overridden via the `CODING_AGENT_EXPLORER_UPSTREAM_URL` environment variable. This takes precedence over the address configured in `appsettings.json`.

```bash
export CODING_AGENT_EXPLORER_UPSTREAM_URL=https://api.anthropic.com
```

### Fallback on Port 9999

When no MCP destination is configured, requests to port 9999 receive a JSON-RPC error response. This prevents Claude Code from entering an OAuth discovery loop when the MCP proxy is not properly configured.
