# Разработка и сборка

## Структура репозитория

| Путь | Назначение |
|---|---|
| [`launcher-src`](../launcher-src/) | Electron-приложение, интерфейс, тесты и конфигурация сборки |
| [`nebula-src`](../nebula-src/) | Генератор `distribution.json` |
| [`repository`](../repository/) | Метаданные и статические файлы клиентского профиля |
| [`community`](../community/) | Сервис публичного каталога и постоянных ссылок на загрузки |
| [`mod-cache-service`](../mod-cache-service/) | Кэш разрешённых CurseForge-файлов с проверкой размера и MD5 |
| [`scripts`](../scripts/) | Импорт и проверка профиля NeoForge |
| [`compose.yml`](../compose.yml), [`Caddyfile`](../Caddyfile) | Локальный бэкенд с проверкой опубликованного порта Caddy |

## Быстрый старт для разработки

Для запуска Electron в режиме разработки нужны Node.js 22 и npm. Из корня репозитория выполните следующие команды.

```powershell
Set-Location launcher-src
npm ci
npm test
npm run lint
npm start
```

Адреса публичных сервисов и параметры приложения задаются в [`distromanager.js`](../launcher-src/app/assets/js/distromanager.js), [`ipcconstants.js`](../launcher-src/app/assets/js/ipcconstants.js), [`package.json`](../launcher-src/package.json) и [`electron-builder.yml`](../launcher-src/electron-builder.yml).

## Сборка и публикация

Чтобы собрать лаунчер для текущей платформы, выполните в `launcher-src` следующие команды.

```powershell
npm ci
npm run dist
```

| Команда или workflow | Назначение |
|---|---|
| [`build-launcher.cmd`](../build-launcher.cmd) | Windows x64 NSIS, Linux x64 AppImage, DEB и пакет Arch Linux |
| [Build macOS launcher](../.github/workflows/build-macos.yml) | Универсальные DMG и ZIP для Intel и Apple Silicon |
| [`release-launcher.cmd`](../release-launcher.cmd) | Принимает новую версию и собирает Windows и Linux перед запуском macOS workflow |
| [`publish-launcher.cmd`](../publish-launcher.cmd) | Проверяет совпадение версий и публикует артефакты трёх платформ в `repository/downloads` |
| [`rebuild-distribution.cmd`](../rebuild-distribution.cmd) | Пересобирает `repository/distribution.json` через Nebula |

Для подписанного выпуска от другого издателя настройте подпись Windows и Apple Developer ID. Конфигурация сборки находится в [`electron-builder.yml`](../launcher-src/electron-builder.yml).

## Безопасность и приватные данные

- Храните локально `.env`, базы из `auth-data`, резервные копии, токены, приватные ключи, сведения о хостах и внутренней топологии сети, а также собранные установщики. В Git есть шаблон [`.env.example`](../.env.example).
- Для внешнего доступа к авторизации и файлам используйте HTTPS.
- Перед публикацией форка проверьте URL, название приложения, `appId`, канал обновлений и условия распространения файлов модпака.
