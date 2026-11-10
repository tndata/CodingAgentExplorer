# Send Claude Code's API traffic through CodingAgentExplorer's proxy (port 8888),
# so it shows up in the dashboard.
# Run it as .\EnableProxy.ps1 in PowerShell. (EnableProxy.bat does not work from PowerShell:
# it runs in a separate cmd process, so the variables are lost when it ends.)
$env:ANTHROPIC_BASE_URL = "http://localhost:8888"

# Make Claude Code add x-claude-code-* hint headers (request class, agent type, prompt id),
# so main-agent and subagent requests can be told apart.
$env:CLAUDE_CODE_GATEWAY_HINT_HEADERS = "1"
