@echo off
setlocal
title FTSK - Install or repair Workbench
cd /d "%~dp0"
echo FTSK Workbench setup - Windows 10 / 11
echo This installs missing tools and repairs project dependencies.
echo No administrator window is required.
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-dev-env.ps1" %*
set "SETUP_EXIT=%ERRORLEVEL%"
echo.
if not "%SETUP_EXIT%"=="0" goto :failed
echo Setup completed. You can now open site_editor.bat.
goto :finished
:failed
echo Setup did not complete. Read the component errors above.
echo If available, share .tools\setup.log and .tools\setup-report.json with the maintainer.
echo Then run this installer again; completed components are reused.
:finished
echo.
pause
exit /b %SETUP_EXIT%
