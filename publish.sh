#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/Published"

echo
echo "=== Publishing CodingAgentExplorer ==="
dotnet publish "$ROOT/CodingAgentExplorer/CodingAgentExplorer.csproj" \
    -c Release \
    -o "$OUT/CodingAgentExplorer"

for RID in win-x64 linux-x64 osx-arm64 osx-x64; do
    echo
    echo "=== Publishing HookAgent ($RID, single-file) ==="
    dotnet publish "$ROOT/HookAgent/HookAgent.csproj" \
        -c Release \
        -r "$RID" \
        -p:PublishSingleFile=true \
        --self-contained false \
        -o "$OUT/HookAgent-$RID"
done

echo
echo "Done. Output in: $OUT"
echo
echo "  CodingAgentExplorer  : $OUT/CodingAgentExplorer/"
echo "  HookAgent (win-x64)  : $OUT/HookAgent-win-x64/HookAgent.exe"
echo "  HookAgent (linux-x64): $OUT/HookAgent-linux-x64/HookAgent"
echo "  HookAgent (osx-arm64): $OUT/HookAgent-osx-arm64/HookAgent"
echo "  HookAgent (osx-x64)  : $OUT/HookAgent-osx-x64/HookAgent"
echo
echo "All require the .NET 10 runtime on the target machine."
echo "Add the appropriate HookAgent directory to your PATH to use HookAgent as a Claude Code hook command."
