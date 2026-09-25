@echo off
setlocal

title Member Image Web Optimizer - Dependency Installer

echo ============================================================
echo  MEMBER IMAGE WEB OPTIMIZER
echo  Windows Dependency Installer
echo ============================================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON_CMD=py"
    goto :python_found
)

where python >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON_CMD=python"
    goto :python_found
)

echo ERROR: Python was not found.
echo.
echo Please install Python 3 from:
echo https://www.python.org/downloads/
echo.
echo IMPORTANT:
echo Enable "Add Python to PATH" during installation.
echo.
pause
exit /b 1

:python_found

echo Python found:
%PYTHON_CMD% --version
echo.

echo Updating pip...
%PYTHON_CMD% -m pip install --upgrade pip
if errorlevel 1 goto :install_failed

echo.
echo Installing Pillow...
%PYTHON_CMD% -m pip install Pillow
if errorlevel 1 goto :install_failed

echo.
echo Installing OpenCV...
%PYTHON_CMD% -m pip install opencv-python
if errorlevel 1 goto :install_failed

echo.
echo ============================================================
echo  Installation completed successfully.
echo ============================================================
echo.
echo You can now double-click run_gui.bat to start the tool.
echo.
pause
exit /b 0

:install_failed
echo.
echo ============================================================
echo  ERROR: Dependency installation failed.
echo ============================================================
echo.
echo Check your internet connection and Python installation,
echo then run this installer again.
echo.
pause
exit /b 1
