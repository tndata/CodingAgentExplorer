const connection = new signalR.HubConnectionBuilder()
    .withUrl("/hub")
    .withAutomaticReconnect()
    .build();

let requests = [];
let hookEvents = [];
let showHookEvents = true;

// DOM
const feed = document.getElementById("conversationFeed");
const statusDot = document.getElementById("connectionStatus");
const statusText = document.getElementById("connectionText");
const requestCount = document.getElementById("requestCount");

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

// Receive history
connection.on("History", (history) => {
    requests = history;
    renderFeed();
    updateCount();
});

// Receive hook history
connection.on("HookHistory", (history) => {
    hookEvents = history;
    renderFeed();
    updateCount();
});

// Receive new hook event
connection.on("NewHookEvent", (evt) => {
    hookEvents.push(evt);
    insertHookEventInTimeline(evt);
    updateCount();
    autoScroll();
});

// Receive clear
connection.on("Cleared", () => {
    requests = [];
    hookEvents = [];
    renderFeed();
    updateCount();
});

// Clear button
document.getElementById("clearBtn").addEventListener("click", () => {
    connection.invoke("ClearAll").catch(err => console.error("Clear failed:", err));
});

// Hook events checkbox
const hookCb = document.getElementById("showHookEvents");
hookCb.addEventListener("change", () => { showHookEvents = hookCb.checked; renderFeed(); });

// Receive new request
connection.on("NewRequest", (req) => {
    // Replace if we already have this id (update), otherwise append
    const idx = requests.findIndex(r => r.id === req.id);
    if (idx >= 0) {
        requests[idx] = req;
        // Re-render just that exchange
        const existing = feed.querySelector(`[data-id="${req.id}"]`);
        if (existing) {
            const el = buildExchangeElement(req);
            existing.replaceWith(el);
        }
    } else {
        requests.push(req);
        appendExchange(req);
    }
    updateCount();
    autoScroll();
});

// Start
connection.start().then(() => {
    statusDot.className = "status-dot connected";
    statusText.textContent = "Connected";
}).catch(err => console.error("SignalR connection error:", err));

// ---------- Rendering ----------

function renderFeed() {
    feed.innerHTML = "";
    const items = [
        ...requests.map(r => ({ kind: "request", ts: new Date(r.timestamp), data: r })),
        ...(showHookEvents ? hookEvents.map(e => ({ kind: "hook", ts: new Date(e.timestamp), data: e })) : []),
    ].sort((a, b) => a.ts - b.ts);

    if (items.length === 0) {
        feed.innerHTML = '<p class="empty-state">Waiting for API requests...</p>';
        return;
    }
    for (const item of items) {
        if (item.kind === "request") {
            feed.appendChild(buildExchangeElement(item.data));
        } else {
            feed.appendChild(buildHookEventElement(item.data));
        }
    }
    autoScroll();
}

function appendExchange(req) {
    // Remove empty-state if present
    const empty = feed.querySelector(".empty-state");
    if (empty) empty.remove();

    const el = buildExchangeElement(req);
    const reqMs = new Date(req.timestamp).getTime();
    const insertBefore = Array.from(feed.children).find(card =>
        card.dataset.timestamp && parseInt(card.dataset.timestamp) > reqMs
    );
    insertBefore ? feed.insertBefore(el, insertBefore) : feed.appendChild(el);
}

function insertHookEventInTimeline(evt) {
    if (!showHookEvents) return;
    const empty = feed.querySelector(".empty-state");
    if (empty) empty.remove();
    const el = buildHookEventElement(evt);
    const evtMs = new Date(evt.timestamp).getTime();
    const insertBefore = Array.from(feed.children).find(card =>
        card.dataset.timestamp && parseInt(card.dataset.timestamp) > evtMs
    );
    insertBefore ? feed.insertBefore(el, insertBefore) : feed.appendChild(el);
}

function buildExchangeElement(req) {
    const el = document.createElement("div");
    el.className = "exchange";
    el.dataset.id = req.id;
    el.dataset.timestamp = new Date(req.timestamp).getTime();

    // 1. Meta bar
    el.appendChild(buildMetaBar(req));

    // Messages container
    const messagesDiv = document.createElement("div");
    messagesDiv.className = "exchange-messages";

    // 2. Parse request body
    const parsed = parseRequestBody(req.requestBody);

    // System prompt
    if (parsed.system) {
        messagesDiv.appendChild(buildSystemPrompt(parsed.system));
    }

    // Tools section
    if (parsed.tools && parsed.tools.length > 0) {
        messagesDiv.appendChild(buildToolsSection(parsed.tools));
    }

    // 3. Messages from request — collapse history, show only last user message
    if (parsed.messages && parsed.messages.length > 0) {
        const lastIdx = parsed.messages.length - 1;
        // History = everything except the last user message
        // Find the last user message index
        let lastUserIdx = -1;
        for (let i = lastIdx; i >= 0; i--) {
            if ((parsed.messages[i].role || "user") === "user") {
                lastUserIdx = i;
                break;
            }
        }

        const historyMessages = lastUserIdx > 0
            ? parsed.messages.slice(0, lastUserIdx)
            : [];
        const currentMessages = lastUserIdx >= 0
            ? parsed.messages.slice(lastUserIdx)
            : parsed.messages;

        // Collapsed history section
        if (historyMessages.length > 0) {
            messagesDiv.appendChild(buildHistorySection(historyMessages));
        }

        // Current message(s) — always visible
        for (const msg of currentMessages) {
            messagesDiv.appendChild(buildMessageBubble(msg));
        }
    }

    // 4. API response
    let responseContent = req.isStreaming
        ? parseStreamingResponse(req.sseEvents)
        : parseNonStreamingResponse(req.responseBody);

    // Fallback: if streaming parse returned nothing but we have output tokens,
    // try parsing the non-streaming response body as well
    if ((!responseContent || responseContent.length === 0) && req.responseBody) {
        responseContent = parseNonStreamingResponse(req.responseBody);
    }

    if (responseContent && responseContent.length > 0) {
        const responseMsg = document.createElement("div");
        responseMsg.className = "message message-response";

        const label = document.createElement("span");
        label.className = "role-label";
        label.textContent = "Assistant (Response)";
        responseMsg.appendChild(label);

        for (const block of responseContent) {
            responseMsg.appendChild(renderContentBlock(block));
        }
        messagesDiv.appendChild(responseMsg);
    }

    el.appendChild(messagesDiv);

    // 5. Details section
    el.appendChild(buildDetailsSection(req));

    return el;
}

// ---------- Meta Bar ----------

function buildMetaBar(req) {
    const bar = document.createElement("div");
    bar.className = "exchange-meta";

    const totalInputTok = (req.inputTokens || 0) + (req.cacheCreationInputTokens || 0) + (req.cacheReadInputTokens || 0);

    const items = [
        { label: "Time", value: formatTime(req.timestamp), tip: "When the API request was made" },
        { label: "Model", value: req.model || "-", tip: "Claude model used for this request" },
        { label: "Status", value: req.statusCode || "-", cls: statusCls(req.statusCode), tip: "HTTP status code returned by the API" },
        { label: "Context", value: `${formatTokens(totalInputTok)} tok`, tip: "Total input context tokens (new + cache write + cache read)" },
        { label: "New In", value: `${formatTokens(req.inputTokens)} tok`, tip: "Uncached input tokens (billed at full rate)" },
        { label: "Out", value: `${formatTokens(req.outputTokens)} tok`, tip: "Output tokens generated by the model" },
        { label: "Cache W/R", value: `${formatTokens(req.cacheCreationInputTokens)}/${formatTokens(req.cacheReadInputTokens)} tok`, tip: "Cache Write / Cache Read tokens \u2014 tokens written to and read from prompt cache" },
        { label: "Duration", value: formatDuration(req.durationMs), tip: "Total round-trip time for the request" },
        { label: "TTFT", value: formatDuration(req.timeToFirstTokenMs), tip: "Time To First Token \u2014 delay before the first output token arrived" },
        { label: "Stop", value: req.stopReason || "-", tip: "Why the model stopped: end_turn, tool_use, max_tokens, etc." },
    ];

    for (const item of items) {
        const span = document.createElement("span");
        span.className = "meta-item";
        span.title = item.tip;
        span.innerHTML = `<span class="meta-label">${esc(item.label)}:</span> <span class="meta-value ${item.cls || ""}">${esc(String(item.value))}</span>`;
        bar.appendChild(span);
    }

    // Info icon with hover tooltip
    const info = document.createElement("span");
    info.className = "meta-info";
    info.textContent = "\u24D8";

    const tooltip = document.createElement("dl");
    tooltip.className = "meta-tooltip";
    const legend = [
        ["Time", "When the API request was made"],
        ["Model", "Claude model used for this request"],
        ["Status", "HTTP status code returned by the API"],
        ["In", "Input tokens sent to the model"],
        ["Out", "Output tokens generated by the model"],
        ["Cache W/R", "Prompt cache tokens written / read"],
        ["Duration", "Total round-trip time for the request"],
        ["TTFT", "Time To First Token from the model"],
        ["Stop", "Why generation stopped (end_turn, tool_use, max_tokens)"],
    ];
    for (const [term, desc] of legend) {
        const dt = document.createElement("dt");
        dt.textContent = term + ":";
        const dd = document.createElement("dd");
        dd.textContent = desc;
        tooltip.appendChild(dt);
        tooltip.appendChild(dd);
    }
    info.appendChild(tooltip);
    bar.appendChild(info);

    // Copy JSON button
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-json-btn";
    copyBtn.textContent = "Copy JSON";
    copyBtn.title = "Copy request & response bodies as JSON";
    copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyExchangeJson(req, copyBtn);
    });
    bar.appendChild(copyBtn);

    return bar;
}

// ---------- System Prompt ----------

function buildSystemPrompt(systemData) {
    const wrapper = document.createElement("div");
    wrapper.className = "system-prompt";

    // Estimate character count
    let charCount = 0;
    if (typeof systemData === "string") {
        charCount = systemData.length;
    } else if (Array.isArray(systemData)) {
        for (const block of systemData) {
            if (block.type === "text" && block.text) charCount += block.text.length;
            else charCount += JSON.stringify(block).length;
        }
    } else {
        charCount = JSON.stringify(systemData).length;
    }

    const toggle = document.createElement("button");
    toggle.className = "collapse-toggle";
    toggle.innerHTML = `<span class="arrow">&#9654;</span> System Prompt &mdash; ~${formatCharCount(charCount)}`;

    const content = document.createElement("div");
    content.className = "collapsible-content";

    // Format system prompt: can be a string, an array of content blocks, or an object
    if (typeof systemData === "string") {
        content.textContent = systemData;
    } else if (Array.isArray(systemData)) {
        const parts = systemData.map(block => {
            if (block.type === "text" && block.text) {
                return block.text;
            }
            return JSON.stringify(block, null, 2);
        });
        content.textContent = parts.join("\n\n");
    } else {
        content.textContent = JSON.stringify(systemData, null, 2);
    }

    toggle.addEventListener("click", () => {
        toggle.classList.toggle("expanded");
        content.classList.toggle("open");
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(content);
    return wrapper;
}

// ---------- Tools Section (collapsed) ----------

function buildToolsSection(tools) {
    const wrapper = document.createElement("div");
    wrapper.className = "tools-section";

    // Categorize tools: built-in vs MCP (grouped by server)
    const builtIn = [];
    const mcpGroups = {}; // server name -> tool[]

    for (const tool of tools) {
        const name = tool.name || "";
        const match = name.match(/^mcp__([^_]+)__/);
        if (match) {
            const server = match[1];
            if (!mcpGroups[server]) mcpGroups[server] = [];
            mcpGroups[server].push(tool);
        } else {
            builtIn.push(tool);
        }
    }

    // Calculate total char count
    const charCount = JSON.stringify(tools).length;

    // Build summary text
    const summaryParts = [];
    if (builtIn.length > 0) summaryParts.push(`${builtIn.length} built-in`);
    for (const [server, serverTools] of Object.entries(mcpGroups)) {
        summaryParts.push(`${serverTools.length} ${server}`);
    }
    const summaryDetail = summaryParts.length > 0 ? ` (${summaryParts.join(", ")})` : "";

    const toggle = document.createElement("button");
    toggle.className = "collapse-toggle";
    toggle.innerHTML = `<span class="arrow">&#9654;</span> Tools: ${tools.length} total${summaryDetail} &mdash; ~${formatCharCount(charCount)}`;

    const content = document.createElement("div");
    content.className = "collapsible-content tools-content";

    let rendered = false;

    toggle.addEventListener("click", () => {
        toggle.classList.toggle("expanded");
        content.classList.toggle("open");

        // Lazy render on first expand
        if (!rendered) {
            rendered = true;
            renderToolsList(content, builtIn, mcpGroups);
        }
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(content);
    return wrapper;
}

function renderToolsList(container, builtIn, mcpGroups) {
    if (builtIn.length > 0) {
        const group = buildToolGroup("Built-in Tools", builtIn);
        container.appendChild(group);
    }

    for (const [server, tools] of Object.entries(mcpGroups)) {
        const group = buildToolGroup(`MCP: ${server}`, tools);
        container.appendChild(group);
    }
}

function buildToolGroup(title, tools) {
    const group = document.createElement("div");
    group.className = "tools-group";

    const header = document.createElement("div");
    header.className = "tools-group-header";
    header.textContent = `${title} (${tools.length})`;
    group.appendChild(header);

    const list = document.createElement("div");
    list.className = "tools-group-list";

    for (const tool of tools) {
        const name = tool.name || "unknown";
        // Strip mcp__server__ prefix for display
        const displayName = name.replace(/^mcp__[^_]+__/, "");

        const item = document.createElement("div");
        item.className = "tools-item";

        const itemHeader = document.createElement("div");
        itemHeader.className = "tools-item-header";
        itemHeader.innerHTML = `<span class="arrow">&#9654;</span> ${esc(displayName)}`;

        const itemBody = document.createElement("div");
        itemBody.className = "tools-item-body";

        const desc = tool.description || "(no description)";
        itemBody.textContent = desc;

        itemHeader.addEventListener("click", () => {
            itemHeader.classList.toggle("expanded");
            itemBody.classList.toggle("open");
        });

        item.appendChild(itemHeader);
        item.appendChild(itemBody);
        list.appendChild(item);
    }

    group.appendChild(list);
    return group;
}

// ---------- History Section (collapsed) ----------

function buildHistorySection(messages) {
    const wrapper = document.createElement("div");
    wrapper.className = "history-section";

    const summary = buildRoleSummary(messages);
    const charCount = estimateMessagesCharCount(messages);

    const toggle = document.createElement("button");
    toggle.className = "collapse-toggle";
    toggle.innerHTML = `<span class="arrow">&#9654;</span> Context: ${messages.length} messages (${summary}) &mdash; ~${formatCharCount(charCount)}`;

    const content = document.createElement("div");
    content.className = "collapsible-content history-content";

    let rendered = false;

    toggle.addEventListener("click", () => {
        toggle.classList.toggle("expanded");
        content.classList.toggle("open");

        // Lazy render — only build bubbles on first expand
        if (!rendered) {
            rendered = true;
            for (const msg of messages) {
                content.appendChild(buildMessageBubble(msg));
            }
        }
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(content);
    return wrapper;
}

function buildRoleSummary(messages) {
    const userCount = messages.filter(m => (m.role || "user") === "user").length;
    const assistantCount = messages.filter(m => m.role === "assistant").length;
    const parts = [];
    if (userCount > 0) parts.push(`${userCount} user`);
    if (assistantCount > 0) parts.push(`${assistantCount} assistant`);
    return parts.join(", ");
}

function estimateMessagesCharCount(messages) {
    let total = 0;
    for (const msg of messages) {
        total += estimateContentChars(msg.content);
    }
    return total;
}

function estimateContentChars(content) {
    if (typeof content === "string") return content.length;
    if (!Array.isArray(content)) return 0;

    let chars = 0;
    for (const block of content) {
        if (block.text) chars += block.text.length;
        if (block.input) chars += JSON.stringify(block.input).length;
        if (block.content) chars += estimateContentChars(block.content);
    }
    return chars;
}

// ---------- Message Bubbles ----------

function buildMessageBubble(msg) {
    const role = msg.role || "user";
    const isUser = role === "user";
    const cssClass = isUser ? "message-user" : "message-assistant-history";

    const bubble = document.createElement("div");
    bubble.className = `message ${cssClass}`;

    const label = document.createElement("span");
    label.className = "role-label";
    label.textContent = isUser ? "User" : "Assistant (History)";
    bubble.appendChild(label);

    const content = msg.content;
    if (typeof content === "string") {
        const textEl = document.createElement("div");
        textEl.className = "content-text";
        textEl.textContent = content;
        bubble.appendChild(textEl);
    } else if (Array.isArray(content)) {
        for (const block of content) {
            bubble.appendChild(renderContentBlock(block));
        }
    }

    return bubble;
}

// ---------- Content Block Rendering ----------

function renderContentBlock(block) {
    if (!block) {
        const empty = document.createElement("span");
        return empty;
    }

    const type = block.type || "text";

    if (type === "text") {
        const el = document.createElement("div");
        el.className = "content-text";
        el.textContent = block.text || "";
        return el;
    }

    if (type === "tool_use") {
        return buildToolUseBlock(block);
    }

    if (type === "tool_result") {
        return buildToolResultBlock(block);
    }

    // Fallback: render as JSON
    const el = document.createElement("div");
    el.className = "content-text";
    el.textContent = JSON.stringify(block, null, 2);
    return el;
}

function buildToolUseBlock(block) {
    const wrapper = document.createElement("div");
    wrapper.className = "content-tool-use";

    const header = document.createElement("div");
    header.className = "tool-header";
    header.innerHTML = `<span class="arrow">&#9654;</span> Tool: ${esc(block.name || "unknown")}${block.id ? ` <span style="opacity:0.5">(${esc(block.id)})</span>` : ""}`;

    const body = document.createElement("div");
    body.className = "tool-body";
    body.textContent = JSON.stringify(block.input || {}, null, 2);

    header.addEventListener("click", () => {
        header.classList.toggle("expanded");
        body.classList.toggle("open");
    });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
}

function buildToolResultBlock(block) {
    const wrapper = document.createElement("div");
    wrapper.className = "content-tool-result";

    const toolId = block.tool_use_id || "";
    const isError = block.is_error === true;

    const header = document.createElement("div");
    header.className = "tool-result-header";
    header.innerHTML = `<span class="arrow">&#9654;</span> Tool Result${toolId ? ` <span style="opacity:0.5">(${esc(toolId)})</span>` : ""}${isError ? ' <span style="color:var(--red)">[error]</span>' : ""}`;

    const body = document.createElement("div");
    body.className = "tool-result-body";

    const content = block.content;
    if (typeof content === "string") {
        body.textContent = content;
    } else if (Array.isArray(content)) {
        // tool_result content can be array of text blocks
        body.textContent = content
            .map(c => (c.type === "text" ? c.text : JSON.stringify(c, null, 2)))
            .join("\n");
    } else {
        body.textContent = JSON.stringify(content, null, 2);
    }

    header.addEventListener("click", () => {
        header.classList.toggle("expanded");
        body.classList.toggle("open");
    });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
}

// ---------- Parsers ----------

function parseRequestBody(bodyStr) {
    if (!bodyStr) return {};
    try {
        const obj = JSON.parse(bodyStr);
        return {
            system: obj.system || null,
            messages: obj.messages || [],
            tools: obj.tools || null,
        };
    } catch {
        return {};
    }
}

function parseStreamingResponse(sseEvents) {
    if (!sseEvents || sseEvents.length === 0) return [];

    const contentBlocks = [];     // indexed by content_block index
    let currentBlockType = null;

    for (const evt of sseEvents) {
        if (!evt.data) continue;
        let data;
        try { data = JSON.parse(evt.data); } catch { continue; }

        const evtType = evt.eventType || data.type;

        if (evtType === "content_block_start" && data.content_block) {
            const idx = data.index ?? contentBlocks.length;
            contentBlocks[idx] = { ...data.content_block };
            if (contentBlocks[idx].type === "text" && !contentBlocks[idx].text) {
                contentBlocks[idx].text = "";
            }
            if (contentBlocks[idx].type === "tool_use" && !contentBlocks[idx].input) {
                contentBlocks[idx].input = {};
                contentBlocks[idx]._inputJson = "";
            }
            currentBlockType = contentBlocks[idx].type;
        }

        if (evtType === "content_block_delta" && data.delta) {
            const idx = data.index ?? (contentBlocks.length - 1);
            const block = contentBlocks[idx];
            if (!block) continue;

            if (data.delta.type === "text_delta" && data.delta.text) {
                block.text = (block.text || "") + data.delta.text;
            }
            if (data.delta.type === "input_json_delta" && data.delta.partial_json) {
                block._inputJson = (block._inputJson || "") + data.delta.partial_json;
            }
        }

        if (evtType === "content_block_stop") {
            const idx = data.index ?? (contentBlocks.length - 1);
            const block = contentBlocks[idx];
            if (block && block._inputJson) {
                try { block.input = JSON.parse(block._inputJson); } catch { }
                delete block._inputJson;
            }
        }
    }

    // Clean up any remaining _inputJson
    for (const block of contentBlocks) {
        if (block && block._inputJson) {
            try { block.input = JSON.parse(block._inputJson); } catch { }
            delete block._inputJson;
        }
    }

    return contentBlocks.filter(Boolean);
}

function parseNonStreamingResponse(bodyStr) {
    if (!bodyStr) return [];
    try {
        const obj = JSON.parse(bodyStr);
        return obj.content || [];
    } catch {
        // If it's not JSON, return the raw text as a text block
        return bodyStr ? [{ type: "text", text: bodyStr }] : [];
    }
}

// ---------- Details Section ----------

function buildDetailsSection(req) {
    const wrapper = document.createElement("div");
    wrapper.className = "exchange-details";

    const toggle = document.createElement("button");
    toggle.className = "details-toggle";
    toggle.innerHTML = '<span class="arrow">&#9654;</span> Raw Details';

    const content = document.createElement("div");
    content.className = "details-content";

    let initialized = false;

    toggle.addEventListener("click", () => {
        toggle.classList.toggle("expanded");
        content.classList.toggle("open");

        // Lazy render
        if (!initialized) {
            initialized = true;
            renderDetails(content, req);
        }
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(content);
    return wrapper;
}

function renderDetails(container, req) {
    const tabs = ["request", "response", "events", "tokens", "statistics"];
    let activeTab = "request";

    const tabBar = document.createElement("div");
    tabBar.className = "detail-tabs";

    const codeEl = document.createElement("pre");
    codeEl.className = "detail-code";

    function showTab(tab) {
        activeTab = tab;
        tabBar.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));

        switch (tab) {
            case "request": {
                let body = req.requestBody || "";
                try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { }
                codeEl.textContent = body || "(empty)";
                break;
            }
            case "response": {
                if (req.isStreaming && req.sseEvents && req.sseEvents.length > 0) {
                    const lines = req.sseEvents.map(e => {
                        const evtLine = e.eventType ? `event: ${e.eventType}` : "";
                        const dataLine = e.data ? `data: ${e.data}` : "";
                        return [evtLine, dataLine].filter(Boolean).join("\n");
                    });
                    codeEl.textContent = lines.join("\n\n");
                } else {
                    let body = req.responseBody || "";
                    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { }
                    codeEl.textContent = body || "(empty)";
                }
                break;
            }
            case "events": {
                if (!req.sseEvents || req.sseEvents.length === 0) {
                    codeEl.textContent = "(no SSE events)";
                } else {
                    codeEl.textContent = `${req.sseEvents.length} events\n\n` +
                        req.sseEvents.map((e, i) => `#${i} [${e.eventType || "data"}] ${e.data || ""}`).join("\n");
                }
                break;
            }
            case "tokens": {
                const lines = [
                    `Input:          ${formatTokens(req.inputTokens)}`,
                    `Output:         ${formatTokens(req.outputTokens)}`,
                    `Cache Create:   ${formatTokens(req.cacheCreationInputTokens)}`,
                    `Cache Read:     ${formatTokens(req.cacheReadInputTokens)}`,
                    ``,
                    `Duration:       ${formatDuration(req.durationMs)}`,
                    `TTFT:           ${formatDuration(req.timeToFirstTokenMs)}`,
                    `Message ID:     ${req.messageId || "-"}`,
                    `Stop Reason:    ${req.stopReason || "-"}`,
                ];
                codeEl.textContent = lines.join("\n");
                break;
            }
            case "statistics": {
                codeEl.textContent = buildStatisticsText(req);
                break;
            }
        }
    }

    for (const tab of tabs) {
        const btn = document.createElement("button");
        btn.dataset.tab = tab;
        btn.textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
        btn.addEventListener("click", () => showTab(tab));
        tabBar.appendChild(btn);
    }

    container.appendChild(tabBar);
    container.appendChild(codeEl);
    showTab("request");
}

// ---------- Statistics ----------

function computeCharCounts(req) {
    const parsed = parseRequestBody(req.requestBody);

    // System prompt chars
    let systemChars = 0;
    if (parsed.system) {
        if (typeof parsed.system === "string") {
            systemChars = parsed.system.length;
        } else if (Array.isArray(parsed.system)) {
            for (const block of parsed.system) {
                if (block.type === "text" && block.text) systemChars += block.text.length;
                else systemChars += JSON.stringify(block).length;
            }
        } else {
            systemChars = JSON.stringify(parsed.system).length;
        }
    }

    // Tools chars
    const toolsChars = parsed.tools ? JSON.stringify(parsed.tools).length : 0;

    // Message history chars (all messages)
    const messagesChars = parsed.messages
        ? estimateMessagesCharCount(parsed.messages)
        : 0;

    const totalInputChars = systemChars + toolsChars + messagesChars;

    // Output chars from response content blocks
    let outputChars = 0;
    const responseContent = req.isStreaming
        ? parseStreamingResponse(req.sseEvents)
        : parseNonStreamingResponse(req.responseBody);
    if (responseContent) {
        for (const block of responseContent) {
            if (block.text) outputChars += block.text.length;
            if (block.input) outputChars += JSON.stringify(block.input).length;
        }
    }

    return { systemChars, toolsChars, messagesChars, totalInputChars, outputChars };
}

function buildStatisticsText(req) {
    const cc = computeCharCounts(req);

    const inputTok = req.inputTokens || 0;
    const outputTok = req.outputTokens || 0;
    const cacheWriteTok = req.cacheCreationInputTokens || 0;
    const cacheReadTok = req.cacheReadInputTokens || 0;
    const totalInputTok = inputTok + cacheWriteTok + cacheReadTok;

    const inputRatio = totalInputTok > 0 ? (cc.totalInputChars / totalInputTok).toFixed(1) : "-";
    const outputRatio = outputTok > 0 ? (cc.outputChars / outputTok).toFixed(1) : "-";

    const lines = [
        `TOKEN / CHARACTER ANALYSIS`,
        `${"=".repeat(50)}`,
        ``,
        `INPUT CONTEXT`,
        `  Total tokens:       ${formatTokens(totalInputTok)} tok`,
        `    New (uncached):   ${formatTokens(inputTok)} tok`,
        `    Cache write:      ${formatTokens(cacheWriteTok)} tok`,
        `    Cache read:       ${formatTokens(cacheReadTok)} tok`,
        `  Total chars:        ~${formatCharCount(cc.totalInputChars)}`,
        `    System prompt:    ~${formatCharCount(cc.systemChars)}`,
        `    Tools:            ~${formatCharCount(cc.toolsChars)}`,
        `    Messages:         ~${formatCharCount(cc.messagesChars)}`,
        `  Ratio:              ~${inputRatio} chars/tok`,
        ``,
        `OUTPUT`,
        `  Tokens:             ${formatTokens(outputTok)} tok`,
        `  Chars:              ~${formatCharCount(cc.outputChars)}`,
        `  Ratio:              ~${outputRatio} chars/tok`,
        ``,
        `${"─".repeat(50)}`,
        `Note: char counts are approximate (measured from`,
        `JSON content, not the tokenizer input). Typical`,
        `English text averages ~3.5-4 chars/tok; code and`,
        `structured data may differ.`,
    ];

    return lines.join("\n");
}

// ---------- Copy JSON ----------

function copyExchangeJson(req, btn) {
    let requestBody = null;
    try { requestBody = JSON.parse(req.requestBody); } catch { requestBody = req.requestBody || null; }

    let responseBody = null;
    if (req.isStreaming && req.sseEvents && req.sseEvents.length > 0) {
        responseBody = req.sseEvents.map(e => {
            try { return JSON.parse(e.data); } catch { return e.data; }
        });
    } else {
        try { responseBody = JSON.parse(req.responseBody); } catch { responseBody = req.responseBody || null; }
    }

    const json = JSON.stringify({ request: requestBody, response: responseBody }, null, 2);

    navigator.clipboard.writeText(json).then(() => {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
            btn.textContent = "Copy JSON";
            btn.classList.remove("copied");
        }, 1500);
    });
}

// ---------- Helpers ----------

function autoScroll() {
    requestAnimationFrame(() => {
        feed.scrollTop = feed.scrollHeight;
    });
}

function updateCount() {
    const label = requests.length === 1 ? "exchange" : "exchanges";
    requestCount.textContent = `${requests.length} ${label}` +
        (hookEvents.length > 0 ? `, ${hookEvents.length} hook${hookEvents.length === 1 ? "" : "s"}` : "");
}

// ---------- Hook Event Cards ----------

function hookEventContext(evt) {
    const input = evt.hookInput || {};
    switch ((evt.hookEventName || "").toLowerCase()) {
        case "pretooluse":
        case "posttooluse":
        case "posttoolusefailure":  return input.tool_name  ? { label: "tool",   value: input.tool_name }         : null;
        case "sessionstart":        return input.source     ? { label: "source", value: input.source }             : null;
        case "sessionend":          return input.reason     ? { label: "reason", value: input.reason }             : null;
        case "subagentstart":
        case "subagentstopp":       return input.agent_type ? { label: "agent",  value: input.agent_type }         : null;
        case "notification":        return input.notification_type ? { label: "type", value: input.notification_type } : null;
        default:                    return null;
    }
}

function buildHookEventElement(evt) {
    const el = document.createElement("div");
    el.className = "hook-event";
    el.dataset.id = evt.id;
    el.dataset.timestamp = new Date(evt.timestamp).getTime();

    const context = hookEventContext(evt);
    const header = document.createElement("div");
    header.className = "hook-event-header expanded";
    header.innerHTML = `
        <span class="hook-badge hook-badge-${esc((evt.hookEventName || "").toLowerCase())}">${esc(evt.hookEventName)}</span>
        <span class="hook-meta">${esc(formatTime(evt.timestamp))}${context ? " | " + esc(context.label) + ": " + esc(context.value) : ""}</span>
    `;

    const body = document.createElement("div");
    body.className = "hook-event-body open";
    renderHookEventBody(body, evt);

    header.addEventListener("click", () => {
        header.classList.toggle("expanded");
        body.classList.toggle("open");
    });

    el.appendChild(header);
    el.appendChild(body);
    return el;
}

function renderHookEventBody(container, evt) {
    // Key-value field grid (stdout handled separately below)
    const fields = [
        ["Event", evt.hookEventName], ["Session", evt.sessionId],
        ["CWD", evt.cwd], ["Permission", evt.permissionMode],
        ["Transcript", evt.transcriptPath], ["Exit Code", String(evt.exitCode)],
    ].filter(([, v]) => v != null && v !== "" && v !== "0");

    if (fields.length > 0) {
        const dl = document.createElement("dl");
        dl.className = "hook-field-grid";
        for (const [key, val] of fields) {
            const dt = document.createElement("dt");
            dt.textContent = key;
            const dd = document.createElement("dd");
            dd.textContent = val;
            dl.appendChild(dt);
            dl.appendChild(dd);
        }
        container.appendChild(dl);
    }

    // Stdout — rendered as a distinct terminal-style output box
    if (evt.stdout && evt.stdout.trim()) {
        const stdoutWrapper = document.createElement("div");
        stdoutWrapper.className = "hook-stdout";
        const label = document.createElement("span");
        label.className = "hook-stdout-label";
        label.textContent = "Stdout";
        const pre = document.createElement("pre");
        pre.className = "hook-stdout-value";
        pre.textContent = evt.stdout.trim();
        stdoutWrapper.appendChild(label);
        stdoutWrapper.appendChild(pre);
        container.appendChild(stdoutWrapper);
    }

    // Collapsible: Environment Variables
    const envEntries = Object.entries(evt.environmentVariables || {});
    if (envEntries.length > 0) {
        const envToggle = document.createElement("button");
        envToggle.className = "collapse-toggle";
        envToggle.innerHTML = `<span class="arrow">&#9654;</span> Environment Variables (${envEntries.length})`;
        const envContent = document.createElement("div");
        envContent.className = "collapsible-content";
        const envDl = document.createElement("dl");
        envDl.className = "hook-field-grid";
        for (const [k, v] of envEntries) {
            const dt = document.createElement("dt");
            dt.textContent = k;
            const dd = document.createElement("dd");
            dd.textContent = v;
            envDl.appendChild(dt);
            envDl.appendChild(dd);
        }
        envContent.appendChild(envDl);
        envToggle.addEventListener("click", () => {
            envToggle.classList.toggle("expanded");
            envContent.classList.toggle("open");
        });
        container.appendChild(envToggle);
        container.appendChild(envContent);
    }

    // Collapsible: Raw Hook Input
    if (evt.hookInput != null) {
        const rawToggle = document.createElement("button");
        rawToggle.className = "collapse-toggle";
        rawToggle.innerHTML = `<span class="arrow">&#9654;</span> Raw Hook Input`;
        const rawContent = document.createElement("div");
        rawContent.className = "collapsible-content";
        const pre = document.createElement("pre");
        pre.className = "detail-code";
        pre.textContent = JSON.stringify(evt.hookInput, null, 2);
        rawContent.appendChild(pre);
        rawToggle.addEventListener("click", () => {
            rawToggle.classList.toggle("expanded");
            rawContent.classList.toggle("open");
        });
        container.appendChild(rawToggle);
        container.appendChild(rawContent);
    }
}

function formatTime(ts) {
    if (!ts) return "-";
    return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

function formatTokens(n) {
    if (n == null) return "-";
    return n.toLocaleString();
}

function formatCharCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M chars";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K chars";
    return n + " chars";
}

function formatDuration(ms) {
    if (ms == null) return "-";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function statusCls(code) {
    if (!code) return "";
    if (code >= 200 && code < 300) return "status-ok";
    return "status-err";
}

function esc(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
}
