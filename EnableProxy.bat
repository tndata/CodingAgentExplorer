rem Send Claude Code's API traffic through CodingAgentExplorer's proxy (port 8888),
rem so it shows up in the dashboard.
set ANTHROPIC_BASE_URL=http://localhost:8888

rem Make Claude Code add x-claude-code-* hint headers (request class, agent type, prompt id), 
rem so main-agent and subagent requests can be told apart.
set CLAUDE_CODE_GATEWAY_HINT_HEADERS=1
