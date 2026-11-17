# Клиентский профиль KRWA Aeronautics

Профиль основан на All of Create – Aeronautics v2.7 для Minecraft 1.21.1 и NeoForge. Он включает Create Aeronautics, Create Springs и Coasters Simulated. В профиле используется меню KRWA, а BHMenu и Server Browser исключены. Версия профиля и версия NeoForge указаны в [`servermeta.json`](../repository/servers/krwa-aeronautics-1.21.1/servermeta.json). Состав и происхождение модпака описаны в [метаданных импорта](../repository/servers/krwa-aeronautics-1.21.1/source/README.md).

## Загрузка и обновление

Версии и исходные URL модов зафиксированы в [`neoforge-lock.json`](../repository/servers/krwa-aeronautics-1.21.1/neoforge-lock.json). Лаунчер проверяет размер и контрольную сумму файлов, заменяет ранее управляемые им файлы и сохраняет пользовательские дополнения. Обновления модпака устанавливаются через уже установленный лаунчер.

Лаунчер загружает моды через официальный CDN CurseForge `mediafilez.forgecdn.net`. Если CDN недоступен клиенту, лаунчер повторяет запрос через `/cf-files/` на `mc.krwa.ru`. Этот маршрут обслуживает артефакты из lock-файла и хранит проверенные копии в каталоге `mod-cache`. При отсутствии файла в кэше сервис обращается к CDN напрямую, затем через `MOD_CACHE_PROXY_URL`, если он настроен.

## Как изменить профиль

1. Обновите исходный manifest и overrides. [Скрипт импорта](../scripts/import-neoforge-curseforge-pack.ps1).
2. Проверьте совместимость, зависимости и условия распространения каждого компонента.
3. Повысьте версию в [`servermeta.json`](../repository/servers/krwa-aeronautics-1.21.1/servermeta.json).
4. Запустите [`rebuild-distribution.cmd`](../rebuild-distribution.cmd).
5. Проверьте полную загрузку профиля и запустите клиент. [Проверка загрузки](../scripts/verify-profile-download.cjs) · [Проверочный запуск](../scripts/smoke-launch-profile.cjs).

Сторонние моды, ресурспаки и шейдеры сохраняют собственные лицензии и условия распространения.
