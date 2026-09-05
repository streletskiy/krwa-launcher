# KRWA 0.1.4 — лесное озеро

Оформление создано по приложенному пользователем концепту: объёмный песочный KRWA, бобр с бревном и зелёной кепкой, озеро на закате, тёмные панели, зелёные основные действия. Русский интерфейс сохранён. Регистрация открывает существующий сайт Aster; ссылка обозначена стрелкой внешнего перехода.

## Система интерфейса

Тема: `app/assets/css/krwa-theme.css`, подключается после базовых стилей Helios. Размер окна по умолчанию 1100×700, минимум 900×600 логических пикселей.

- Отступы: 4, 8, 12, 16, 24, 32 px (`--space-*`).
- Вкладки: общий внутренний отступ 32 px, при небольшом окне — 24 px. Боковая панель 216 px; кнопка завершения внизу обычного flex-потока.
- Заголовок 24 px, основной текст 14 px, пояснения 12 px.
- Поля входа 52 px, стандартные действия настроек 40 px; основные действия входа/запуска крупнее по иерархии.
- Скругления: панели 20 px, поля и элементы управления 12 px.
- Разделы настроек используют всю доступную ширину; прокручивается только содержимое вкладки. Длинные файловые пути остаются внутри полей.
- В ходе подготовки игры видны кнопка и прогресс; запуск и смена сервера блокируются. Статус сервера берётся из реального ping, с отдельным цветом недоступности.
- Для клавиатуры предусмотрен заметный фокус; анимации учитывают reduced-motion.
- Иконки действий и раскрытия — локальные SVG Lucide, сетка 24×24, штрих 2 px. Стрелки отображаются в боксе 20×20 и центрируются через `top: 50%` / `translateY(-50%)`; открытый список поворачивает ту же иконку на 180°.

SVG получены из [официального репозитория Lucide](https://github.com/lucide-icons/lucide) 04.09.2026. Исходная лицензия ISC/MIT сохранена в `app/assets/images/icons/lucide/LICENSE`; сетевой зависимости при запуске нет.

## Графика

Встроенный инструмент ImageGen, без CLI/API fallback. Прозрачность логотипа и значка сохранена. PNG/ICO нужных разрешений закодированы через Sharp из исходного значка.

| Файл относительно launcher-src | Назначение |
|---|---|
| `app/assets/images/krwa-beaver-lake.png` | Фон с бобром |
| `app/assets/images/krwa-wordmark.png` | Объёмный логотип с прозрачностью |
| `app/assets/images/krwa-block.png` | Исходный прозрачный значок |
| `app/assets/images/SealCircle.png`, `SealCircle.ico` | Значки окна и интерфейса |
| `build/icon.png`, `build/icon.ico` | Linux/Windows и установщик |

### Промпт фона

Use case: stylized-concept. Asset type: production background illustration for KRWA Minecraft desktop launcher, wide landscape 1536x1024 or 16:10. The attached image is STYLE AND COMPOSITION REFERENCE ONLY. Generate only the scenic illustration, no UI, no window, no buttons, no logo floating in scene. Beautiful detailed voxel Minecraft-like forest lake at warm peach sunset, distant stone mountain and pine trees, reflections in water. On the RIGHT 42 percent a charming large block-built brown beaver with two white teeth, wearing dark forest green baseball cap with small cream text 'KRWA', holding a cube log, seated on a grassy stone island at lower right, broad flat tail visible. Beaver entirely within image, face around x=78%, y=42%, feet near bottom. LEFT 55 percent is quiet dark forest/lake negative space suitable for separate overlaid launcher logo and controls. Match reference warm cinematic 3D block textures, realistic ambient occlusion, soft depth of field background, detailed sharp friendly beaver. Scene fills canvas edge to edge. Do not reproduce any UI or border or text except the cap embroidery.

### Промпт логотипа

Use case: logo-brand. Production transparent PNG wordmark for KRWA launcher. Reference image shows the required visual style. Generate ONLY the wordmark, isolated on genuine transparent background with alpha, no scenery, UI, card or rectangular background. Exact text 'KRWA' four uppercase letters K R W A. Wide horizontal logo, letters fill canvas with modest 5% transparent padding. Chunky bold Minecraft voxel/block 3D extruded lettering, front faces warm pale sandstone with subtle square stone tiles, darker earthy brown extrusion downwards. Letter A partly golden dirt blocks with a tiny green voxel pine tree integrated into its upper face as in reference. Strong legibility of all four letters. Near frontal camera, subtle top view, cinematic warm light from upper left, ambient occlusion between blocks. Match reference closely. No additional words or objects, no watermark. Wide 3:1 image.

### Промпт значка

Use case: logo-brand. Create a single small app icon asset for the KRWA Minecraft launcher: one isometric voxel grass and dirt cube, lush green grass top with a few square tufts, warm brown earth sides with a few stone pixels, premium detailed Minecraft block style. Simple highly legible silhouette, centered, fills 80% of square canvas, genuine transparent background with alpha, no text no letters no scene no border no badge no shadow plane. Match warm realistic voxel materials of a sunset Minecraft scene. Intended for use at 24px and Windows icon.

## Проверка интерфейса

Проверены в Electron 39: главный экран, прогресс 68%, приветствие, выбор способа входа, вход, показ/скрытие пароля, блокировка пустого пароля, диалог ошибки, выбор сервера, все семь вкладок настроек. На 1100×700 и 900×600 нет горизонтального переполнения вкладок; кнопка «Готово» в пределах окна. Проверены верх и низ прокручиваемых вкладок Java/модов и открытый список шейдеров. В процессе исправлен старый неверный namespace локализации `shaderpackOff`, из-за которого появлялось `undefined`.

Локальные снимки и машинный отчёт: `dist/design-qa/` (не включаются в установщик и Git). ESLint и `git diff --check` проходят. Linux AppImage проверяется сборкой; интерактивный запуск Linux в этой Windows-сессии не проверялся.

Собранное Windows-приложение проверено с отдельным пустым профилем: приветствие → вход, реальный отказ Aster на неверные данные и возвращение к активной форме. Дополнительно проверено, что фоновое обновление описания сборки не снимает блокировку повторного запуска, а старый ArrowUp не открывает скрытую панель новостей.

Собраны и опубликованы Windows NSIS и Linux AppImage версии 0.1.4. Файлы приложения в обоих `app.asar` совпадают с итоговыми исходниками. HTTP-раздача установщиков, blockmap и обоих latest-манифестов возвращает 200. Установленный Windows-лаунчер 0.1.3 обнаружил и скачал 0.1.4 через electron-updater; после штатного установщика запущено приложение с ProductVersion 0.1.4, новый экран входа проверен визуально.

## Выпуск 0.1.6 — нативный аккаунт и обновления

Собственные формы регистрации, смены/восстановления пароля, загрузки скина/плаща с предпросмотром размещены в основном окне. Общая сетка 12/16/24/32 px, поля 44 px, кнопки 48 px; выпадающие списки используют локальную SVG-стрелку Lucide. Все формы, включая ввод кода восстановления, проверены при 900×600. Веб-окно кабинета из 0.1.5 удалено.

При старте показаны проверка обновления, процент и объём загрузки, затем тихая установка с перезапуском. Проверены ошибки и тайм-ауты, отсутствие внезапного перезапуска при фоновой проверке. Шесть unit-тестов API/обновления и ESLint проходят. На отдельном Aster проверены регистрация с автоматическим игровым входом, загрузка PNG, смена пароля с повторным входом и отклонение старого пароля.

Windows NSIS и Linux AppImage 0.1.6 собраны и опубликованы. Реальный переход установленной 0.1.5 на 0.1.6 проверен новым StartupUpdate, запущенным тестовым стендом в процессе предыдущей версии: electron-updater скачал релиз, вызвал quitAndInstall(true, true), прежнее приложение закрылось и новая версия запустилась без мастера. Сам экран загрузки проверен отдельно с событиями прогресса 68%. Установленная 0.1.6 проверена также при отсутствии нового релиза. Linux проверен сборкой и составом app.asar, без интерактивной проверки обновления.

## Выпуск 0.1.8 — один персонаж и один скин

В нативной форме оставлена загрузка скина: выбор PNG сразу применяет его, без выбора плаща, модели рук и отдельной кнопки подтверждения. Модель определяется автоматически через skinview-utils. Предпросмотр учитывает внешние слои головы, тела, рук и ног, старые 64×32 скины и HD. Проверяются PNG-заголовок, размер и число пикселей до декодирования. Ник неизменяем; регистрационная проверка и подсказка согласованы с сервером: 4–16 символов.

Проверены регистрация с автоматическим входом, загрузка PNG, пароль с повторным входом, все нативные экраны при 900×600 и пиксели всех шести внешних слоёв. Windows NSIS и Linux AppImage собраны и опубликованы. Установленная 0.1.7 самостоятельно перешла на 0.1.8 без мастера; получены события update-available, update-downloaded и вызов quitAndInstall(true, true). Установленная 0.1.8 запускается и содержит новую форму. Linux проверен сборкой, без интерактивного запуска.
