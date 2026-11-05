// Reduces captured requests, hook events and MCP requests to the few fields worth looking at.

const lower = (headers = {}) => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
const time = (ts) => String(ts).slice(11, 23);

export function summarizeRequest(r) {
    const h = lower(r.requestHeaders);
    return {
        time: time(r.timestamp),
        method: r.method,
        path: r.path,
        status: r.statusCode,
        model: r.model ?? "-",
        input: r.inputTokens,
        output: r.outputTokens,
        cacheWrite: r.cacheCreationInputTokens,
        cacheRead: r.cacheReadInputTokens,
        stop: r.stopReason,
        ms: r.durationMs == null ? null : Math.round(r.durationMs),
        ttftMs: r.timeToFirstTokenMs == null ? null : Math.round(r.timeToFirstTokenMs),
        streaming: r.isStreaming,
        class: h["x-claude-code-request-class"] ?? null,
        agentType: h["x-claude-code-agent-type"] ?? null,
        agentId: h["x-claude-code-agent-id"] ?? null,
        session: h["x-claude-code-session-id"] ?? null,
        promptId: h["x-claude-code-prompt-id"] ?? null,
        toolDurations: h["x-claude-code-prev-tool-durations"] ?? null,
        apiKeyHeader: h["x-api-key"] ?? null,
        error: r.error ?? null,
    };
}

export function summarizeHook(e) {
    const input = e.hookInput ?? {};
    return {
        time: time(e.timestamp),
        event: e.hookEventName,
        tool: input.tool_name ?? null,
        agentType: input.agent_type ?? null,
        stdout: e.stdout ?? "",
    };
}

export function summarizeMcp(r) {
    let rpcMethod = null;
    try { rpcMethod = JSON.parse(r.requestBody ?? "")?.method ?? null; } catch { /* not JSON */ }
    return { time: time(r.timestamp), httpMethod: r.method, rpcMethod, status: r.statusCode, ms: r.durationMs == null ? null : Math.round(r.durationMs), error: r.error ?? null };
}
