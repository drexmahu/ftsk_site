@echo off
title FTSK Social Card Preview
cd /d "%~dp0.."

if exist "%~dp0..\.venv\Scripts\python.exe" (
    "%~dp0..\.venv\Scripts\python.exe" -m tools.social_preview %*
    goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
    py -m tools.social_preview %*
    goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
    python -m tools.social_preview %*
    goto :eof
)

echo Python was not found. Run scripts\setup-dev-env.ps1 first.
pause
