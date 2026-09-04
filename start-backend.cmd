@echo off
cd /d "%~dp0"
docker compose -f compose.yml up -d --build
docker compose -f compose.yml ps
