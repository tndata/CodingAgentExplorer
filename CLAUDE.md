# CodingAgentExplorer

ASP.NET Core reverse proxy using YARP that sits between AI coding agents (such as Claude Code) and their LLM API endpoints. Captures all API traffic including streaming SSE responses and exposes a real-time web dashboard via SignalR.

## Architecture

- **Port 8888** (`localhost`): YARP reverse proxy forwarding to LLM API
- **Port 5001** (`localhost`): Static HTML dashboard with SignalR real-time updates
- Single project, single NuGet dependency (`Yarp.ReverseProxy`)

## Build & Run

```bash
dotnet build
dotnet run
```

## Usage with Claude Code

Set the API base URL to point at the proxy:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8888
```

Then use Claude Code normally. All requests flow through the proxy and appear on the dashboard at `http://localhost:5001`.

## Project Structure

- `Program.cs` - App setup: YARP, SignalR, dual-port Kestrel
- `Models/` - DTOs: ProxiedRequest, ClaudeRequestBody, SseEvent
- `Services/RequestStore.cs` - In-memory circular buffer (ConcurrentQueue, max 1000)
- `Proxy/CaptureTransformProvider.cs` - YARP ITransformProvider for request/response capture
- `Hubs/DashboardHub.cs` - SignalR hub for real-time dashboard updates
- `wwwroot/` - Dashboard SPA (vanilla HTML/JS/CSS + SignalR client)

## Key Design Decisions

- YARP `ITransformProvider` for intercepting requests/responses (not middleware)
- `SuppressResponseBody = true` + manual line-by-line forwarding for SSE streaming
- Dual-port Kestrel: port 8888 for proxy, port 5001 for dashboard
- API keys are redacted from stored request headers
- Streaming SSE events are parsed to extract token usage, message ID, stop reason, and time-to-first-token
