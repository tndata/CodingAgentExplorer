# CodingAgentExplorer

A real-time .NET proxy and dashboard for inspecting Claude Code API calls. Intercept, visualize, and analyze every request and response between Claude Code and the Anthropic API.

Built as a learning tool for developers who want to understand what happens under the hood when AI coding agents work.

> **Note:** Currently supports [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with the Anthropic API. Support for additional coding agents may be added in the future.

## What It Does

CodingAgentExplorer sits between your coding agent and the LLM API, capturing all traffic and displaying it in a real-time web dashboard. You can see:

- Every API request and response in real time
- Streaming SSE events as they arrive
- Token usage (input, output, cache creation, cache reads)
- Model selection, timing, and time-to-first-token
- Full request/response headers and bodies
- A conversation view that renders the agent's messages in a chat-style format

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download) or later

## Getting Started

### 1. Build and run the proxy

```bash
dotnet build
dotnet run
```

This starts two servers:
- **Port 8888** - The reverse proxy (point your coding agent here)
- **Port 5001** - The web dashboard (open this in your browser)

### 2. Configure your coding agent

For **Claude Code**, set the API base URL to point at the proxy:

```bash
# Linux / macOS
export ANTHROPIC_BASE_URL=http://localhost:8888

# Windows (cmd)
set ANTHROPIC_BASE_URL=http://localhost:8888

# Windows (PowerShell)
$env:ANTHROPIC_BASE_URL = "http://localhost:8888"
```

Then use Claude Code as you normally would.

### 3. Open the dashboard

Navigate to [http://localhost:5001](http://localhost:5001) in your browser. You'll see two views:

- **HTTP Inspector** - Table view of all proxied requests with headers, bodies, SSE events, and timing details
- **Conversation View** - Chat-style display showing messages, tool use, and responses

## Architecture

```
  Coding Agent  ──►  CodingAgentExplorer (port 8888)  ──►  LLM API
                            │
                            ▼
                     Web Dashboard (port 5001)
                     Real-time via SignalR
```

- ASP.NET Core with [YARP](https://github.com/microsoft/reverse-proxy) reverse proxy
- SignalR for real-time dashboard updates
- Vanilla HTML/JS/CSS frontend (no build step required)
- Single NuGet dependency (`Yarp.ReverseProxy`)

## Project Structure

```
├── Program.cs                          # App setup: YARP, SignalR, dual-port Kestrel
├── Models/                             # DTOs: ProxiedRequest, ClaudeRequestBody, SseEvent
├── Services/RequestStore.cs            # In-memory circular buffer (max 1000 requests)
├── Proxy/CaptureTransformProvider.cs   # YARP ITransformProvider for request/response capture
├── Hubs/DashboardHub.cs                # SignalR hub for real-time dashboard updates
└── wwwroot/                            # Dashboard SPA (vanilla HTML/JS/CSS)
    ├── index.html                      # Landing page with view selection
    ├── inspector/                      # HTTP Inspector view
    ├── conversation/                   # Conversation view
    ├── css/                            # Stylesheets
    └── js/                             # Dashboard and conversation scripts
```


## Security

- API keys (`x-api-key` and `Authorization` headers) are automatically redacted from stored request data
- The proxy only listens on `localhost` - it is not exposed to the network
- Request data is stored in memory only (max 1000 requests, no persistence)

## About the author

This tool was developed by [Tore Nestenius](https://nestenius.se/), a seasoned .NET instructor and consultant with over 25 years of experience in software development and architecture. With extensive 
expertise in .NET, Azure, and cloud computing, Tore is passionate about helping developers and organizations build robust software solutions and optimize their development processes. A frequent 
speaker at conferences and user groups, Tore actively shares his knowledge and insights with the community, fostering learning and growth for developers worldwide.

* [Stack Overflow](https://stackoverflow.com/users/68490/tore-nestenius)
* [LinkedIn](https://www.linkedin.com/in/torenestenius/)
* [Blog](https://nestenius.se/)
* [Company](https://tn-data.se/)


## License

This project is licensed under the [MIT License](LICENSE).
