@echo off
setlocal
cd /d "%~dp0"
if not exist "repository\downloads" mkdir "repository\downloads"
for %%F in (launcher-src\dist\*.exe launcher-src\dist\*.AppImage launcher-src\dist\latest*.yml launcher-src\dist\*.blockmap) do (
  if exist "%%F" copy /y "%%F" "repository\downloads\" >nul
)
for %%F in (launcher-src\dist-linux\*.AppImage launcher-src\dist-linux\latest*.yml launcher-src\dist-linux\*.blockmap) do (
  if exist "%%F" copy /y "%%F" "repository\downloads\" >nul
)
echo Launcher files published to repository\downloads
