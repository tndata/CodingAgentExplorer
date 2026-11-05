// Prints a compact summary of what CodingAgentExplorer has captured: API requests, hook events and MCP requests.
//
//   node scripts/capture-summary.mjs            readable summary
//   node scripts/capture-summary.mjs --json     the same data as JSON (one object per line)
//   node scripts/capture-summary.mjs --clear    clear all captured data
//
// The app must be running (dashboard on http://localhost:5000). Set CAE_DASHBOARD to use another address.

import { connect } from "./hub.mjs";
import { summarizeHook, summarizeMcp, summarizeRequest } from "./summarize.mjs";

const base = process.env.CAE_DASHBOARD ?? "http://localhost:5000";
const args = new Set(process.argv.slice(2));

const hub = await connect(base);

if (args.has("--clear")) {
    hub.invoke("ClearAll");
    await new Promise((r) => setTimeout(r, 300));
    hub.close();
    console.log("Cleared.");
    process.exit(0);
}

const n = (v) => (v == null ? "-" : String(v));

const http = hub.history.History.map(summarizeRequest);
const hooks = hub.history.HookHistory.map(summarizeHook);
const mcp = hub.history.McpHistory.map(summarizeMcp);
hub.close();

if (args.has("--json")) {
    for (const row of http) console.log(JSON.stringify({ kind: "http", ...row }));
    for (const row of hooks) console.log(JSON.stringify({ kind: "hook", ...row }));
    for (const row of mcp) console.log(JSON.stringify({ kind: "mcp", ...row }));
    process.exit(0);
}

console.log(`HTTP requests: ${http.length}`);
for (const r of http) {
    const tokens = r.input == null && r.output == null ? "" : ` in=${n(r.input)} out=${n(r.output)} cacheW=${n(r.cacheWrite)} cacheR=${n(r.cacheRead)}`;
    const who = [r.class, r.agentType, r.agentId && `agent=${r.agentId.slice(0, 6)}`].filter(Boolean).join(" ");
    console.log(`  ${r.time} ${r.method.padEnd(4)} ${r.path.padEnd(28)} ${n(r.status)} ${r.model}${tokens} ${n(r.ms)}ms${r.stop ? " stop=" + r.stop : ""}${who ? " | " + who : ""}${r.error ? " | ERROR: " + r.error : ""}`);
}

console.log(`Hook events: ${hooks.length}`);
for (const e of hooks) {
    console.log(`  ${e.time} ${e.event}${e.tool ? " tool=" + e.tool : ""}${e.agentType ? " agent=" + e.agentType : ""}${e.stdout ? " STDOUT=" + JSON.stringify(e.stdout) : ""}`);
}

console.log(`MCP requests: ${mcp.length}`);
for (const r of mcp) {
    console.log(`  ${r.time} ${r.httpMethod} ${n(r.rpcMethod)} ${n(r.status)} ${n(r.ms)}ms${r.error ? " | ERROR: " + r.error : ""}`);
}
