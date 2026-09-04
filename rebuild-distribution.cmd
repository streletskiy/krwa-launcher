@echo off
setlocal
cd /d "%~dp0nebula-src"
set "KRWA_NODE=%~dp0tools\node-v22.23.2-win-x64\node.exe"
if not exist "%KRWA_NODE%" (
  echo Node.js not found: %KRWA_NODE%
  exit /b 1
)
"%KRWA_NODE%" ".\node_modules\typescript\bin\tsc"
if errorlevel 1 exit /b %errorlevel%
"%KRWA_NODE%" ".\dist\index.js" generate distro
exit /b %errorlevel%

