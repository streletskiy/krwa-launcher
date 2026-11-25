;(() => {
    const {
        OfflineWorld,
        PROFILE,
        folderName,
        atomicJson,
    } = require('./assets/js/offlineworld')
    const panel = document.getElementById('trip-panel')
    const message = document.getElementById('trip-status')
    const actions = document.getElementById('trip-actions')
    const opener = document.getElementById('trip-open')
    const close = document.getElementById('trip-close')
    let busy = false
    let generation = 0
    const statusText = {
        preparing: 'Сервер готовит копию участка вокруг места выхода.',
        submitted:
            'Изменения приняты. Когда основной сервер будет свободен, они будут проверены.',
        approved:
            'Администратор одобрил изменения. Сервер повторно сверит участок перед записью.',
        review: 'Есть конфликт. Администратор увидит карту и сравнение версий.',
        done: 'Синхронизировано. Можно вернуться на сервер.',
        closed: 'Поездка закрыта. Локальная копия сохранена.',
        failed: 'Сервер не смог обработать поездку.',
    }
    function add(label, job) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'settingsActionButton'
        button.textContent = Lang.native(label)
        button.onclick = () => execute(job)
        actions.append(button)
    }
    async function execute(job) {
        if (busy) return
        busy = true
        for (const b of actions.children) b.disabled = true
        try {
            await job()
        } catch (e) {
            message.textContent = e.message
        } finally {
            busy = false
            for (const b of actions.children) b.disabled = false
        }
    }
    function client() {
        const user = ConfigManager.getSelectedAccount()
        if (!user || ConfigManager.getSelectedServer() !== PROFILE)
            throw Error(
                'Выберите профиль KRWA Aeronautics и войдите в аккаунт.',
            )
        return new OfflineWorld(ConfigManager, user)
    }
    function idle() {
        if (
            proc ||
            document.getElementById('landingContainer').dataset.launching ===
                'true'
        )
            throw Error('Сначала закройте Minecraft.')
    }
    async function launchLocal(c, local) {
        idle()
        if (local.stage !== 'ready')
            throw Error('Эта поездка уже передаётся на сервер.')
        const distro = await DistroAPI.getDistributionLocalLoadOnly()
        const server = distro.getServerById(PROFILE)
        if (server.rawServer.version !== local.version)
            throw Error(
                'Установленная сборка изменилась. Сохранение доступно для отправки.',
            )
        const game = new ProcessBuilder(
            server,
            local.launch.versionData,
            local.launch.modLoaderData,
            { ...c.account, accessToken: 'offline' },
            remote.app.getVersion(),
            folderName(local.id),
        )
        proc = game.build()
        toggleLaunchArea(true)
        message.textContent = 'Запускается локальный мир…'
        const child = proc
        child.once('error', () => {
            proc = null
            toggleLaunchArea(false)
            message.textContent = 'Не удалось запустить Java.'
        })
        child.once('close', (code) => {
            proc = null
            toggleLaunchArea(false)
            message.textContent = code
                ? 'Игра завершилась с ошибкой. Локальное сохранение осталось на устройстве.'
                : 'Игра закрыта. Сохранение готово к отправке.'
        })
        child.stdout?.resume()
        child.stderr?.resume()
        closePanel()
    }
    async function prepare(c, trip) {
        message.textContent = 'Проверяем Java, моды и файлы игры…'
        const server = (await DistroAPI.getDistribution()).getServerById(
            PROFILE,
        )
        const opts = server.effectiveJavaOptions
        const java = ConfigManager.getJavaExecutable(PROFILE)
        if (
            !java ||
            !(await validateSelectedJvm(
                ensureJavaDirIsRoot(java),
                opts.supported,
            ))
        ) {
            const found = await discoverBestJvmInstallation(
                ConfigManager.getDataDirectory(),
                opts.supported,
            )
            if (found) {
                ConfigManager.setJavaExecutable(
                    PROFILE,
                    javaExecFromRoot(found.path),
                )
                ConfigManager.save()
            } else await downloadJava(opts, false)
        }
        let launch
        try {
            launch = await dlAsync(false)
        } finally {
            toggleLaunchArea(false)
        }
        if (!launch || launch.version !== trip.version)
            throw Error(
                'Не удалось подготовить точную версию сборки. Обновите профиль и повторите.',
            )
        message.textContent = 'Скачиваем и проверяем участок…'
        await c.download(trip, launch)
        await show(false)
    }
    async function show(online = true) {
        const view = ++generation
        const c = client(),
            local = await c.local()
        if (view !== generation) return
        actions.replaceChildren()
        if (local?.stage === 'ready') {
            message.textContent =
                'Готово к полёту · участок 80 × 80 блоков. Одиночная игра доступна без сети.'
            add('Играть офлайн', () => launchLocal(c, local))
        } else
            message.textContent =
                local?.stage === 'sending'
                    ? 'Отправка не завершена. Копия сохранена.'
                    : 'Для поездки нужен доступ и снимок сервера.'
        if (local && ['ready', 'sending', 'sent'].includes(local.stage))
            add(
                local.stage === 'ready'
                    ? 'Синхронизировать'
                    : 'Проверить отправку',
                async () => {
                    idle()
                    await c.authenticate()
                    if (local.stage !== 'sent') {
                        message.textContent = 'Отправляем сохранение…'
                        await c.send(local)
                    }
                    await show()
                },
            )
        if (!online || !navigator.onLine) {
            add('Проверить статус', () => show())
            return
        }
        try {
            await c.authenticate()
            const data = await c.api('/me')
            if (view !== generation || panel.hidden) return
            const t = data.trip
            if (
                local?.id === t?.id &&
                ['done', 'closed', 'failed'].includes(t?.state) &&
                local.stage !== 'archived'
            ) {
                local.stage = 'archived'
                await atomicJson(c.stateFile, local)
            }
            if (data.access !== 'allowed') {
                if (!local) actions.replaceChildren()
                message.textContent = {
                    pending: 'Запрос отправлен. Решение появится здесь.',
                    denied: 'Администратор закрыл доступ.',
                    none: 'Офлайн-поездки доступны с разрешения администратора.',
                }[data.access]
                if (data.access === 'none')
                    add('Запросить доступ', async () => {
                        await c.api('/request', 'POST', {})
                        await show()
                    })
            } else if (t && !['done', 'closed', 'failed'].includes(t.state)) {
                if (
                    t.state === 'ready' &&
                    local?.id === t.id &&
                    local.stage === 'sent' &&
                    !t.digest
                ) {
                    local.stage = 'ready'
                    await atomicJson(c.stateFile, local)
                    await show(false)
                    message.textContent =
                        'Администратор вернул поездку на доработку. Можно открыть сохранение и отправить снова.'
                    return
                }
                if (t.state === 'ready' && local?.id !== t.id) {
                    actions.replaceChildren()
                    message.textContent =
                        'Снимок готов. Скачайте его до отключения интернета.'
                    add('Скачать для офлайна', () => prepare(c, t))
                } else if (t.state !== 'ready') {
                    actions.replaceChildren()
                    message.textContent =
                        statusText[t.state] + ' ' + (t.detail || '')
                }
            } else {
                actions.replaceChildren()
                message.textContent =
                    (t
                        ? statusText[t.state] + ' ' + (t.detail || '') + ' '
                        : '') +
                    'Перед поездкой выйдите из игры на разрешённом участке обычного мира (80 × 80 блоков).'
                add('Скачать для офлайна', async () => {
                    idle()
                    const distro =
                        await DistroAPI.refreshDistributionOrFallback()
                    const server = distro.getServerById(PROFILE)
                    let trip = await c.api('/trips', 'POST', {
                        version: server.rawServer.version,
                    })
                    const end = Date.now() + 240000
                    while (
                        trip?.state === 'preparing' &&
                        Date.now() < end &&
                        !panel.hidden
                    ) {
                        message.textContent = statusText.preparing
                        await new Promise((resolve) =>
                            setTimeout(resolve, 3000),
                        )
                        trip = (await c.api('/me')).trip
                    }
                    if (trip?.state === 'ready' && !panel.hidden)
                        await prepare(c, trip)
                    else if (!panel.hidden) await show()
                })
            }
        } catch (e) {
            if (view !== generation) return
            if (local?.stage !== 'ready') message.textContent = e.message
        }
        if (view === generation) add('Обновить статус', () => show())
    }
    function closePanel() {
        generation++
        panel.hidden = true
        opener.focus()
    }
    opener.onclick = () => {
        if (proc) return
        panel.hidden = false
        close.focus()
        show().catch((e) => {
            message.textContent = e.message
        })
    }
    close.onclick = closePanel
    panel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault()
            closePanel()
        }
    })
})()
