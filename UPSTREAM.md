# Происхождение кода и сторонние компоненты

- [Helios Launcher](https://github.com/dscalzi/HeliosLauncher): исходный коммит `86e4316b963b54ff052be9ec80f316b8f842cf87`, лицензия MIT. Исходный текст лицензии сохранён в `launcher-src/LICENSE.txt`.
- [Nebula](https://github.com/dscalzi/Nebula): исходный коммит `7ffc978727b95e03ae9d125688cf5cf132b78419`, лицензия MIT. Исходный текст лицензии сохранён в `nebula-src/LICENSE`.
- [AsterYggdrasil](https://github.com/AsterCommunity/AsterYggdrasil): отдельный сервис Yggdrasil; его исходники не входят в этот репозиторий.
- Caddy и Node.js запускаются из образов, закреплённых по digest в `compose.yml`.
- `rcedit-x64.exe`: утилита Electron для записи иконки и метаданных в неподписанную Windows-сборку, SHA-256 `AB53500D556FD824636621BCA7DBECD8583BA181891C3E9EFDCF16B72A28B0CD`, лицензия MIT.

Исходники Helios и Nebula включены как vendor-код без вложенных каталогов `.git`. Изменения KRWA находятся в общей истории этого репозитория; исходные точки зафиксированы выше для воспроизводимости и атрибуции.
