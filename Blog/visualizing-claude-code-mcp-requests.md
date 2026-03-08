# Visualizing Claude Code MCP Requests with the Coding Agent Explorer

Model Context Protocol (MCP) servers are becoming a key part of how Claude Code extends its capabilities. They give the agent access to documentation, code search, external APIs, and much more. But when Claude Code talks to an MCP server, what exactly is it saying? And what is the server sending back?

Until now, that communication has been invisible. The MCP Observer changes that. It is a new feature in the Coding Agent Explorer that intercepts all traffic between Claude Code and any MCP server and displays it in a real-time dashboard, with both a raw JSON view and a readable, formatted view that makes sense of the data.

Here is what you will learn in this post:

- What MCP is and why it matters for coding agents
- What the MCP Observer does and how it works
- How to configure it and connect it to any MCP server
- What you can see in the dashboard
- A few MCP services to try straight away

This is a multi-part series on the [Coding Agent Explorer](https://github.com/tndata/CodingAgentExplorer), an open-source .NET tool for inspecting what AI coding agents do under the hood. You can jump to the section you need, but for background and context, it's best to start here:

- **Part 1** - [Introducing the Coding Agent Explorer (.NET)](https://nestenius.se/ai/introducing-the-coding-agent-explorer-net/)
- **Part 2** - [Exploring Claude Code Hooks with the Coding Agent Explorer](LINK_TO_HOOKS_POST)
- **Part 3** - Visualizing Claude Code MCP Requests with the Coding Agent Explorer *(this post)*

---

## What Is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that lets AI agents connect to external tools and data sources. An MCP server exposes a set of tools that the agent can discover and call, just like a REST API but designed specifically for AI agent communication.

Claude Code has built-in support for MCP. You can register any MCP server, and Claude Code will automatically discover the tools it provides and use them when they are relevant to the task at hand.

The protocol is built on JSON-RPC 2.0. When Claude Code connects to an MCP server, it sends messages like `initialize`, `tools/list`, and `tools/call`. The server responds with its capabilities and tool results. This is the conversation the MCP Observer lets you see.

### HTTP vs. STDIO MCP Servers

MCP servers can communicate over two transports: HTTP and STDIO. Claude Code supports both.

**HTTP servers** expose a URL that Claude Code connects to over the network. The traffic is standard HTTP, which means a proxy can sit in the middle and capture it transparently. This is what the MCP Observer uses.

**STDIO servers** run as a local process. Claude Code launches the process and communicates with it over stdin and stdout. The MCP Observer cannot intercept this communication, so STDIO-based servers are not visible in the observer.

That said, Claude Code's `PreToolUse` and `PostToolUse` hooks fire for MCP tool calls regardless of transport. They do not show the raw JSON-RPC protocol, but they do show which MCP tool was called and what parameters were passed. That is enough to understand what the agent is doing, even without the protocol detail. If you have not read the [previous post on hooks](LINK_TO_HOOKS_POST), it is a good companion to this one.

---

<!-- IMAGE: Diagram showing the MCP Observer sitting between Claude Code and the MCP server. Claude Code on the left sends requests to port 9999 (MCP Observer, middle), which forwards them to the real MCP server on the right. The dashboard appears below the MCP Observer, connected via SignalR. Dark background with simple arrows. -->

---

## What Is the MCP Observer?

The MCP Observer is a transparent proxy that runs on port 9999 (HTTP). Claude Code thinks it is talking to the real MCP server. In reality, it is talking to the observer, which forwards every request to the real server, captures the traffic, and displays it on the dashboard.

Here is how the data flows:

```
Claude Code
    |
    | (MCP JSON-RPC requests)
    v
MCP Observer  (http://localhost:9999)
    |
    | (forwarded to real MCP server)
    v
Real MCP Server  (e.g. https://learn.microsoft.com/api/mcp)
    |
    | (response forwarded back to Claude Code)
    v
Dashboard  (https://localhost:5001/mcp/index.html)
```

Claude Code gets the real responses without any modification. The observer is completely transparent. You can add it to any MCP workflow without changing how Claude Code or the MCP server behaves.

### Why HTTP Only on Port 9999?

The proxy between Claude Code and the observer runs over plain HTTP, not HTTPS. This is intentional. The connection is local-only: both Claude Code and the observer run on the same machine, so the traffic never leaves your computer and encryption adds no security benefit. Using HTTP also avoids the need to set up a local certificate, which would make the setup significantly more involved.

The outbound connection from the observer to the real MCP server is a separate matter. The observer forwards requests to whatever URL you configure, and that connection uses whatever scheme the server requires. In practice, all public MCP servers use HTTPS, so the traffic between the observer and the real server is always encrypted.

---

## How to Set It Up

Setting up the MCP Observer takes about two minutes.

### Step 1: Start the Coding Agent Explorer

```bash
dotnet run
```

This starts the MCP proxy on port 9999 alongside the existing proxy on port 8888 and the dashboard on ports 5000 and 5001.

For details on how to install, build, and run the Coding Agent Explorer, see the first post in this series: [Introducing the Coding Agent Explorer (.NET)](https://nestenius.se/ai/introducing-the-coding-agent-explorer-net/).

### Step 2: Create a working directory

Create a fresh folder where you will run `claude`. Then open a terminal in that folder before running the next step.

### Step 3: Register the proxy with Claude Code

Run this command in your terminal from inside your working directory:

```bash
claude mcp add --transport http mcp_proxy http://localhost:9999
```

By default this uses **local scope**: the registration is stored in `~/.claude.json` under your project path and is only active when Claude Code is started from this directory.

The URL `http://localhost:9999` is the fixed address of the MCP Observer proxy and never changes. Which real MCP server the traffic is forwarded to is controlled separately inside the MCP Observer dashboard. You only need to run this command once.


To remove the registration later:

```bash
claude mcp remove mcp_proxy
```

For full details on scopes and other options, see the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp#installing-mcp-servers).

### Step 4: Verify the MCP configuration

Start Claude Code and run the `/mcp` command:

```
/mcp
```

This lists all registered MCP servers and their connection status. You should see `mcp_proxy` listed as connected. If the status shows an error, check that the Coding Agent Explorer is running and that a destination URL has been set in the MCP Observer dashboard.

### Step 5: Open the MCP Observer dashboard

Open the dashboard at [https://localhost:5001](https://localhost:5001) and click **MCP Observer** in the navigation bar.

---

<!-- IMAGE: Screenshot of the MCP Observer dashboard at startup. Shows the top navigation bar with "Home | Inspector | Conversation | MCP Observer" links, the destination URL input field pre-filled with "https://gitmcp.io/tndata/CloudDebugger", a Set and Clear button, and a status line reading "No destination configured. Port 9999 is not active." The table below is empty. Dark theme. -->

---

### Step 6: Set the destination URL

The destination URL field is pre-filled with `https://gitmcp.io/tndata/CloudDebugger` as a ready-to-use default. This is the MCP endpoint for [Cloud Debugger](https://github.com/tndata/CloudDebugger), another open-source project by the author of the Coding Agent Explorer. It is a good starting point if you just want to try the observer without setting up your own MCP server.

[GitMCP](https://github.com/idosal/git-mcp) is a free, open-source service that turns any GitHub repository into a remote MCP server, giving AI tools access to up-to-date documentation and code directly from the source.

Leave the default URL in place and click **Set** to activate it. The status line updates to confirm the proxy is active and forwarding traffic.

When you click **Set**, the Coding Agent Explorer updates its internal destination and reconfigures the YARP reverse proxy on port 9999 to forward traffic to the new URL. No restart is needed. Only one destination can be active at a time. If you change it, the request history is cleared so the table always reflects a single server.

> **Important:** If you change the destination URL while Claude Code is already running, restart Claude Code before continuing. Claude Code caches tool information from the MCP server when it connects, and it will not pick up the new server's tools until it reconnects.

### Step 7: Try your first prompt

The Cloud Debugger is an open-source .NET tool for debugging live Azure applications. It can capture and display HTTP requests, exceptions, service bus messages, and more, without attaching a debugger or redeploying.

With the MCP Observer active and the Cloud Debugger endpoint set, start Claude Code from your working directory and try one of these prompts:

> "What is the Cloud Debugger and what can it do?"

> "Does the Cloud Debugger include any Python code?"

> "Which Azure services does the Cloud Debugger support?"

Watch the MCP Observer dashboard as Claude Code connects: you will see the `initialize` and `tools/list` calls appear first, followed by one or more `tools/call` requests as Claude Code fetches the information it needs to answer your question.

---

## What You Can See

The MCP Observer captures every request and response and displays them in a table, sorted oldest to newest. Each row shows the time, HTTP method, path, JSON-RPC method, response status, and duration.

---

<!-- IMAGE: Screenshot of the MCP Observer request table showing several rows. Rows include: initialize (200, 11 seconds), tools/list (200, 10 seconds), notifications/initialized (202, 53ms), tools/call (query-docs) (200, 2.1s). The "JSON-RPC Method" column shows "tools/call (query-docs)" for a tools/call row, with the tool name in parentheses. Dark theme table with green status codes. -->

---

For `tools/call` requests, the JSON-RPC method column shows the name of the tool that was called in parentheses, so you can see at a glance which tools Claude Code is using. For example: `tools/call (search_docs)` or `tools/call (fetch_page)`.

Click any row to open the detail panel at the bottom, which shows the request body on the left and the response on the right.

### Two Ways to View the Response

The response panel has two view modes: **Pretty** and **Raw**.

**Pretty** is the default. It renders the response in a readable format that depends on the type of request:

- **tools/list** responses are shown as a card for each tool, with the tool name, description, and input parameters clearly laid out.
- **initialize** responses show the protocol version, server name and version, and capabilities as a simple key-value list.
- **tools/call** responses show the returned content directly, so you can read the actual text the MCP server returned.
- All other responses fall back to formatted JSON.

**Raw** shows the full JSON, pretty-printed, so you can inspect every field.

---

<!-- IMAGE: Side-by-side screenshot showing the Pretty view for a tools/list response on the left and the Raw JSON view for the same response on the right. The Pretty view shows tool cards with purple tool names, descriptions, and parameter lists. The Raw view shows the full indented JSON. Both in dark theme. -->

---

## Sample MCP Services to Try

Here are two public MCP services that work well as starting points.

### Microsoft Learn

The Microsoft Learn MCP server gives Claude Code access to the full Microsoft documentation, including Azure, .NET, and the rest of the Microsoft ecosystem.

Destination URL:

```
https://learn.microsoft.com/api/mcp
```

Once registered, try asking Claude Code:

> "How do I create an Azure Container App using the az CLI?"

You will see Claude Code call `tools/list` to discover the available tools, then call one or more of them to fetch the relevant documentation, and finally use the results to answer your question. The MCP Observer shows each of those calls as they happen.

### Context7

Context7 provides up-to-date documentation for popular libraries and frameworks. It is particularly useful for questions about rapidly changing ecosystems like Next.js, where training data can be out of date.

Destination URL:

```
https://mcp.context7.com/mcp
```

Once registered, try asking Claude Code:

> "How do I set up middleware in Next.js 15? use context7"

The "use context7" hint tells Claude Code to prioritise the Context7 MCP server for this query. Watch the MCP Observer to see how it resolves the library ID, fetches the relevant documentation, and uses it to answer your question.

---

## A Practical Example: Watching a tools/call in Action

To make this concrete, here is what happens when you ask Claude Code the Azure Container App question above.

You type your prompt. Claude Code connects to the MCP server and the observer captures the following sequence:

```
14:12:01  initialize                  200   10,708 ms
14:12:01  notifications/initialized   202      53 ms
14:12:02  tools/list                  200   10,078 ms
14:12:14  tools/call (search_azure)   200    2,341 ms
```

Clicking the `tools/list` row in Pretty view shows all the tools the Microsoft Learn MCP server exposes: their names, descriptions, and accepted parameters. Clicking the `tools/call` row shows exactly what Claude Code asked for and what the server returned.

---

<!-- IMAGE: Screenshot of the detail panel for a tools/call row. Left side shows the request body with method "tools/call", params.name "search_azure", and the arguments including the search query. Right side shows the Pretty view of the response with the returned documentation text. Dark theme. -->

---

## MCP Requests and Hooks

The MCP Observer shows you the protocol-level conversation between Claude Code and the MCP server. But there is a complementary view available in the Conversation View if you have hooks configured.

Claude Code fires `PreToolUse` and `PostToolUse` hook events for every MCP tool call, just as it does for built-in tools like `Read` or `Bash`. If you have set up HookAgent as described in the [previous post in this series](LINK_TO_HOOKS_POST), those events appear in the Conversation View alongside the LLM API calls. This lets you see MCP tool usage in context: you can watch the LLM call that triggered the tool call, the hook events that fired around it, and the next LLM call that consumed the result, all on the same timeline.

The MCP Observer and the Conversation View complement each other. The observer shows you the raw protocol detail. The Conversation View with hooks shows you the full picture of what the agent was doing and why.

---

## Why This Matters

Most developers who start using MCP servers treat them as a black box. You register a server, Claude Code uses it, and something useful happens. But what tools does the server expose? What does Claude Code actually ask it? What does the server send back?

Those are exactly the questions the MCP Observer answers. Once you can see the traffic, you can evaluate whether a server is giving Claude Code good information, whether the tool descriptions are clear enough for the model to use them correctly, and whether the responses are fast enough to be practical.

For anyone building their own MCP server, the observer is invaluable. You can see exactly how Claude Code interacts with your server during development, without adding any logging to the server itself.

---

## What's Next

The Coding Agent Explorer now covers three layers of Claude Code's operation: the LLM API (HTTP Inspector and Conversation View), the lifecycle events (hooks), and MCP servers (MCP Observer). Together they give you a complete picture of what the agent is doing at every level.

The full project is open-source and available on GitHub:

[github.com/tndata/CodingAgentExplorer](https://github.com/tndata/CodingAgentExplorer)

---

## I Want Your Feedback!

If you try the MCP Observer and find a bug, have a feature request, or want to share your experience, please [create an issue on GitHub](https://github.com/tndata/CodingAgentExplorer/issues). Contributions are welcome. The codebase is intentionally simple to make it easy to jump in.

---

## Want to Learn Agentic Development?

I run a workshop called "Agentic Development with Claude Code" where we use the Coding Agent Explorer to explore how coding agents work under the hood. The MCP Observer is one of the tools I use to show participants exactly how Claude Code discovers and uses external tools.

You can read more about my workshops here: [tn-data.se/courses](https://tn-data.se/courses/)

I also give a presentation called "How Does a Coding Agent Work?" for companies and conferences. [Contact me](https://tn-data.se/) if you are interested.

---

## Frequently Asked Questions

**Does the MCP Observer affect Claude Code or the MCP server in any way?**

No. The observer forwards requests and responses without modification. Both Claude Code and the MCP server behave exactly as they would without the proxy.

**Can I use the MCP Observer with any MCP server?**

Yes, as long as the server uses the streamable HTTP transport (which all modern MCP servers do). Enter the server's URL in the destination field and click Set.

**Can I watch multiple MCP servers at the same time?**

Not currently. The observer is configured for one destination at a time. To switch servers, enter the new URL and click Set. The request history is cleared when you change the destination. After changing the URL you must also restart Claude Code, since it caches tool information from the MCP server at startup and will not pick up the new server's tools until it reconnects.

**Why does changing the destination clear the request history?**

Mixing requests from different servers in the same list would make the timeline confusing and hard to read. Clearing on change keeps the view focused on the server you are currently observing.

**Do I need to restart Claude Code after registering the proxy?**

Always start Claude Code after the Coding Agent Explorer is already running and after you have set the destination URL in the MCP Observer dashboard. Claude Code connects to the MCP server during startup to discover its tools. If the proxy is not yet active when Claude Code starts, it will not find any tools.

**Can I observe STDIO-based MCP servers?**

Not with the MCP Observer, which only works with HTTP transport. However, Claude Code fires `PreToolUse` and `PostToolUse` hook events for every MCP tool call regardless of transport. If you have hooks configured, those events appear in the Conversation View and show you which tool was called and what parameters were passed. It is a higher-level view than the raw JSON-RPC protocol, but it gives you meaningful visibility into what the agent is doing. See the [previous post in this series](LINK_TO_HOOKS_POST) for details on setting up hooks.

---

## About the Author

Tore Nestenius is a Microsoft MVP in .NET and a senior .NET consultant, instructor, and software architect with over 25 years of experience in software development. He specializes in .NET, ASP.NET Core, Azure, identity architecture, and application security.

Tore delivers workshops, Azure training, and technical presentations for development teams across Europe, with a focus on practical, hands-on learning.

Learn more on his blog at [nestenius.se](https://nestenius.se/) or explore his workshops at [tn-data.se](https://tn-data.se/).

---

## Related Posts

- [Introducing the Coding Agent Explorer (.NET)](https://nestenius.se/ai/introducing-the-coding-agent-explorer-net/)
- [Exploring Claude Code Hooks with the Coding Agent Explorer](LINK_TO_HOOKS_POST)
- [Introducing the Cloud Debugger for Azure](https://nestenius.se/)
- [DefaultAzureCredentials Under the Hood](https://nestenius.se/)
