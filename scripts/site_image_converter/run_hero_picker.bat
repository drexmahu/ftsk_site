@echo off
title FTSK Hero Focus Picker
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py hero_config_server.py
    goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
    python hero_config_server.py
    goto :eof
)

echo Python was not found. Run install_dependencies.bat first.
pause
