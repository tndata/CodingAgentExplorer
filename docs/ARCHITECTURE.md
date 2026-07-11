# Architecture

This document provides a detailed technical deep dive into the internal architecture of CodingAgentExplorer. It is intended for developers who want to understand, extend, or contribute to the project.

For a high-level overview and user guide, see [README.md](../README.md).
For API reference documentation, see [API.md](./API.md).

## System Overview

CodingAgentExplorer is an ASP.NET Core 10.0 web application that acts as a reverse proxy and real-time dashboard for inspecting Claude Code API traffic and MCP server interactions. The system consists of two projects:

- **CodingAgentExplorer** - Main web application (YARP proxy + SignalR dashboard)
- **HookAgent** - Minimal CLI tool for Claude Code hook integration

```
Claude Code
    |
    +--► localhost:8888 (API Proxy) ──► Upstream LLM API
    |         CaptureTransformProvider (ITransformProvider)
    |
    +--► localhost:9999 (MCP Proxy)  ──► MCP Server
    |         DynamicProxyConfigProvider (IProxyConfigProvider)
    |
    +--► localhost:5001 (Dashboard)  ◄── SignalR real-time updates
              DashboardHub

HookAgent (CLI tool) ──► POST /api/hook-event
```

### Port Layout

| Port | Purpose | Protocol |
|------|---------|----------|
| 8888 | Claude API proxy (HTTP) | HTTP |
| 9999 | MCP proxy (HTTP) | HTTP |
| 5000 | Dashboard (HTTP) | HTTP |
| 5001 | Dashboard (HTTPS) | HTTPS |

Static files are only served on dashboard ports (5000/5001), not on proxy ports. This is enforced via `app.UseWhen()` in `Program.cs`.

## Proxy Layer

The proxy layer is the heart of the system. It uses YARP (Yet Another Reverse Proxy) with custom implementations to capture all traffic flowing through the proxy.

### CaptureTransformProvider

**File:** `CodingAgentExplorer/Proxy/CaptureTransformProvider.cs`

Implements YARP's `ITransformProvider` interface. Adds request and response transforms that capture all traffic while preserving pass-through behavior.

**Request transform (`CaptureRequestAsync`):**

1. Strips `Accept-Encoding` header to prevent compressed responses (avoids a Bun/zlib decompression bug in Claude Code)
2. Enables request body buffering and reads the full body
3. Copies headers with **redaction**: `x-api-key` and `Authorization` are replaced with `[REDACTED]`
4. Parses the JSON body as `ClaudeRequestBody` to extract model, streaming flag, and max tokens
5. Stores the `ProxiedRequest` object and a `Stopwatch` in `HttpContext.Items`

**Response transform (`CaptureResponseAsync`):**

1. Captures status code and response headers (redacted)
2. Determines if the response is SSE (`text/event-stream`)
3. For **SSE streaming**: suppresses YARP's response body, reads the upstream stream line-by-line, forwards each SSE line to the client immediately (pass-through), and parses SSE events for metadata extraction
4. For **non-streaming**: loads the full response body into buffer, decompresses if needed (gzip/br/deflate), and parses JSON for metadata
5. Extracts token usage from `message_start`, `content_block_delta` (for TTFT), and `message_delta` SSE events
6. Stores the completed `ProxiedRequest` in either `RequestStore` or `McpRequestStore` and pushes it via SignalR (`NewRequest` or `NewMcpRequest`)

**Key design decision:** SSE streaming is handled as a true pass-through. The proxy forwards each line to Claude Code immediately while simultaneously capturing it for the dashboard. This preserves real-time streaming behavior.

### DynamicProxyConfigProvider

**File:** `CodingAgentExplorer/Proxy/DynamicProxyConfigProvider.cs`

Implements YARP's `IProxyConfigProvider` to build proxy routes dynamically at runtime.

**Anthropic route (always active on port 8888):**
- Matches `localhost:8888` or `127.0.0.1:8888`, catches all paths
- Forwards to an upstream destination resolved from `CODING_AGENT_EXPLORER_UPSTREAM_URL` env var or `appsettings.json`. Falls back to `https://api.anthropic.com`
- 10-minute activity timeout (needed for long streaming responses)

**MCP route (only active when destination is configured):**
- Matches `localhost:9999` or `127.0.0.1:9999`, catches all paths
- Prepends the path prefix from the destination URL (e.g., `/tndata/CloudDebugger`)
- Forwards to just the host portion of the destination URL

The provider uses `InMemoryProxyConfig` (an internal class) that wraps routes, clusters, and a change token. When `McpProxyConfig.SetDestination()` cancels the old `CancellationTokenSource`, YARP detects the change and calls `GetConfig()` again.

## Services

All services are registered as singletons in the DI container.

### RequestStore

**File:** `CodingAgentExplorer/Services/RequestStore.cs`

Thread-safe in-memory store for Claude API proxied requests. Uses `ConcurrentQueue<ProxiedRequest>` with a configurable max size (default 1000). When the queue exceeds maxSize, oldest items are dequeued.

| Method | Description |
|--------|-------------|
| `Add(ProxiedRequest)` | Adds a request, evicts oldest if over capacity |
| `GetAll()` | Returns all stored requests (snapshot) |
| `GetById(string)` | Finds a request by its short ID |
| `Clear()` | Empties the store |

### HookEventStore

**File:** `CodingAgentExplorer/Services/HookEventStore.cs`

Same pattern as RequestStore but for hook events. Max size 1000 (configurable). Provides `Add()`, `GetAll()`, `GetById()`, and `Clear()`.

### McpRequestStore

**File:** `CodingAgentExplorer/Services/McpRequestStore.cs`

Same pattern but for MCP traffic. Hardcoded max size of 500 (smaller than Claude API requests). Provides `Add()`, `GetAll()`, and `Clear()` (no `GetById` since MCP detail view doesn't need it).

### McpProxyConfig

**File:** `CodingAgentExplorer/Services/McpProxyConfig.cs`

Holds the current MCP destination URL and provides change notification for YARP.

| Method/Property | Description |
|-----------------|-------------|
| `DestinationUrl` | Current configured URL (null if not set) |
| `SetDestination(url)` | Sets the URL, cancels old `CancellationTokenSource` to signal YARP to rebuild config |
| `GetChangeToken()` | Returns a `CancellationChangeToken` for YARP's dynamic config system |
| `ParseDestination()` | Splits a URL like `https://gitmcp.io/tndata/CloudDebugger` into host (`https://gitmcp.io`) and pathPrefix (`/tndata/CloudDebugger`) |

The `ParseDestination()` method is critical: it enables the proxy to prepend the MCP server's path prefix when forwarding, so that `http://localhost:9999/tools/list` becomes `https://gitmcp.io/tndata/CloudDebugger/tools/list`.

## Models

### ProxiedRequest

**File:** `CodingAgentExplorer/Models/ProxiedRequest.cs`

Represents a captured HTTP request/response pair through the proxy. This is the primary data model for the dashboard.

| Field | Type | Description |
|-------|------|-------------|
| `Id` | string (12-char hex) | Auto-generated short ID |
| `Timestamp` | DateTime UTC | When the request was made |
| `Method`, `Path` | string | HTTP method and full path with query string |
| `RequestHeaders`, `ResponseHeaders` | Dictionary<string,string> | Headers (API keys redacted) |
| `RequestBody`, `ResponseBody` | string? | Raw body text (decompressed if gzip/br/deflate) |
| `Model` | string? | Claude model name (parsed from request body) |
| `IsStreaming` | bool | Whether the response uses SSE streaming |
| `MaxTokens` | int? | Max tokens setting from request |
| `StatusCode` | int? | HTTP status code of the response |
| `MessageId`, `StopReason` | string? | Parsed from SSE events or response body |
| `InputTokens`, `OutputTokens` | int? | Token usage from Claude API |
| `CacheCreationInputTokens`, `CacheReadInputTokens` | int? | Prompt cache token counts |
| `SseEvents` | List<SseEvent> | Captured SSE events for streaming responses |
| `DurationMs`, `TimeToFirstTokenMs` | double? | Timing metrics |
| `Error` | string? | Proxy-level error messages |

### HookEvent

**File:** `CodingAgentExplorer/Models/HookEvent.cs`

Represents a Claude Code hook event captured by HookAgent.

| Field | Type | Description |
|-------|------|-------------|
| `Id` | string (12-char hex) | Auto-generated short ID |
| `Timestamp` | DateTime UTC | Server-side timestamp for timeline accuracy |
| `HookEventName` | string | Name of the hook (e.g., "pretooluse", "sessionstart") |
| `SessionId` | string? | Claude Code session ID |
| `Cwd` | string? | Current working directory when hook fired |
| `PermissionMode` | string? | Permission mode at time of hook |
| `TranscriptPath` | string? | Path to Claude Code transcript file |
| `HookInput` | JsonElement? | Full raw STDIN payload (stored as JsonElement to avoid double-encoding through SignalR) |
| `EnvironmentVariables` | Dictionary<string,string> | Env vars collected by HookAgent (CLAUDE_PROJECT_DIR, CLAUDE_CODE_REMOTE, etc.) |
| `ExitCode` | int | Response exit code (always 0 currently; future "response editor" UI will PATCH this) |
| `Stdout` / `Stderr` | string | Response text relayed back to Claude Code |

### ClaudeRequestBody / ClaudeMessage

**File:** `CodingAgentExplorer/Models/ClaudeRequestBody.cs`

DTOs for parsing Claude API request bodies. `ClaudeMessage` is nested inside `ClaudeRequestBody`.

| Field | Type | Description |
|-------|------|-------------|
| `Model` | string? | Model name (e.g., "claude-sonnet-4-20250514") |
| `MaxTokens` | int? | Max output tokens |
| `Stream` | bool? | Whether streaming is requested |
| `System` | object? | System prompt (string or content block array) |
| `Messages` | List<ClaudeMessage>? | Message history |

### SseEvent

**File:** `CodingAgentExplorer/Models/SseEvent.cs`

Simple DTO for a single SSE event line.

| Field | Type | Description |
|-------|------|-------------|
| `EventType` | string? | SSE event type (e.g., "message_start", "content_block_delta") |
| `Data` | string? | The JSON data payload of the SSE event |

### McpDestinationRequest

**File:** `CodingAgentExplorer/Models/McpDestinationRequest.cs`

Simple record for setting the MCP proxy destination URL. Contains a single `Url` field (string?).

## SignalR Hub

**File:** `CodingAgentExplorer/Hubs/DashboardHub.cs`

The SignalR hub serves as the real-time communication backbone between the server and all browser clients. It is injected with all three stores plus the MCP config, making it the single point of truth for pushing state to connected browsers.

**On connection (`OnConnectedAsync`):**
- Sends full history of Claude API requests (`History`)
- Sends full history of hook events (`HookHistory`)
- Sends full history of MCP requests (`McpHistory`)
- Sends current MCP config (`McpConfigChanged`)

**Client methods:**
- `ClearAll()` - Clears all three stores and broadcasts `Cleared` + `McpCleared` to all clients
- `ClearMcp()` - Clears only the MCP store and broadcasts `McpCleared`

**Server-to-client methods:**

| Method | Description |
|--------|-------------|
| `History` | Full list of Claude API requests (sent on connect) |
| `HookHistory` | Full list of hook events (sent on connect) |
| `McpHistory` | Full list of MCP requests (sent on connect) |
| `NewRequest` | Single new Claude API request (pushed in real-time) |
| `NewMcpRequest` | Single new MCP request (pushed in real-time) |
| `McpConfigChanged` | Updated MCP destination config (pushed on change) |
| `Cleared` | All stores cleared (broadcast after ClearAll) |
| `McpCleared` | MCP store cleared (broadcast after ClearAll or ClearMcp) |

## HookAgent

**File:** `HookAgent/Program.cs`

HookAgent is a minimal .NET 10.0 console application (no NuGet dependencies, uses in-box `System.Net.Http.Json`) that acts as a Claude Code hook handler. It is invoked by Claude Code whenever a hook fires.

**What it does (6 steps):**

1. **Reads all STDIN** - Claude Code writes a JSON payload to stdin and closes it
2. **Parses the envelope** - Extracts `hook_event_name`, `session_id`, `cwd`, `permission_mode`, `transcript_path`. Invalid JSON is treated as empty payload (never crashes)
3. **Collects environment variables** - Reads `CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_REMOTE`, `CLAULE_ENV_FILE`, `CLAUDE_PLUGIN_ROOT` from the environment
4. **Builds a payload** matching the `HookEvent` DTO (camelCase JSON)
5. **POSTs to CodingAgentExplorer** at `http://localhost:5000/api/hook-event` with a 5-second timeout. If the server is not running, it silently succeeds (never blocks Claude Code)
6. **Relays stdout/stderr** back to Claude Code's terminal and exits with the response exit code

The key design principle: **HookAgent never blocks Claude Code**. If CodingAgentExplorer is down, the hook passes through silently.

## Frontend Architecture

The dashboard is a vanilla HTML/JS/CSS single-page application with no build step. It connects to the server via SignalR for real-time updates.

### File Structure

```
wwwroot/
  index.html                    - Landing page (3 cards to navigate)
  css/
    theme.css                   - CSS variables for dark/light themes
    styles.css                  - Shared styles (inspector, dashboard)
    conversation.css            - Conversation view specific styles
  js/
    theme.js                    - Theme toggle (persisted in localStorage)
    dashboard.js                - Inspector page logic (366 lines)
    conversation.js             - Conversation view logic (1146 lines)
  inspector/
    index.html                  - HTTP Inspector page
  conversation/
    index.html                  - Conversation View page
  mcp/
    index.html                  - MCP Observer page (self-contained, inline JS)
```

### Inspector Page (`inspector/index.html` + `dashboard.js`)

- Toolbar with navigation links, Clear button, theme toggle, connection status indicator, request count
- Table showing: Time, Method, Path (truncated), Model, Stream/Sync badge, Status code, Input/Output tokens, Cache Create/Read tokens, Duration, TTFT
- Clicking a row opens a detail panel (right side) with tabs: Overview, Request, Response, SSE Events
- "Copy JSON" button copies request/response bodies as formatted JSON to clipboard
- Section-level copy buttons for headers and body text in detail tabs

### Conversation View (`conversation/index.html` + `conversation.js`)

The most complex page (1146 lines of JS). Shows a timeline feed mixing API exchanges and hook events.

**Exchange cards** show:
- Meta bar (time, model, status, context tokens, new input tokens, cache write/read, duration, TTFT, stop reason)
- System prompt (collapsible)
- Tools section (collapsed by default, categorized into built-in vs MCP groups)
- User/assistant message bubbles (history collapsed, current conversation expanded)
- Assistant response (parsed from streaming or non-streaming)
- Raw details section (collapsible, with tabs for request/response/events/tokens/statistics)

**Hook event cards** (orange left border) show:
- Hook name badge, timestamp, context label (tool/source/reason/agent type)
- Key-value fields, stdout output box
- Collapsible environment variables and raw hook input

### MCP Observer (`mcp/index.html`)

Self-contained page (all JS inline in a `<script type="module">` block).
- Config panel: input field for MCP destination URL, Set/Clear buttons
- Table showing: Time, Method (color-coded GET=green/POST=blue), Path, JSON-RPC method, Status code, Duration
- Detail panel (bottom) shows request body and response in "Pretty" or "Raw" view
- Pretty view renders `tools/list` as tool cards with parameters, `initialize` as key-value rows, and `tools/call` as content blocks

### Theme System (`css/theme.css` + `js/theme.js`)

Defines CSS custom properties for dark mode (default, GitHub-dark style) and light mode (`[data-theme="light"]`). Colors include: background layers (bg, bg-secondary, bg-tertiary), borders, text/text-secondary, accent (blue), green, red, orange, purple, and various subtle/muted/border variants for each semantic color.

The theme toggle is an IIFE that checks `localStorage` for saved theme, falls back to `prefers-color-scheme`. Sets `data-theme` attribute on `<html>`. Persists choice to localStorage.

## Key Design Decisions

### Why YARP over Middleware?

YARP's `ITransformProvider` interface provides a clean way to intercept and transform requests/responses at the proxy level without writing custom middleware. It integrates directly with Kestrel's request pipeline and handles connection management, timeouts, and retries automatically.

### SSE Pass-Through Approach

Streaming responses are handled as a true pass-through: the proxy forwards each SSE line to Claude Code immediately while simultaneously capturing it for the dashboard. This preserves real-time streaming behavior and avoids buffering delays that would degrade the user experience.

### In-Memory Stores with Circular Buffers

All request data is stored in memory using `ConcurrentQueue<T>` with configurable max sizes (1000 for Claude API requests and hook events, 500 for MCP traffic). When the queue exceeds capacity, oldest items are silently dequeued. This avoids disk I/O overhead and is appropriate for a debugging/inspection tool where historical data beyond the current session is not critical.

### HookAgent Never Blocks Claude Code

HookAgent uses a 5-second timeout for its POST to the dashboard and silently succeeds (exits with code 0) if the server is unreachable. This ensures that a downed CodingAgentExplorer never blocks Claude Code's execution, which is critical for production reliability.

### API Key Redaction

API keys (`x-api-key` and `Authorization` headers) are automatically redacted from stored request data. This prevents sensitive credentials from being persisted in the dashboard, even though the proxy itself forwards them unchanged to the upstream API.

### MCP Destination Management via IChangeToken

The MCP proxy destination URL is held in a singleton (`McpProxyConfig`) and triggers YARP config reload via `IChangeToken` when changed. This allows the MCP proxy to be reconfigured at runtime without restarting the application, which is essential for testing against different MCP servers.
