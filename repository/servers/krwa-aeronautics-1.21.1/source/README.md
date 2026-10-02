# Источник профиля KRWA Aeronautics

Профиль импортирован из официального CurseForge server/client pack
`All of Create - Aeronautics v2.7` (CurseForge file `9036129`, serverpack `9036130`)
для Minecraft 1.21.1 и NeoForge 21.1.250. Версия профиля KRWA — `1.0.9`.

Обновлён согласованный upstream-набор: Create Aeronautics/Simulated/Offroad `1.3.2`,
Create `6.0.10`, Sable `2.0.5` и остальные файлы v2.7. В клиентский manifest вошли
250 upstream-артефактов. Добавлены Create Springs `1.2.1`, Coasters Simulated `0.1.5`
и библиотека MezzConfig `0.6.6`; их лицензия — MIT. Новые моды для чата не добавлены.

Из upstream исключены рекламные BHMenu (`1084468`) и Server Browser (`825617`),
их конфигурация и исходное рекламное меню. Сохранено меню KRWA. Резервные `.bak`
и история JEI из локальных миров автора также не входят в клиентский профиль.

Shtreimel `0.6.0` (`1529625:8973052`, MIT) устанавливается только на dedicated server,
поэтому отсутствует в клиентском manifest. Он добавляет защиту приватов и кораблей,
ограничения скорости, диагностику и исправления дюпов. Для существующего мира KRWA
выключено автоматическое присвоение старого корабля первому пассажиру
(`adoptOwnerless = false`); действующие AeroClaims/OPAC данные сохраняются.

В `files/config/paxi/datapacks/krwa-create-springs-compat` добавлены два MIT-рецепта
Springs: переносной паровой двигатель и перфокарта. В оригинальном JAR 1.2.1
остались ключи Create 5 (`item` у результатов и `transitionalItem`); datapack
использует схему Create 6 (`id` и `transitional_item`). Материалы, количество,
вероятности и число циклов сохранены. Этот каталог также устанавливается на сервер;
JAR мода не изменяется. При обновлении Springs проверить, нужен ли ещё override.

Дополнения KRWA для Steam Deck (необязательные, выключены по умолчанию):

- [Controlify 3.0.1 LTS](https://www.curseforge.com/minecraft/mc-mods/controlify) — NeoForge 1.21.1, LGPL-3.0-or-later; использует уже включённый YetAnotherConfigLib 3.8.2.
- [Dynamic FPS 3.11.4](https://www.curseforge.com/minecraft/mc-mods/dynamic-fps) — NeoForge 1.21/1.21.1, MIT, только клиент.

Дополнение KRWA 1.0.7 (необязательное, включено по умолчанию):

- [Just Zoom 2.1.0](https://www.curseforge.com/minecraft/mc-mods/just-zoom/files/6290230) — NeoForge 1.21.1, DSMSLv3, только клиент; использует уже включённый Konkrete 1.9.9. Лицензия разрешает модпаки при загрузке файла с официального источника.

Файлы загружаются напрямую через CurseForge API и проверяются по размеру и MD5 из `neoforge-lock.json`.

- `curseforge-manifest.json` фиксирует CurseForge project/file ID каждого мода.
- `neoforge-lock.json` фиксирует URL, размер и MD5 фактически проверенных файлов.
- JAR модов загружаются напрямую с CurseForge; они не зеркалируются в репозитории KRWA.
- `prism-neoforge-21.1.250.json` фиксирует проверенную схему запуска NeoForge через ForgeWrapper.
- NeoForge installer и его библиотеки загружаются из репозиториев NeoForge/Prism и проверяются по MD5.
- Локально публикуются только конфигурация профиля и небольшой version manifest.

Для повторного импорта используется `scripts/import-neoforge-curseforge-pack.ps1`.
