# Источник профиля KRWA Aeronautics

Профиль импортирован из официального CurseForge server/client pack
`All of Create - Aeronautics 2.5` для Minecraft 1.21.1 и NeoForge 21.1.248.

Дополнения KRWA 1.0.2 для Steam Deck (необязательные, выключены по умолчанию):

- [Controlify 3.0.1 LTS](https://www.curseforge.com/minecraft/mc-mods/controlify) — NeoForge 1.21.1, LGPL-3.0-or-later; использует уже включённый YetAnotherConfigLib 3.8.2.
- [Dynamic FPS 3.11.4](https://www.curseforge.com/minecraft/mc-mods/dynamic-fps) — NeoForge 1.21/1.21.1, MIT, только клиент.

Файлы загружаются напрямую через CurseForge API и проверяются по размеру и MD5 из `neoforge-lock.json`.

- `curseforge-manifest.json` фиксирует CurseForge project/file ID каждого мода.
- `neoforge-lock.json` фиксирует URL, размер и MD5 фактически проверенных файлов.
- JAR модов загружаются напрямую с CurseForge; они не зеркалируются в репозитории KRWA.
- `prism-neoforge-21.1.248.json` фиксирует проверенную схему запуска NeoForge через ForgeWrapper.
- NeoForge installer и его библиотеки загружаются из репозиториев NeoForge/Prism и проверяются по MD5.
- Локально публикуются только конфигурация профиля и небольшой version manifest.

Для повторного импорта используется `scripts/import-neoforge-curseforge-pack.ps1`.
