@echo off
cd /d "%~dp0"
docker compose -f compose.yml logs -f --tail=100
