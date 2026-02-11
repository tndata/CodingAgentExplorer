const connection = new signalR.HubConnectionBuilder()
    .withUrl("/hub")
    .withAutomaticReconnect()
    .build();

let requests = [];
let selectedId = null;
let activeTab = "overview";

// DOM elements
const tbody = document.getElementById("requestTableBody");
const statusDot = document.getElementById("connectionStatus");
const statusText = document.getElementById("connectionText");
const requestCount = document.getElementById("requestCount");
const detailPanel = document.getElementById("detailPanel");
const detailTitle = document.getElementById("detailTitle");
const detailContent = document.getElementById("detailContent");
const closeDetail = document.getElementById("closeDetail");

// Connection status
connection.onreconnecting(() => {
    statusDot.className = "status-dot disconnected";
    statusText.textContent = "Reconnecting...";
});

connection.onreconnected(() => {
    statusDot.className = "status-dot connected";
    statusText.textContent = "Connected";
});

connection.onclose(() => {
    statusDot.className = "status-dot disconnected";
    statusText.textContent = "Disconnected";
});

// Receive history on connect
connection.on("History", (history) => {
    requests = history;
    renderTable();
    updateCount();
});

// Receive clear
connection.on("Cleared", () => {
    requests = [];
    selectedId = null;
    detailPanel.classList.add("hidden");
    renderTable();
    updateCount();
});

// Clear button
document.getElementById("clearBtn").addEventListener("click", () => {
    connection.invoke("ClearAll").catch(err => console.error("Clear failed:", err));
});

// Receive new request
connection.on("NewRequest", (req) => {
    requests.push(req);
    renderTable();
    updateCount();

    // If detail panel is showing this request, refresh it
    if (selectedId === req.id) {
        showDetail(req);
    }
});

// Start connection
connection.start().then(() => {
    statusDot.className = "status-dot connected";
    statusText.textContent = "Connected";
}).catch(err => {
    console.error("SignalR connection error:", err);
});

// Render table
function renderTable() {
    const fragment = document.createDocumentFragment();

    // Show oldest first (newest at bottom)
    for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const tr = document.createElement("tr");
        if (req.id === selectedId) tr.classList.add("selected");

        tr.innerHTML = `
            <td>${formatTime(req.timestamp)}</td>
            <td>${esc(req.method)}</td>
            <td title="${esc(req.path)}">${truncate(req.path, 40)}</td>
            <td>${esc(req.model || "-")}</td>
            <td>${req.isStreaming
                ? '<span class="badge badge-stream">SSE</span>'
                : '<span class="badge badge-sync">Sync</span>'}</td>
            <td class="${statusClass(req.statusCode)}">${req.statusCode || "-"}</td>
            <td>${formatTokens(req.inputTokens)}/${formatTokens(req.outputTokens)}</td>
            <td>${formatTokens(req.cacheCreationInputTokens)}/${formatTokens(req.cacheReadInputTokens)}</td>
            <td>${formatDuration(req.durationMs)}</td>
            <td>${formatDuration(req.timeToFirstTokenMs)}</td>
        `;

        tr.addEventListener("click", () => {
            selectedId = req.id;
            showDetail(req);
            renderTable();
        });

        fragment.appendChild(tr);
    }

    tbody.innerHTML = "";
    tbody.appendChild(fragment);
}

function updateCount() {
    requestCount.textContent = `${requests.length} request${requests.length !== 1 ? "s" : ""}`;
}

// Detail panel
function showDetail(req) {
    detailPanel.classList.remove("hidden");
    detailTitle.textContent = `${req.method} ${req.path}`;
    renderDetailTab(req);
}

// Copy JSON button
document.getElementById("copyJsonBtn").addEventListener("click", () => {
    const req = requests.find(r => r.id === selectedId);
    if (!req) return;

    let requestBody = null;
    try { requestBody = JSON.parse(req.requestBody); } catch { requestBody = req.requestBody || null; }

    let responseBody = null;
    if (req.isStreaming && req.sseEvents && req.sseEvents.length > 0) {
        // For streaming responses, reconstruct from SSE events
        responseBody = req.sseEvents.map(e => {
            try { return JSON.parse(e.data); } catch { return e.data; }
        });
    } else {
        try { responseBody = JSON.parse(req.responseBody); } catch { responseBody = req.responseBody || null; }
    }

    const json = JSON.stringify({ request: requestBody, response: responseBody }, null, 2);

    navigator.clipboard.writeText(json).then(() => {
        const btn = document.getElementById("copyJsonBtn");
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
            btn.textContent = "Copy JSON";
            btn.classList.remove("copied");
        }, 1500);
    });
});

closeDetail.addEventListener("click", () => {
    detailPanel.classList.add("hidden");
    selectedId = null;
    renderTable();
});

// Tab switching
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeTab = btn.dataset.tab;

        const req = requests.find(r => r.id === selectedId);
        if (req) renderDetailTab(req);
    });
});

function renderDetailTab(req) {
    switch (activeTab) {
        case "overview":
            detailContent.innerHTML = renderOverview(req);
            break;
        case "request":
            detailContent.innerHTML = renderRequest(req);
            break;
        case "response":
            detailContent.innerHTML = renderResponse(req);
            break;
        case "events":
            detailContent.innerHTML = renderEvents(req);
            break;
    }
}

function renderOverview(req) {
    return `
        <div class="detail-section">
            <h3>General</h3>
            <dl class="detail-grid">
                <dt>ID</dt><dd>${esc(req.id)}</dd>
                <dt>Timestamp</dt><dd>${new Date(req.timestamp).toLocaleString()}</dd>
                <dt>Method</dt><dd>${esc(req.method)}</dd>
                <dt>Path</dt><dd>${esc(req.path)}</dd>
                <dt>Status</dt><dd class="${statusClass(req.statusCode)}">${req.statusCode || "-"}</dd>
                <dt>Model</dt><dd>${esc(req.model || "-")}</dd>
                <dt>Streaming</dt><dd>${req.isStreaming ? "Yes" : "No"}</dd>
                <dt>Max Tokens</dt><dd>${req.maxTokens || "-"}</dd>
            </dl>
        </div>
        <div class="detail-section">
            <h3>Tokens</h3>
            <dl class="detail-grid">
                <dt>Input</dt><dd>${formatTokens(req.inputTokens)}</dd>
                <dt>Output</dt><dd>${formatTokens(req.outputTokens)}</dd>
                <dt>Cache Create</dt><dd>${formatTokens(req.cacheCreationInputTokens)}</dd>
                <dt>Cache Read</dt><dd>${formatTokens(req.cacheReadInputTokens)}</dd>
            </dl>
        </div>
        <div class="detail-section">
            <h3>Timing</h3>
            <dl class="detail-grid">
                <dt>Duration</dt><dd>${formatDuration(req.durationMs)}</dd>
                <dt>TTFT</dt><dd>${formatDuration(req.timeToFirstTokenMs)}</dd>
                <dt>Message ID</dt><dd>${esc(req.messageId || "-")}</dd>
                <dt>Stop Reason</dt><dd>${esc(req.stopReason || "-")}</dd>
            </dl>
        </div>`;
}

function renderRequest(req) {
    const headers = Object.entries(req.requestHeaders || {})
        .map(([k, v]) => `${esc(k)}: ${esc(v)}`)
        .join("\n");

    let body = req.requestBody || "";
    try {
        body = JSON.stringify(JSON.parse(body), null, 2);
    } catch { }

    return `
        <div class="detail-section">
            <h3>Request Headers</h3>
            <pre class="code-block">${esc(headers) || "(none)"}</pre>
        </div>
        <div class="detail-section">
            <h3>Request Body</h3>
            <pre class="code-block">${esc(body) || "(empty)"}</pre>
        </div>`;
}

function renderResponse(req) {
    const headers = Object.entries(req.responseHeaders || {})
        .map(([k, v]) => `${esc(k)}: ${esc(v)}`)
        .join("\n");

    let body = req.responseBody || "";
    try {
        body = JSON.stringify(JSON.parse(body), null, 2);
    } catch { }

    return `
        <div class="detail-section">
            <h3>Response Headers</h3>
            <pre class="code-block">${esc(headers) || "(none)"}</pre>
        </div>
        <div class="detail-section">
            <h3>Response Body</h3>
            <pre class="code-block">${esc(body) || (req.isStreaming ? "(streaming - see SSE Events tab)" : "(empty)")}</pre>
        </div>`;
}

function renderEvents(req) {
    if (!req.sseEvents || req.sseEvents.length === 0) {
        return `<p style="color: var(--text-secondary);">No SSE events captured.</p>`;
    }

    const items = req.sseEvents.map(e => {
        let dataPreview = e.data || "";
        if (dataPreview.length > 200) {
            dataPreview = dataPreview.substring(0, 200) + "...";
        }
        return `<li><span class="event-type">${esc(e.eventType || "data")}</span><span class="event-data">${esc(dataPreview)}</span></li>`;
    }).join("");

    return `
        <div class="detail-section">
            <h3>${req.sseEvents.length} SSE Events</h3>
            <ul class="events-list">${items}</ul>
        </div>`;
}

// Helpers
function formatTime(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false });
}

function formatTokens(n) {
    if (n == null) return "-";
    return n.toLocaleString();
}

function formatDuration(ms) {
    if (ms == null) return "-";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function statusClass(code) {
    if (!code) return "";
    if (code >= 200 && code < 300) return "status-2xx";
    if (code >= 400 && code < 500) return "status-4xx";
    if (code >= 500) return "status-5xx";
    return "";
}

function truncate(str, len) {
    if (!str) return "-";
    return str.length > len ? str.substring(0, len) + "..." : str;
}

function esc(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
}
