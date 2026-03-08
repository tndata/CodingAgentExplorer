#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/Published"

# Detect current platform RID
OS=$(uname -s)
ARCH=$(uname -m)

if [ "$OS" = "Darwin" ]; then
    if [ "$ARCH" = "arm64" ]; then
        RID="osx-arm64"
    else
        RID="osx-x64"
    fi
elif [ "$OS" = "Linux" ]; then
    RID="linux-x64"
else
    echo "Unsupported platform: $OS"
    exit 1
fi

echo
echo "=== Publishing CodingAgentExplorer ==="
dotnet publish "$ROOT/CodingAgentExplorer/CodingAgentExplorer.csproj" \
    -c Release \
    -o "$OUT/CodingAgentExplorer"

echo
echo "=== Publishing HookAgent ($RID, single-file) ==="
dotnet publish "$ROOT/HookAgent/HookAgent.csproj" \
    -c Release \
    -r "$RID" \
    -p:PublishSingleFile=true \
    --self-contained false \
    -o "$OUT/HookAgent"

echo
echo "Done. Output in: $OUT"
echo
echo "  CodingAgentExplorer : $OUT/CodingAgentExplorer/"
echo "  HookAgent           : $OUT/HookAgent/HookAgent  (single file, $RID)"
echo
echo "Both require the .NET 10 runtime on the target machine."
echo "Add $OUT/HookAgent to your PATH to use HookAgent as a Claude Code hook command."
