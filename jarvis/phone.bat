@echo off
rem Jarvis on the phone — starts the bridge (and its Cloudflare tunnel). Keep this window open.
cd /d "%~dp0.."
set "PATH=%USERPROFILE%\.local\bin;%ProgramFiles(x86)%\cloudflared;%ProgramFiles%\cloudflared;%PATH%"
where cloudflared >nul 2>nul || winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements --silent
set "PATH=%ProgramFiles(x86)%\cloudflared;%ProgramFiles%\cloudflared;%PATH%"
python jarvis\bridge.py
pause
