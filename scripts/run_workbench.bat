@echo off
title FTSK Site Workbench
cd /d "%~dp0"

if exist "%~dp0..\.venv\Scripts\python.exe" (
    "%~dp0..\.venv\Scripts\python.exe" site_workbench.py %*
    goto :eof
)

echo The project Python environment is missing.
echo Run scripts\setup-dev-env.ps1 from the repository root first.
pause
