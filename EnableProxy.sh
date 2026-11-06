# Send Claude Code's API traffic through CodingAgentExplorer's proxy (port 8888), so it shows up in the dashboard.
export ANTHROPIC_BASE_URL=http://localhost:8888

# Make Claude Code add x-claude-code-* hint headers (request class, agent type, prompt id), so main-agent and subagent requests can be told apart.
export CLAUDE_CODE_GATEWAY_HINT_HEADERS=1
