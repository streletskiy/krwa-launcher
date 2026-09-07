@echo off
setlocal
cd /d "%~dp0"
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
