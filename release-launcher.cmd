@echo off
setlocal
if "%~1"=="" (
  echo Usage: release-launcher.cmd VERSION
  echo Example: release-launcher.cmd 0.1.2
  exit /b 2
)
set "KRWA_NODE_DIR=%~dp0tools\node-v22.23.2-win-x64"
if not exist "%KRWA_NODE_DIR%\npm.cmd" (
  echo npm not found: %KRWA_NODE_DIR%\npm.cmd
  exit /b 1
)
cd /d "%~dp0launcher-src"
call "%KRWA_NODE_DIR%\npm.cmd" version "%~1" --no-git-tag-version
if errorlevel 1 exit /b %errorlevel%
cd /d "%~dp0"
call build-launcher.cmd
if errorlevel 1 exit /b %errorlevel%
echo Windows and Linux %~1 are ready.
echo Commit and push the version, run the macOS workflow, download its artifact to launcher-src\dist-mac,
echo then publish all three platforms together with publish-launcher.cmd.
exit /b 0
