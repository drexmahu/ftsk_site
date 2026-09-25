@echo off
title Site Image Web Optimizer
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py gui.py
    goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
    python gui.py
    goto :eof
)

echo Python was not found. Run install_dependencies.bat first.
pause
