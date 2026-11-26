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
    const meter = document.getElementById('trip-progress')
    let returnFocus = opener
    let localMenu = false
    let localIdentity = null
    let busy = false
    let generation = 0
    const title = document.getElementById('trip-title')
    const cleaning = new Map()
    const statusText = {
        preparing: 'Сервер готовит снимок мира для скачивания.',
        submitted: 'Поездка отправлена. Сервер проверит изменения.',
        approved: 'Изменения одобрены. Ждём записи в мир сервера.',
        review: 'Изменения на проверке у администратора. Поездка сохранена на устройстве.',
        done: 'Изменения поездки применены на сервере.',
        closed: 'Поездка закрыта. Скачанный мир доступен для личной игры.',
        failed: 'Сервер не смог обработать поездку. Скачанный мир сохранён.',
    }
    function add(label, job, needsNetwork = false, hint = '') {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'settingsActionButton'
        button.textContent = Lang.native(label)
        if (hint) {
            const description = document.createElement('small')
            description.textContent = Lang.native(hint)
            button.append(description)
        }
        button.onclick = () => execute(job)
        button.dataset.network = String(needsNetwork)
        button.disabled = busy || (needsNetwork && !navigator.onLine)
        actions.append(button)
    }
    function solo(c) {
        add('Открыть Minecraft', () => launchLocal(c), false,
            'Главное меню игры. Выберите свой мир или создайте новый на устройстве.')
    }
    function localWorld(c, local) {
        if (local?.stage === 'ready') {
            add('Продолжить поездку', () => launchLocal(c, local), false,
                'Откроется скачанный мир сервера. Прогресс можно отправить при подключении.')
        } else if (local) {
            add('Открыть личную копию', () => launchLocal(c, local, true), false,
                'Отдельное сохранение для одиночной игры. Дальнейшие изменения останутся на устройстве.')
        }
    }
    function reconcile(c, trip, ids) {
        if (!cleaning.has(c.uid)) {
            const task = c.reconcileApplied(trip, ids).finally(() => cleaning.delete(c.uid))
            cleaning.set(c.uid, task)
        }
        return cleaning.get(c.uid)
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
            meter.hidden = true
            busy = false
            for (const b of actions.children) b.disabled = b.dataset.network === 'true' && !navigator.onLine
            focusAction()
        }
    }
    function client() {
        const user = ConfigManager.getSelectedAccount() || ((localMenu || !navigator.onLine) && localIdentity)
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
    async function launchLocal(c, local = null, independent = false) {
        idle()
        if (local && !independent && local.stage !== 'ready') throw Error(Lang.native('Эта поездка уже передаётся на сервер.'))
        const distro = await DistroAPI.getDistributionLocalLoadOnly()
        const server = distro.getServerById(ConfigManager.getSelectedServer())
        let launch = local?.launch
        if (local && server.rawServer.version !== local.version) throw Error(Lang.native('Установленная сборка изменилась. Сохранение доступно для отправки.'))
        const fs = require('node:fs/promises')
        const path = require('node:path')
        try {
            await fs.access(ConfigManager.getJavaExecutable(server.rawServer.id))
            if (local) await fs.access(path.join(c.saves, folderName(local.id), 'level.dat'))
            if (!launch) {
                const version = server.rawServer.minecraftVersion
                const dir = path.join(ConfigManager.getCommonDirectory(), 'versions', version)
                await fs.access(path.join(dir, version + '.jar'))
                const versionData = JSON.parse(await fs.readFile(path.join(dir, version + '.json'), 'utf8'))
                const processor = new DistributionIndexProcessor(ConfigManager.getCommonDirectory(), distro, server.rawServer.id)
                launch = { versionData, modLoaderData: await processor.loadModLoaderVersionJson() }
            }
        } catch {
            throw Error(Lang.native('Файлы игры отсутствуют. Подключитесь к сети и подготовьте сборку.'))
        }
        const world = local ? folderName(local.id) : true
        let target = world
        if (independent) {
            target = await c.independentCopy(local)
        }
        const game = new ProcessBuilder(server, launch.versionData, launch.modLoaderData,
            { ...c.account, accessToken: 'offline' }, remote.app.getVersion(), target)
        proc = game.build()
        toggleLaunchArea(true)
        message.textContent = Lang.native(local ? 'Открываем сохранение…' : 'Открываем меню Minecraft…')
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
                : Lang.native(local && !independent ? 'Поездка сохранена. Изменения можно отправить на сервер.' : 'Игра закрыта.')
        })
        child.stdout?.resume()
        child.stderr?.resume()
        closePanel()
    }
    async function prepare(c, trip, playNow) {
        meter.hidden = false
        meter.removeAttribute('value')
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
        message.textContent = 'Скачиваем и проверяем снимок…'
        await c.download(trip, launch, (done, total) => {
            meter.max = total || 1
            meter.value = done
            message.textContent =
                'Скачиваем мир · ' +
                Math.floor(done / 1048576) +
                ' / ' +
                Math.ceil(total / 1048576) +
                ' МиБ'
        })
        meter.hidden = true
        if (playNow && !panel.hidden) await launchLocal(c, await c.local())
        else await show(false)
    }
    function prepareChoice(start) {
        actions.replaceChildren()
        message.textContent = Lang.native('Запустить мир после загрузки?')
        add('Только подготовить', () => start(false), true)
        add('Подготовить и играть', () => start(true), true)
        actions.firstElementChild?.focus()
    }
    async function show(online = true) {
        const view = ++generation
        const localOnly = localMenu || !navigator.onLine
        title.textContent = Lang.native(!navigator.onLine ? 'Игра без интернета' : localMenu ? 'Игра на устройстве' : 'Офлайн-поездки')
        if (localOnly && !ConfigManager.getSelectedAccount() && !localIdentity) {
            const profiles = await require('./assets/js/offlineworld').localProfiles(ConfigManager)
            if (generation !== view) return
            if (profiles.length > 1) {
                actions.replaceChildren()
                message.textContent = Lang.native('Выберите локальный профиль')
                for (const profile of profiles) add(profile.displayName, async () => { localIdentity = profile; await show(false) })
                return
            }
            // Vanilla UUID for OfflinePlayer:Player. This identity never enters the online account store.
            localIdentity = profiles[0] || { uuid: 'a01e3843e5213998958af459800e4d11', displayName: 'Player', type: 'mojang' }
        }
        if (localOnly && ConfigManager.getSelectedServer() !== PROFILE) {
            actions.replaceChildren()
            message.textContent = Lang.native('Можно открыть установленную сборку Minecraft.')
            solo({ account: ConfigManager.getSelectedAccount() || localIdentity })
            return
        }
        const c = client()
        let local = await c.local()
        if (view !== generation) return
        actions.replaceChildren()
        function localOptions() {
            localWorld(c, local)
            solo(c)
            const messages = {
                ready: 'Поездка скачана и готова к игре.',
                sending: 'Отправка прервалась. Продолжите её, когда появится связь.',
                sent: 'Поездка отправлена. Проверим результат при подключении.',
                archived: 'На устройстве есть сохранение закрытой поездки.',
            }
            message.textContent = Lang.native(messages[local?.stage] || 'Скачанной поездки на устройстве нет. Одиночная игра доступна.')
        }
        if (localOnly) {
            localOptions()
            if (navigator.onLine && localMenu && ConfigManager.getSelectedAccount()) {
                if (window.krwaSessionUnavailable) message.textContent = Lang.native('Нет связи с сервером входа.') + ' ' + message.textContent
                add('Проверить подключение', async () => {
                    if (await validateSelectedAccount()) {
                        localMenu = false
                        await show()
                    } else message.textContent = Lang.native('Сервер входа недоступен или требуется повторный вход.')
                }, true)
                if (window.krwaSessionUnavailable) add('Войти снова', () => {
                    closePanel()
                    document.getElementById('settingsAddMojangAccount').click()
                }, true)
            }
            return
        }
        if (local?.stage === 'ready') {
            localWorld(c, local)
            message.textContent = Lang.native('Поездка скачана и готова к игре.')
        }
        if (local && ['ready', 'sending', 'sent'].includes(local.stage)) {
            add(local.stage === 'ready' ? 'Отправить изменения' : local.stage === 'sending' ? 'Продолжить отправку' : 'Проверить статус',
                async () => {
                    idle()
                    if (local.stage !== 'sent') {
                        await c.authenticate()
                        message.textContent = Lang.native('Отправляем сохранение…')
                        await c.send(local, text => { message.textContent = text })
                    }
                    await show()
                }, true)
        }
        if (!online) {
            if (local?.stage !== 'ready') {
                localWorld(c, local)
                message.textContent = Lang.native(local?.stage === 'sent' ? 'Поездка отправлена. Проверим результат при подключении.' : 'Проверяем сохранения на устройстве…')
            }
            solo(c)
            add('Обновить статус', () => show(), true)
            return
        }
        try {
            await c.authenticate()
            const data = await c.api('/me')
            if (view !== generation || panel.hidden) return
            const t = data.trip
            await reconcile(c, t)
            if (view !== generation || panel.hidden) return
            local = await c.local()
            if (view !== generation || panel.hidden) return
            if (local && local.id === t?.id && ['done', 'closed', 'failed'].includes(t.state) && local.stage !== 'archived') {
                local.stage = 'archived'
                await atomicJson(c.stateFile, local)
            }
            if (data.access !== 'allowed') {
                actions.replaceChildren()
                if (local?.stage === 'ready') localWorld(c, local)
                message.textContent = Lang.native({
                    pending: 'Запрос отправлен. Решение появится здесь.',
                    denied: 'Администратор закрыл доступ.',
                    none: 'Офлайн-поездки доступны с разрешения администратора.',
                }[data.access] || 'Офлайн-поездки доступны с разрешения администратора.')
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
                    add('Скачать для офлайна', () => prepareChoice(play => prepare(c, t, play)), true)
                } else if (t.state !== 'ready') {
                    actions.replaceChildren()
                    message.textContent =
                        Lang.native(statusText[t.state]) + ' ' + (t.detail || '')
                }
            } else {
                actions.replaceChildren()
                message.textContent =
                    (t
                        ? Lang.native(statusText[t.state]) + ' ' + (t.detail || '') + ' '
                        : '') +
                    Lang.native('Для новой поездки выйдите с сервера и скачайте мир со всеми измерениями.')
                add('Скачать для офлайна', () => prepareChoice(async play => {
                    meter.hidden = false
                    meter.removeAttribute('value')
                    idle()
                    const distro =
                        await DistroAPI.refreshDistributionOrFallback()
                    const server = distro.getServerById(PROFILE)
                    let trip = await c.api('/trips', 'POST', {
                        version: server.rawServer.version,
                        protocol: 3,
                    })
                    const end = Date.now() + 240000
                    while (
                        trip?.state === 'preparing' &&
                        Date.now() < end &&
                        !panel.hidden
                    ) {
                        message.textContent = Lang.native(statusText.preparing)
                        await new Promise((resolve) =>
                            setTimeout(resolve, 3000),
                        )
                        trip = (await c.api('/me')).trip
                    }
                    if (trip?.state === 'ready' && !panel.hidden)
                        await prepare(c, trip, play)
                    else if (!panel.hidden) await show()
                }), true)
            }
        } catch (e) {
            if (view !== generation) return
            actions.replaceChildren()
            localOptions()
            message.textContent = Lang.native('Не удалось проверить статус поездки.') + ' ' + message.textContent
            add('Повторить проверку', () => show(), true)
            return
        }
        if (view !== generation) return
        if (local && local.stage !== 'ready') localWorld(c, local)
        solo(c)
        add('Обновить статус', () => show(), true)
    }
    function focusAction() {
        if (panel.hidden || busy) return
        if (document.activeElement === close || !panel.contains(document.activeElement))
            actions.querySelector('button:not(:disabled)')?.focus()
    }
    function refreshPanel() {
        if (panel.hidden || busy) return
        show().catch((e) => { message.textContent = e.message }).finally(focusAction)
    }
    window.addEventListener('krwa-account-validated', async () => {
        const account = ConfigManager.getSelectedAccount()
        if (proc || !account || ConfigManager.getSelectedServer() !== PROFILE) return
        const c = new OfflineWorld(ConfigManager, account)
        try {
            if (!panel.hidden) return
            const ids = await c.submittedIds()
            if (!ids.length) return
            await c.authenticate()
            await reconcile(c, null, ids)
        } catch { /* Retry after the next connection or when the player opens trips. */ }
    })
    window.addEventListener('online', async () => {
        localMenu = !(await validateSelectedAccount())
        refreshPanel()
    })
    window.addEventListener('offline', refreshPanel)
    function closePanel() {
        generation++
        panel.hidden = true
        returnFocus.focus()
    }
    function openPanel(offline) {
        localMenu = offline
        localIdentity = null
        returnFocus = offline ? document.getElementById(ConfigManager.getSelectedAccount() ? 'launch_button' : 'login-local') : opener
        if (proc) return
        panel.hidden = false
        message.textContent = Lang.native('Проверяем сохранения на устройстве…')
        close.focus()
        actions.replaceChildren()
        refreshPanel()
    }
    document.getElementById('login-local').onclick = () => openPanel(true)
    opener.onclick = () => openPanel(false)
    window.addEventListener('krwa-offline-play', () => openPanel(true))
    close.onclick = closePanel
    panel.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            const items = [...panel.querySelectorAll('button:not(:disabled), summary')]
            if (e.shiftKey && document.activeElement === items[0]) {
                e.preventDefault()
                items.at(-1)?.focus()
            } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
                e.preventDefault()
                items[0]?.focus()
            }
        }
        if (e.key === 'Escape') {
            e.preventDefault()
            closePanel()
        }
    })
})()
