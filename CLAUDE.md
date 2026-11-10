# CodingAgentExplorer

ASP.NET Core reverse proxy using YARP that sits between AI coding agents (such as Claude Code) and their LLM API endpoints. Captures all API traffic including streaming SSE responses and exposes a real-time web dashboard via SignalR.

## Architecture

- **Port 8888** (`localhost`): YARP reverse proxy forwarding to LLM API (HTTP)
- **Port 9999** (`localhost`): YARP reverse proxy forwarding to MCP server (HTTP), destination configured at runtime
- **Port 5000** (`localhost`): Dashboard (HTTP)
- **Port 5001** (`localhost`): Dashboard (HTTPS; the browser opens only when started from Visual Studio, through `launchSettings.json`)
- Single NuGet dependency in the app (`Yarp.ReverseProxy`); unit tests in `CodingAgentExplorer.Tests` (xUnit)

## Build & Run

```bash
dotnet build
dotnet run --project CodingAgentExplorer
dotnet test
```

## Smoke test

With the app running, `node scripts/smoke.mjs` sends a fixed set of requests (no API key, no model tokens) and checks what was captured. `node scripts/capture-summary.mjs` prints a compact summary of the captured traffic (`--json`, `--clear`). Add `--claude` to the smoke test for one tiny `claude -p` call through the proxy. Needs Node 22 or later.

## Publish

**Windows:**
```bat
publish.bat
```

**macOS / Linux:**
```bash
bash publish.sh
```

Each script builds both projects for the current platform. Outputs to `Published/` (gitignored):
- `Published\CodingAgentExplorer\` - framework-dependent, requires .NET 10 runtime
- `Published\HookAgent\HookAgent.exe` - single-file, current platform (Windows: win-x64; macOS/Linux: detected at build time)

## Usage with Claude Code

Set the API base URL to point at the proxy:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8888
```

Then use Claude Code normally. All requests flow through the proxy and appear on the dashboard at `https://localhost:5001`.

## MCP Observer

The MCP Observer proxies traffic between Claude Code and any MCP server on port 9999. The destination URL is configured at runtime via the dashboard at `https://localhost:5001/mcp/index.html`.

Register the proxy as an MCP server in Claude Code:

```bash
claude mcp add --transport http mcp_proxy http://localhost:9999
```

The destination URL is stored in `McpProxyConfig` (singleton) and triggers a YARP config reload via `IChangeToken` when updated. SSE keep-alive GET requests to `/` with no body are silently dropped and not stored.

## Project Structure

- `Program.cs` - App setup: YARP, SignalR, dual-port Kestrel, API endpoints
- `Models/` - DTOs: ProxiedRequest, ClaudeRequestBody, SseEvent, HookEvent, McpDestinationRequest, ApiUpstreamRequest
- `Services/RequestStore.cs` - In-memory circular buffer (ConcurrentQueue, max 1000)
- `Services/HookEventStore.cs` - In-memory store for hook events
- `Services/McpRequestStore.cs` - In-memory store for MCP requests (max 500)
- `Services/McpProxyConfig.cs` - Holds the runtime MCP destination URL, signals YARP on change
- `Services/ApiUpstreamConfig.cs` - Where port 8888 forwards to: startup value (env `CODING_AGENT_EXPLORER_UPSTREAM_URL`, then `ApiUpstream:Url` in appsettings.json, then api.anthropic.com) plus a runtime override from the Settings page; validates URLs, keeps a path prefix, signals YARP on change
- `Services/DashboardRequestGuard.cs` - Endpoint filter for the settings endpoints: loopback Host header, and Origin (if sent) must be the dashboard on 5000/5001
- `Proxy/CaptureTransformProvider.cs` - YARP ITransformProvider for request/response capture
- `Proxy/DynamicProxyConfigProvider.cs` - Dynamic YARP config for Claude (8888) and MCP (9999) routes
- `Hubs/DashboardHub.cs` - SignalR hub for real-time dashboard updates
- `wwwroot/` - Dashboard SPA (vanilla HTML/JS/CSS + SignalR client)
- `wwwroot/mcp/` - MCP Observer page
- `wwwroot/settings/` - Settings page (API upstream, `GET`/`POST /api/settings/api-upstream`)
- `HookAgent/` - Single-file CLI tool used as a Claude Code hook command
- `publish.bat` - Publishes both projects to `Published/` (Windows, win-x64 HookAgent)
- `publish.sh` - Publishes both projects to `Published/` (detects current platform for HookAgent)

## Published Descriptions

Published blog posts and a conference talk describe this tool's ports, views, hook setup and MCP Observer (links in `README.md`). When you change any of that, say so, so the posts can be updated. Never rename ports, endpoints or hook setup without asking.

## Writing Style

- Never use em dashes (—) in README.md or any documentation. Use a comma, hyphen, colon, or reword the sentence instead.
- Never use a dash (hyphen) between two sentences or clauses as a separator. Use a period, comma, colon, or reword instead.

## Key Design Decisions

- YARP `ITransformProvider` for intercepting requests/responses (not middleware)
- `SuppressResponseBody = true` + manual line-by-line forwarding for SSE streaming
- Kestrel: port 8888 (HTTP proxy), port 9999 (MCP proxy), port 5000 (HTTP dashboard), port 5001 (HTTPS dashboard)
- API keys are redacted from stored request headers
- Streaming SSE events are parsed to extract token usage, message ID, stop reason, and time-to-first-token
- MCP destination URL is held in `McpProxyConfig` singleton; changing it cancels a `CancellationTokenSource` to signal YARP to reload routes via `DynamicProxyConfigProvider`
- MCP SSE keep-alive polling (GET / with no body) is filtered out in `StoreAndNotify` before reaching the store or SignalR
