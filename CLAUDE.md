# CodingAgentExplorer

ASP.NET Core reverse proxy using YARP that sits between AI coding agents (such as Claude Code) and their LLM API endpoints. Captures all API traffic including streaming SSE responses and exposes a real-time web dashboard via SignalR.

## Architecture

- **Port 8888** (`localhost`): YARP reverse proxy forwarding to LLM API (HTTP)
- **Port 5000** (`localhost`): Dashboard (HTTP)
- **Port 5001** (`localhost`): Dashboard (HTTPS, auto-launches browser)
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

Then use Claude Code normally. All requests flow through the proxy and appear on the dashboard at `https://localhost:5001`.

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
- Kestrel: port 8888 (HTTP proxy), port 5000 (HTTP dashboard), port 5001 (HTTPS dashboard)
- API keys are redacted from stored request headers
- Streaming SSE events are parsed to extract token usage, message ID, stop reason, and time-to-first-token
