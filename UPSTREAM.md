# Зафиксированные основы

- Helios Launcher: `dscalzi/HeliosLauncher`, commit `86e4316b963b54ff052be9ec80f316b8f842cf87`.
- Nebula: `dscalzi/Nebula`, commit `7ffc978727b95e03ae9d125688cf5cf132b78419`.
- Лицензия Helios/Nebula: MIT; исходные файлы лицензий сохранены внутри каталогов.
- AsterYggdrasil: Docker image закреплён digest в `compose.yml`.
- Caddy: Docker image закреплён digest в `compose.yml`.
- rcedit x64: утилита Electron для записи иконки/метаданных в локальную неподписанную Windows-сборку, SHA-256 `AB53500D556FD824636621BCA7DBECD8583BA181891C3E9EFDCF16B72A28B0CD`, лицензия MIT.

Исходники Helios и Nebula включены как vendor-код в один корневой репозиторий KRWA. Их прежние вложенные каталоги `.git` намеренно не входят в проект.
