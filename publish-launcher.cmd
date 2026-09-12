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
for %%F in (
  "launcher-src\dist\KRWA-Launcher-setup-%KRWA_VERSION%.exe"
  "launcher-src\dist\KRWA-Launcher-setup-%KRWA_VERSION%.exe.blockmap"
  "launcher-src\dist-linux\KRWA-Launcher-%KRWA_VERSION%-x86_64.AppImage"
  "launcher-src\dist-mac\KRWA-Launcher-%KRWA_VERSION%-mac-universal.dmg"
  "launcher-src\dist-mac\KRWA-Launcher-%KRWA_VERSION%-mac-universal.dmg.blockmap"
  "launcher-src\dist-mac\KRWA-Launcher-%KRWA_VERSION%-mac-universal.zip"
  "launcher-src\dist-mac\KRWA-Launcher-%KRWA_VERSION%-mac-universal.zip.blockmap"
) do (
  if not exist "%%~F" (
    echo Missing release artifact: %%~F
    exit /b 1
  )
)
if /i "%~1"=="--check" (
  echo Launcher %KRWA_VERSION% has complete manifests and artifacts for Windows, Linux and macOS.
  exit /b 0
)
if not exist "repository\downloads" mkdir "repository\downloads"
for %%F in (
  "launcher-src\dist\KRWA-Launcher-setup-%KRWA_VERSION%.exe"
  "launcher-src\dist\KRWA-Launcher-setup-%KRWA_VERSION%.exe.blockmap"
  "launcher-src\dist-linux\KRWA-Launcher-%KRWA_VERSION%-x86_64.AppImage"
  "launcher-src\dist-mac\KRWA-Launcher-%KRWA_VERSION%-mac-universal.dmg"
  "launcher-src\dist-mac\KRWA-Launcher-%KRWA_VERSION%-mac-universal.dmg.blockmap"
  "launcher-src\dist-mac\KRWA-Launcher-%KRWA_VERSION%-mac-universal.zip"
  "launcher-src\dist-mac\KRWA-Launcher-%KRWA_VERSION%-mac-universal.zip.blockmap"
) do (
  copy /y "%%~F" "repository\downloads\" >nul
  if errorlevel 1 exit /b 1
)
rem Publish manifests last so clients never see a release before its artifacts exist.
for %%F in ("launcher-src\dist\latest.yml" "launcher-src\dist-linux\latest-linux.yml" "launcher-src\dist-mac\latest-mac.yml") do (
  copy /y "%%~F" "repository\downloads\%%~nxF.tmp" >nul
  if errorlevel 1 exit /b 1
  move /y "repository\downloads\%%~nxF.tmp" "repository\downloads\%%~nxF" >nul
  if errorlevel 1 exit /b 1
)
echo Launcher files published to repository\downloads
