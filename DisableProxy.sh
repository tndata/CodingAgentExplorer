# Must be sourced ("source DisableProxy.sh"), not run, or the variables stay set in your shell.
if ! (return 0 2>/dev/null); then
    echo "DisableProxy.sh must be sourced, not run. Use:  source DisableProxy.sh" >&2
    exit 1
fi

unset ANTHROPIC_BASE_URL
unset CLAUDE_CODE_GATEWAY_HINT_HEADERS
