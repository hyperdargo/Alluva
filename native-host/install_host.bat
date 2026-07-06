@echo off
setlocal enabledelayedexpansion

:: Check if extension ID is provided
set EXT_ID=%1
if "%EXT_ID%"=="" (
    echo [Stream Vault Host Installer] No Extension ID provided. 
    echo Usage: install_host.bat EXTENSION_ID
    echo Example: install_host.bat ihpiinojhnfhpdmmacgmpoonphhimkaj
    exit /b 1
)

:: Get current folder path and escape backslashes for JSON
set HOST_PATH=%~dp0run_host.bat
set ESCAPED_PATH=!HOST_PATH:\=\\!

:: Write manifest JSON file
(
echo {
echo   "name": "com.streamvault.launcher",
echo   "description": "Stream Vault Native Launcher",
echo   "path": "!ESCAPED_PATH!",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://!EXT_ID!/"
echo   ]
echo }
) > "%~dp0com.streamvault.launcher.json"

echo [Stream Vault Host Installer] Created host manifest: com.streamvault.launcher.json

:: Register host manifest in Windows Registry for Chrome and Edge
set REG_PATH_CHROME=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.streamvault.launcher
set REG_PATH_EDGE=HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.streamvault.launcher

reg add "%REG_PATH_CHROME%" /ve /t REG_SZ /d "%~dp0com.streamvault.launcher.json" /f >nul
if %errorlevel% neq 0 (
    echo [Stream Vault Host Installer] ERROR: Failed to register with Google Chrome registry keys.
    exit /b 1
)
echo [Stream Vault Host Installer] Successfully registered with Google Chrome.

reg add "%REG_PATH_EDGE%" /ve /t REG_SZ /d "%~dp0com.streamvault.launcher.json" /f >nul
if %errorlevel% neq 0 (
    echo [Stream Vault Host Installer] Edge registration failed.
) else (
    echo [Stream Vault Host Installer] Successfully registered with Microsoft Edge.
)

echo [Stream Vault Host Installer] Installation completed successfully!
