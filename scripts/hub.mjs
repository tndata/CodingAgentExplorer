// Minimal SignalR (JSON protocol) client for the dashboard hub, using only Node's built-in fetch and WebSocket.
// Used by capture-summary.mjs and smoke.mjs. Needs Node 22 or later.

const RS = "\x1e"; // SignalR message separator

export async function connect(base = "http://localhost:5000") {
    const negotiate = await fetch(`${base}/hub/negotiate?negotiateVersion=1`, { method: "POST" });
    if (!negotiate.ok) throw new Error(`negotiate failed: HTTP ${negotiate.status}`);
    const info = await negotiate.json();
    const id = info.connectionToken ?? info.connectionId;

    const ws = new WebSocket(`${base.replace("http", "ws")}/hub?id=${encodeURIComponent(id)}`);
    const history = { History: [], HookHistory: [], McpHistory: [] };
    const events = [];
    let handshakeDone = false;
    let onHandshake;
    const handshake = new Promise((resolve) => (onHandshake = resolve));

    ws.addEventListener("message", (e) => {
        for (const part of String(e.data).split(RS).filter(Boolean)) {
            const msg = JSON.parse(part);
            if (!handshakeDone) {
                handshakeDone = true;
                onHandshake();
                continue;
            }
            if (msg.type === 1) {
                if (msg.target in history) history[msg.target] = msg.arguments[0];
                else events.push({ target: msg.target, args: msg.arguments });
            }
        }
    });

    await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", () => reject(new Error("WebSocket error")), { once: true });
    });
    ws.send(JSON.stringify({ protocol: "json", version: 1 }) + RS);
    await handshake;
    await new Promise((r) => setTimeout(r, 500)); // the hub sends the history right after connecting

    return {
        history,
        events,
        invoke: (target, ...args) => ws.send(JSON.stringify({ type: 1, target, arguments: args }) + RS),
        close: () => ws.close(),
    };
}
