@echo off
setlocal
cd /d "%~dp0launcher-src"
set "KRWA_NODE=%~dp0tools\node-v22.23.2-win-x64\node.exe"
set "KRWA_BUILDER=.\node_modules\electron-builder\out\cli\cli.js"
set "KRWA_RCEDIT=%~dp0tools\rcedit-x64.exe"
if not exist "%KRWA_NODE%" (
  echo Node.js not found: %KRWA_NODE%
  exit /b 1
)
if not exist "%KRWA_RCEDIT%" (
  echo rcedit not found: %KRWA_RCEDIT%
  exit /b 1
)
"%KRWA_NODE%" "%KRWA_BUILDER%" --win --dir
if errorlevel 1 exit /b %errorlevel%
"%KRWA_RCEDIT%" ".\dist\win-unpacked\KRWA Launcher.exe" --set-icon ".\build\icon.ico" --set-file-version "0.1.0" --set-product-version "0.1.0" --set-version-string ProductName "KRWA Launcher" --set-version-string FileDescription "KRWA Minecraft Launcher" --set-version-string CompanyName "KRWA Server"
if errorlevel 1 exit /b %errorlevel%
"%KRWA_NODE%" "%KRWA_BUILDER%" --win nsis --prepackaged ".\dist\win-unpacked"
if errorlevel 1 exit /b %errorlevel%
cd /d "%~dp0"
docker run --rm -v "%~dp0launcher-src:/project" -v krwa_launcher_node_modules:/project/node_modules -w /project electronuserland/builder:22 bash -lc "npm ci && npx electron-builder --linux AppImage --config.directories.output=dist-linux"
exit /b %errorlevel%
