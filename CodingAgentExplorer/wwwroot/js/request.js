// Request Inspector: shows one captured request body as a collapsible JSON tree.
// Opened from the HTTP Inspector (Request tab, "Tree view") as /request/index.html?id=<request id>.
// It reads the request from the hub's history, like the Inspector, and adds no endpoint of its own.
// Line numbers are those of the body printed with two-space indentation, so a collapsed
// node shows how many lines it hides by the jump in the numbers.

const reqInfo = document.getElementById("reqInfo");
const treeEl = document.getElementById("tree");
const expandAllBtn = document.getElementById("expandAllBtn");
const collapseAllBtn = document.getElementById("collapseAllBtn");

const LONG_STRING = 100; // strings longer than this (as JSON) are cut to one line until clicked

const id = new URLSearchParams(location.search).get("id");

let root = null;      // model of the parsed body
let lnWidth = 1;      // digits in the largest line number

if (!id) {
    showError("No request selected. Open this page from the HTTP Inspector: select a request, open the Request tab and click \"Tree view\".");
} else {
    const connection = new signalR.HubConnectionBuilder()
        .withUrl("/hub")
        .withAutomaticReconnect()
        .build();

    connection.on("History", history => {
        const req = history.find(r => r.id === id);
        if (req) show(req);
        else showError(`Request ${id} was not found. It may have been cleared, or the app was restarted.`);
        connection.stop();
    });

    try {
        await connection.start();
    } catch (err) {
        console.error("SignalR connection error:", err);
        showError("Could not connect to Coding Agent Explorer. Is the app running?");
    }
}

// "Summaries" checkbox: on by default, remembered in this browser.
const summaryToggle = document.getElementById("summaryToggle");
try { summaryToggle.checked = localStorage.getItem("requestSummaries") !== "off"; } catch { }
const applySummaries = () => treeEl.classList.toggle("jt-nosum", !summaryToggle.checked);
applySummaries();
summaryToggle.addEventListener("change", () => {
    applySummaries();
    try { localStorage.setItem("requestSummaries", summaryToggle.checked ? "on" : "off"); } catch { }
});

expandAllBtn.addEventListener("click", () => {
    if (root) setAll(root, true);
});

collapseAllBtn.addEventListener("click", () => {
    if (!root) return;
    setAll(root, false);
    setExpanded(root, true); // back to the start view: only the top-level keys
});

function showError(text) {
    reqInfo.innerHTML = "";
    const span = document.createElement("span");
    span.className = "req-error";
    span.textContent = text;
    reqInfo.appendChild(span);
}

function show(req) {
    const strong = document.createElement("strong");
    strong.textContent = `${req.method} ${req.path}`;
    const rest = [
        req.model,
        new Date(req.timestamp).toLocaleString(),
        `ID ${req.id}`
    ].filter(Boolean).join("  ·  ");
    reqInfo.innerHTML = "";
    reqInfo.append(strong, document.createTextNode(`  ·  ${rest}`));
    document.title = `Coding Agent Explorer - Request ${req.id}`;

    let body;
    try {
        body = JSON.parse(req.requestBody);
    } catch {
        const pre = document.createElement("div");
        pre.className = "jt-raw";
        pre.textContent = req.requestBody || "(empty body)";
        treeEl.appendChild(pre);
        return;
    }

    root = buildModel(body, null, 1, 0, true);
    lnWidth = String(root.lines).length;
    treeEl.appendChild(renderNode(root));
    setExpanded(root, true);
    expandAllBtn.disabled = false;
    collapseAllBtn.disabled = false;
}

// Model: one entry per value, with its first line number and the number of lines it takes
// when printed with JSON.stringify(value, null, 2).
function buildModel(value, key, line, depth, last) {
    const node = { key, value, line, depth, last, lines: 1, children: null, el: null, rendered: false };
    const isArr = Array.isArray(value);
    if (value !== null && typeof value === "object") {
        const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
        if (entries.length > 0) {
            node.children = [];
            let next = line + 1;
            entries.forEach(([k, v], i) => {
                const child = buildModel(v, isArr ? null : k, next, depth + 1, i === entries.length - 1);
                node.children.push(child);
                next += child.lines;
            });
            node.lines = next - line + 1; // children plus the opening and closing lines
            node.isArr = isArr;
        }
    }
    return node;
}

function span(cls, text) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    return s;
}

function line(number, depth) {
    const row = document.createElement("div");
    row.className = "jt-line";
    const ln = span("jt-ln", String(number));
    ln.style.width = `calc(${lnWidth}ch + 20px)`;
    const code = document.createElement("span");
    code.className = "jt-code";
    code.style.paddingLeft = `${depth * 2 + 2}ch`;
    row.append(ln, code);
    return { row, code };
}

function keyPart(code, node) {
    if (node.key !== null) {
        code.append(span("jt-key", JSON.stringify(node.key)), span("jt-punct", ": "));
    }
}

function renderNode(node) {
    const comma = node.last ? "" : ",";

    if (!node.children) {
        const { row, code } = line(node.line, node.depth);
        keyPart(code, node);
        code.append(valueSpan(node.value), span("jt-punct", comma));
        if (typeof node.value === "string" && JSON.stringify(node.value).length > LONG_STRING) {
            row.classList.add("jt-long");
            row.title = "Click to show or hide the whole string";
            row.addEventListener("click", () => row.classList.toggle("jt-wrapped"));
        }
        return row;
    }

    const open = node.isArr ? "[" : "{";
    const close = node.isArr ? "]" : "}";

    const el = document.createElement("div");
    el.className = "jt-node jt-collapsed";
    node.el = el;

    const head = line(node.line, node.depth);
    head.row.classList.add("jt-head");
    head.row.tabIndex = 0;
    head.code.append(span("jt-arrow", "▸"));
    keyPart(head.code, node);
    const ph = span("jt-ph", "");
    ph.append(span("jt-ph-plain", `${open}...${close}`));
    const summary = node.isArr ? null : summarize(node.value);
    if (summary) {
        const sum = span("jt-ph-sum", "");
        sum.append(span("jt-punct", `${open} `), ...summary, span("jt-punct", ` ${close}`));
        ph.append(sum);
        ph.classList.add("jt-has-sum");
    }
    head.code.append(
        span("jt-punct jt-open", open),
        ph,
        span("jt-punct jt-after", comma));
    head.row.addEventListener("click", () => setExpanded(node, el.classList.contains("jt-collapsed")));
    head.row.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(node, el.classList.contains("jt-collapsed"));
        }
    });

    const children = document.createElement("div");
    children.className = "jt-children";

    const tail = line(node.line + node.lines - 1, node.depth);
    tail.row.classList.add("jt-close");
    tail.code.append(span("jt-punct", close + comma));

    el.append(head.row, children, tail.row);
    return el;
}

// Summary shown inside a collapsed object's placeholder (when "Summaries" is on):
// a tool shows its name, a message its role and the start of its text, a content
// or system block its type and the start of its text, other objects their type.
const SNIPPET = 40;

function summarize(obj) {
    const parts = [];
    const add = (cls, text) => {
        if (parts.length) parts.push(span("jt-punct", ", "));
        parts.push(span(cls, text));
    };
    if (typeof obj.role === "string") add("jt-sum-label", `role: ${obj.role}`);
    if (typeof obj.type === "string" && typeof obj.role !== "string") add("jt-sum-label", obj.type);
    if (typeof obj.name === "string") {
        add("jt-sum-name", obj.name);
    } else {
        const text = firstText(obj, 0);
        if (text) {
            const json = JSON.stringify(text);
            add("jt-str", json.length > SNIPPET + 2 ? json.slice(0, SNIPPET + 1) + '..."' : json);
        } else if (Array.isArray(obj.content)) {
            // No text anywhere (for example thinking + tool_use): name the first block that says what happens.
            const block = obj.content.find(b => b && typeof b.name === "string")
                ?? obj.content.find(b => b && typeof b.type === "string");
            if (block) add("jt-sum-label", block.name ? `${block.type}: ${block.name}` : block.type);
        }
    }
    return parts.length ? parts : null;
}

function firstText(value, depth) {
    if (typeof value === "string") return value;
    if (depth > 6 || value === null || typeof value !== "object") return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const t = firstText(item, depth + 1);
            if (t) return t;
        }
        return null;
    }
    for (const key of ["text", "content", "thinking"]) {
        if (key in value) {
            const t = firstText(value[key], depth + 1);
            if (t) return t;
        }
    }
    return null;
}

function valueSpan(value) {
    if (value === null) return span("jt-null", "null");
    if (Array.isArray(value)) return span("jt-punct", "[]");
    switch (typeof value) {
        case "string": return span("jt-str", JSON.stringify(value));
        case "number": return span("jt-num", String(value));
        case "boolean": return span("jt-bool", String(value));
        case "object": return span("jt-punct", "{}");
        default: return span("jt-punct", String(value));
    }
}

// Children are only built the first time a node is opened, so a large body loads at once.
function ensureChildren(node) {
    if (node.rendered) return;
    const container = node.el.querySelector(":scope > .jt-children");
    const fragment = document.createDocumentFragment();
    for (const child of node.children) fragment.appendChild(renderNode(child));
    container.appendChild(fragment);
    node.rendered = true;
}

function setExpanded(node, expanded) {
    if (!node.children) return;
    if (expanded) ensureChildren(node);
    node.el.classList.toggle("jt-collapsed", !expanded);
    node.el.querySelector(":scope > .jt-head .jt-arrow").textContent = expanded ? "▾" : "▸";
}

function setAll(node, expanded) {
    if (!node.children) return;
    if (expanded) ensureChildren(node);
    else if (!node.rendered) return; // never opened, so nothing below it is open either
    setExpanded(node, expanded);
    for (const child of node.children) setAll(child, expanded);
}
