@echo off
setlocal
title FTSK Site Workbench
cd /d "%~dp0scripts"

if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" "%~dp0scripts\site_workbench.py" %*
    if errorlevel 1 goto :failed
    exit /b 0
)

echo The project Python environment is missing.
echo Double-click setup-dev-env.bat in the repository's main folder first.
echo Having py or python installed is not enough: setup creates .venv and its packages.
pause
exit /b 1

:failed
set "WORKBENCH_EXIT=%ERRORLEVEL%"
echo.
echo Workbench could not start or stopped with an error. Read the message above.
echo Double-click setup-dev-env.bat in the repository's main folder to check or repair dependencies.
echo If .venv refers to Python that was removed, rename .venv before running setup.
pause
exit /b %WORKBENCH_EXIT%
