@echo off
setlocal

rem Builds the demo folder C:\Conf from the latest build and the files in this repo.
rem Nothing is deleted: C:\Conf must be missing or empty, so clear it yourself before a rerun.

rem Run this from the repo root.
set "TARGET=C:\Conf"

if exist "%TARGET%" (
    dir /a /b "%TARGET%" 2>nul | findstr "^" >nul
    if not errorlevel 1 (
        echo *** %TARGET% already exists and is not empty. Clear it first, then run this again.
        goto :fail
    )
)

echo.
echo === Building ===
call publish.bat
if errorlevel 1 goto :fail

echo.
echo === Creating %TARGET% ===
mkdir "%TARGET%\.claude" 2>nul
mkdir "%TARGET%\HookAgent" 2>nul
if not exist "%TARGET%\HookAgent" goto :fail

copy /y "EnableProxy.bat" "%TARGET%\" >nul
copy /y "HookAgent\Sample-Settings-Windows\settings.json" "%TARGET%\.claude\" >nul
xcopy /e /i /q /y "DemoFolder\skills" "%TARGET%\.claude\skills" >nul
copy /y "Published\HookAgent\HookAgent.exe" "%TARGET%\HookAgent\" >nul
copy /y "Published\HookAgent\HookAgent.pdb" "%TARGET%\HookAgent\" >nul
if errorlevel 1 goto :fail

echo.
echo Done. %TARGET% now contains:
echo.
dir /s /b /a-d "%TARGET%"
echo.
echo Next: open a command prompt in %TARGET%, run EnableProxy.bat, then start claude.
goto :eof

:fail
echo.
echo *** Setup failed (see errors above) ***
exit /b 1
