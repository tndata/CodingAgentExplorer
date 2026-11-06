// Smoke test for a running CodingAgentExplorer. Sends a fixed set of requests through the proxy ports and
// the dashboard API, then checks what was captured. It uses no API key and spends no model tokens:
// Anthropic answers the unauthenticated requests with HTTP 401, which is enough to test capture, headers
// and redaction. The MCP part talks to Microsoft Learn's public MCP server (no login).
//
//   node scripts/smoke.mjs             run the smoke test
//   node scripts/smoke.mjs --keep      do not clear the captured data first
//   node scripts/smoke.mjs --claude    also run one tiny `claude -p` call through the proxy (uses your own login and a few tokens)
//
// Start the app first (dotnet run --project CodingAgentExplorer). Needs Node 22 or later.

import { spawnSync } from "node:child_process";
import { connect } from "./hub.mjs";
import { summarizeHook, summarizeMcp, summarizeRequest } from "./summarize.mjs";

const args = new Set(process.argv.slice(2));
const dashboard = "http://localhost:5000";
const claudeProxy = "http://localhost:8888";
const mcpProxy = "http://localhost:9999";
const mcpDestination = "https://learn.microsoft.com/api/mcp";

const results = [];
const check = (name, ok, detail = "") => {
    results.push({ name, ok });
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};
const warn = (text) => console.log(`  WARN  ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snapshot() {
    const hub = await connect(dashboard);
    const h = hub.history;
    hub.close();
    return {
        http: h.History.map(summarizeRequest),
        hooks: h.HookHistory.map(summarizeHook),
        mcp: h.McpHistory.map(summarizeMcp),
        raw: h,
    };
}

// 0. Is the app running?
try {
    await fetch(dashboard, { signal: AbortSignal.timeout(3000) });
} catch {
    console.error(`Cannot reach ${dashboard}. Start the app first: dotnet run --project CodingAgentExplorer`);
    process.exit(2);
}

if (!args.has("--keep")) {
    const hub = await connect(dashboard);
    hub.invoke("ClearAll");
    await sleep(300);
    hub.close();
}

const jsonHeaders = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": "test-not-a-real-key",
    "x-claude-code-session-id": "smoke-session",
    "x-claude-code-request-class": "main",
    "x-claude-code-prompt-id": "smoke-prompt",
};
const messageBody = (stream) => JSON.stringify({
    model: "claude-haiku-5-5",
    max_tokens: 16,
    stream,
    messages: [{ role: "user", content: "SMOKE-TEST" }],
});

console.log("Sending requests...");
const statuses = {};
statuses.hello = (await fetch(`${claudeProxy}/api/hello`, { method: "HEAD" })).status;
statuses.messages = (await fetch(`${claudeProxy}/v1/messages?beta=true`, { method: "POST", headers: jsonHeaders, body: messageBody(false) })).status;
statuses.stream = (await fetch(`${claudeProxy}/v1/messages?beta=true`, { method: "POST", headers: jsonHeaders, body: messageBody(true) })).status;
statuses.count = (await fetch(`${claudeProxy}/v1/messages/count_tokens`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ model: "claude-haiku-5-5", messages: [{ role: "user", content: "hi" }] }) })).status;

const hookPayload = (name, input) => ({
    hookEventName: name,
    sessionId: "smoke-session",
    cwd: "/smoke",
    permissionMode: "default",
    hookInput: { hook_event_name: name, session_id: "smoke-session", ...input },
    environmentVariables: {},
});
const hookResponses = [];
for (const [name, input] of [
    ["UserPromptSubmit", { prompt: "SMOKE-TEST" }],
    ["PostToolBatch", { tool_calls: [{ tool_name: "Read" }, { tool_name: "Grep" }] }],
    ["SubagentStop", { agent_type: "Explore" }],
    ["StopFailure", { error: "overloaded" }],
]) {
    const res = await fetch(`${dashboard}/api/hook-event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(hookPayload(name, input)) });
    hookResponses.push({ status: res.status, body: await res.json().catch(() => null) });
}

let mcpOk = true;
const mcpStatuses = [];
try {
    await fetch(`${dashboard}/api/mcp-destination`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: mcpDestination }) });
    await sleep(500); // YARP reloads its routes
    const mcpHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
    const init = await fetch(mcpProxy, { method: "POST", headers: mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } }) });
    mcpStatuses.push(init.status);
    const sessionId = init.headers.get("mcp-session-id");
    await init.text();
    const list = await fetch(mcpProxy, { method: "POST", headers: { ...mcpHeaders, ...(sessionId ? { "mcp-session-id": sessionId } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    mcpStatuses.push(list.status);
    await list.text();
} catch (e) {
    mcpOk = false;
    warn(`MCP part skipped, the destination could not be reached: ${e.message}`);
}

if (args.has("--claude")) {
    console.log("Running one tiny claude -p call through the proxy...");
    const run = spawnSync("claude", ["-p", "SMOKE-CLAUDE: reply with the single word ok"], {
        env: { ...process.env, ANTHROPIC_BASE_URL: claudeProxy, CLAUDE_CODE_GATEWAY_HINT_HEADERS: "1" },
        encoding: "utf8", shell: true, timeout: 180000,
    });
    console.log(`  claude exited with ${run.status}: ${(run.stdout || run.stderr || "").trim().slice(0, 80)}`);
}

await sleep(1000);
const snap = await snapshot();

console.log("\nCaptured:");
console.log(`  HTTP ${snap.http.length}, hooks ${snap.hooks.length}, MCP ${snap.mcp.length}`);
for (const r of snap.http) console.log(`    ${r.time} ${r.method.padEnd(4)} ${r.path.padEnd(26)} ${r.status} ${r.class ?? ""}${r.error ? " ERROR " + r.error : ""}`);
for (const e of snap.hooks) console.log(`    ${e.time} hook ${e.event}${e.agentType ? " agent=" + e.agentType : ""}`);
for (const r of snap.mcp) console.log(`    ${r.time} mcp ${r.rpcMethod ?? r.httpMethod} ${r.status}`);

console.log("\nChecks:");
// Only the smoke script's own requests (a --claude run adds more rows of its own)
const byPath = (p, m) => snap.http.filter((r) => r.path.startsWith(p) && (!m || r.method === m) && (r.promptId === "smoke-prompt" || p === "/api/hello"));
check("HEAD /api/hello is proxied and captured", byPath("/api/hello").length >= 1 && statuses.hello > 0, `status ${statuses.hello}`);
check("POST /v1/messages without a valid key gets 401 from Anthropic", statuses.messages === 401 && byPath("/v1/messages?beta", "POST").some((r) => r.status === 401), `status ${statuses.messages}`);
check("A streaming request that Anthropic rejects is still captured with its status", byPath("/v1/messages?beta", "POST").length === 2 && statuses.stream === 401);
check("count_tokens is captured and gets no usage numbers", byPath("/v1/messages/count_tokens").length === 1 && byPath("/v1/messages/count_tokens")[0].input == null);

const main = byPath("/v1/messages?beta", "POST")[0];
check("MCP requests were captured without a capture error", !mcpOk || snap.mcp.every((r) => r.error == null), snap.mcp.map((r) => r.error).filter(Boolean)[0] ?? "");
// The detail never prints the stored value: if redaction failed, it would be the key itself.
check("x-api-key is redacted in the captured request headers", main?.apiKeyHeader === "[REDACTED]", main?.apiKeyHeader === "[REDACTED]" ? "" : "stored value is not [REDACTED]");
check("Claude Code headers are kept (session id, request class, prompt id)", main?.session === "smoke-session" && main?.class === "main" && main?.promptId === "smoke-prompt");
const rawRequest = snap.raw.History.find((r) => r.path.startsWith("/v1/messages?beta"));
check("The key value never appears anywhere in the captured request", !JSON.stringify(rawRequest).includes("test-not-a-real-key"));

check("All four hook posts returned 200", hookResponses.every((r) => r.status === 200));
check("Hook responses have empty stdout (G1: nothing is added to Claude's context)", hookResponses.every((r) => r.body?.stdout === "" && r.body?.exitCode === 0));
check("All four hook events are captured, in order", snap.hooks.map((e) => e.event).join(",") === "UserPromptSubmit,PostToolBatch,SubagentStop,StopFailure");
check("Captured hook events carry no stdout", snap.hooks.every((e) => e.stdout === ""));

if (mcpOk) {
    check("MCP initialize and tools/list went through port 9999", mcpStatuses.length === 2 && mcpStatuses.every((s) => s === 200), `statuses ${mcpStatuses.join(",")}`);
    const rpc = snap.mcp.map((r) => r.rpcMethod);
    check("MCP requests are captured with their JSON-RPC method", rpc.includes("initialize") && rpc.includes("tools/list"), `methods ${rpc.join(",")}`);
}

if (args.has("--claude")) {
    const claudeRows = snap.http.filter((r) => r.path.startsWith("/v1/messages?beta") && r.status === 200);
    check("The claude -p call produced captured requests with token numbers", claudeRows.some((r) => r.input != null && r.output != null), `${claudeRows.length} rows with status 200`);
    check("Claude Code sent request-class hint headers through the proxy", claudeRows.some((r) => r.class != null));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
