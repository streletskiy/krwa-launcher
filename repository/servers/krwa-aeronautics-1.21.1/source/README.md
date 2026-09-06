# Источник профиля KRWA Aeronautics

Профиль импортирован из официального CurseForge server/client pack
`All of Create - Aeronautics 2.5` для Minecraft 1.21.1 и NeoForge 21.1.248.

- `curseforge-manifest.json` фиксирует CurseForge project/file ID каждого мода.
- `neoforge-lock.json` фиксирует URL, размер и MD5 фактически проверенных файлов.
- JAR модов загружаются напрямую с CurseForge; они не зеркалируются в репозитории KRWA.
- `prism-neoforge-21.1.248.json` фиксирует проверенную схему запуска NeoForge через ForgeWrapper.
- NeoForge installer и его библиотеки загружаются из репозиториев NeoForge/Prism и проверяются по MD5.
- Локально публикуются только конфигурация профиля и небольшой version manifest.

Для повторного импорта используется `scripts/import-neoforge-curseforge-pack.ps1`.
