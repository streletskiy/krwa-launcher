@echo off
setlocal
cd /d "%~dp0"
set "KRWA_NODE=%~dp0tools\node-v22.23.2-win-x64\node.exe"
if not exist "%KRWA_NODE%" (
  echo Node.js not found: %KRWA_NODE%
  exit /b 1
)
for /f "delims=" %%V in ('%KRWA_NODE% -p "require('./launcher-src/package.json').version"') do set "KRWA_VERSION=%%V"
if not defined KRWA_VERSION (
  echo Unable to read launcher version.
  exit /b 1
)
for %%M in ("launcher-src\dist\latest.yml" "launcher-src\dist-linux\latest-linux.yml" "launcher-src\dist-mac\latest-mac.yml") do (
  if not exist "%%~M" (
    echo Missing release manifest: %%~M
    exit /b 1
  )
  findstr /b /c:"version: %KRWA_VERSION%" "%%~M" >nul
  if errorlevel 1 (
    echo Manifest %%~M does not describe launcher %KRWA_VERSION%.
    exit /b 1
  )
)
if /i "%~1"=="--check" (
  echo Launcher %KRWA_VERSION% has complete manifests for Windows, Linux and macOS.
  exit /b 0
)
if not exist "repository\downloads" mkdir "repository\downloads"
for %%F in (launcher-src\dist\*.exe launcher-src\dist\*.AppImage launcher-src\dist\*.blockmap) do (
  if exist "%%F" copy /y "%%F" "repository\downloads\" >nul
)
for %%F in (launcher-src\dist-linux\*.AppImage launcher-src\dist-linux\*.blockmap) do (
  if exist "%%F" copy /y "%%F" "repository\downloads\" >nul
)
for %%F in (launcher-src\dist-mac\*.dmg launcher-src\dist-mac\*.zip launcher-src\dist-mac\*.blockmap) do (
  if exist "%%F" copy /y "%%F" "repository\downloads\" >nul
)
rem Publish manifests last so clients never see a release before its artifacts exist.
for %%F in (launcher-src\dist\latest*.yml launcher-src\dist-linux\latest*.yml launcher-src\dist-mac\latest-mac.yml) do (
  if exist "%%F" (
    copy /y "%%F" "repository\downloads\%%~nxF.tmp" >nul
    move /y "repository\downloads\%%~nxF.tmp" "repository\downloads\%%~nxF" >nul
  )
)
echo Launcher files published to repository\downloads
