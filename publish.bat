@echo off
setlocal

set ROOT=%~dp0
set OUT=%ROOT%Published

echo.
echo === Publishing CodingAgentExplorer ===
dotnet publish "%ROOT%CodingAgentExplorer\CodingAgentExplorer.csproj" ^
    -c Release ^
    -o "%OUT%\CodingAgentExplorer"
if errorlevel 1 goto :fail

echo.
echo === Publishing HookAgent (win-x64, single-file) ===
dotnet publish "%ROOT%HookAgent\HookAgent.csproj" ^
    -c Release ^
    -r win-x64 ^
    -p:PublishSingleFile=true ^
    --self-contained false ^
    -o "%OUT%\HookAgent"
if errorlevel 1 goto :fail

echo.
echo Done. Output in: %OUT%
echo.
echo   CodingAgentExplorer : %OUT%\CodingAgentExplorer\
echo   HookAgent           : %OUT%\HookAgent\HookAgent.exe  (single file)
echo.
echo Both require .NET 10 runtime on the target machine.
echo To use HookAgent as a Claude Code hook, copy the HookAgent folder to where you run claude. See the README.
goto :eof

:fail
echo.
echo *** Publish failed (see errors above) ***
exit /b 1
