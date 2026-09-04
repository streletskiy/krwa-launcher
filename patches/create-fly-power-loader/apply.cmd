@echo off
setlocal
if "%~1"=="" (
  echo Usage: apply.cmd path\to\create-fly-power-loader-fabric-26.2-1.0.0.jar
  exit /b 1
)
"%~dp0..\..\tools\node-v22.23.2-win-x64\node.exe" -e "const fs=require('fs'); const AdmZip=require(process.argv[3]); const zip=new AdmZip(process.argv[1]); zip.updateFile('fabric.mod.json', fs.readFileSync(process.argv[2])); zip.writeZip(process.argv[1]);" "%~f1" "%~dp0fabric.mod.json" "%~dp0..\..\launcher-src\node_modules\adm-zip"
exit /b %errorlevel%

