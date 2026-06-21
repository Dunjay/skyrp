@echo off
setlocal

:: ============================================================
::  SkyRP service control — one script for start/stop/restart.
::
::    Servers.bat start | stop | restart | status
::
::  No argument defaults to "status". Self-elevates, shows the
::  result, then closes. Replaces Start-/Stop-/Restart-Servers.bat.
:: ============================================================

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=status"

:: nssm service control needs admin — relaunch elevated, keeping the action.
net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%ACTION%' -Verb RunAs"
    exit /b
)

set "NSSM=C:\tools\nssm\nssm.exe"
if not exist "%NSSM%" set "NSSM=nssm"

:: Dependency order: nginx -> backend -> game on start; reversed on stop so
:: players drop before the API and web tier go down.
set "FWD=SkyrpNginx SkyrpBackend SkyrpGameServer"
set "REV=SkyrpGameServer SkyrpBackend SkyrpNginx"

if /i "%ACTION%"=="start"   goto :do_start
if /i "%ACTION%"=="stop"    goto :do_stop
if /i "%ACTION%"=="restart" goto :do_restart
if /i "%ACTION%"=="status"  goto :do_status
echo Unknown action "%ACTION%". Use: start ^| stop ^| restart ^| status
goto :end

:do_stop
echo === Stopping SkyRP services ===
for %%S in (%REV%) do ( echo -- %%S & "%NSSM%" stop %%S 2>&1 )
:: nginx workers sometimes outlive the service process
taskkill /f /im nginx.exe >nul 2>&1
goto :do_status

:do_start
echo === Starting SkyRP services ===
for %%S in (%FWD%) do ( echo -- %%S & "%NSSM%" start %%S 2>&1 )
goto :do_status

:do_restart
echo === Stopping SkyRP services ===
for %%S in (%REV%) do ( echo -- %%S & "%NSSM%" stop %%S 2>&1 )
taskkill /f /im nginx.exe >nul 2>&1
echo.
echo Waiting 3 seconds...
timeout /t 3 /nobreak >nul
echo.
echo === Starting SkyRP services ===
for %%S in (%FWD%) do ( echo -- %%S & "%NSSM%" start %%S 2>&1 )
goto :do_status

:do_status
echo.
echo === Status ===
for %%S in (%FWD%) do ( <nul set /p="%%S: " & "%NSSM%" status %%S 2>&1 )
echo.
echo Listening ports (expect 443 web, 4000 api, 4002 dashboard, 7777 game, 7778 relay):
netstat -an | findstr /c:":443 " /c:":4000 " /c:":4002 " /c:":7777 " /c:":7778 " | findstr /c:"LISTENING" /c:"*:*"
echo.
echo NOTE: services auto-start, so they return after a reboot even when stopped.

:end
echo.
echo Closing in 15 seconds (or press a key)...
timeout /t 15 >nul
