# Must be sourced ("source EnableProxy.sh"), not run. Run as ./EnableProxy.sh or bash EnableProxy.sh,
# it sets the variables in a child shell that exits at once, and Claude Code bypasses the proxy.
if ! (return 0 2>/dev/null); then
    echo "EnableProxy.sh must be sourced, not run. Use:  source EnableProxy.sh" >&2
    exit 1
fi

# Send Claude Code's API traffic through CodingAgentExplorer's proxy (port 8888), so it shows up in the dashboard.
export ANTHROPIC_BASE_URL=http://localhost:8888

# Make Claude Code add x-claude-code-* hint headers (request class, agent type, prompt id), so main-agent and subagent requests can be told apart.
export CLAUDE_CODE_GATEWAY_HINT_HEADERS=1
