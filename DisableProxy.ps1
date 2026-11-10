# Clear the variables set by EnableProxy.ps1 in this PowerShell session.
Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_GATEWAY_HINT_HEADERS -ErrorAction SilentlyContinue
