'use strict'
const api = '/api/offline-worlds/admin'
const el = (id) => document.getElementById(id)
const labels = {
    pending: 'Запрос',
    allowed: 'Доступ разрешён',
    denied: 'Доступ закрыт',
    preparing: 'Подготовка снимка',
    ready: 'На устройстве или готов к скачиванию',
    submitted: 'Ожидает проверки',
    approved: 'Ожидает применения',
    review: 'Нужно решение',
    done: 'Применено',
    closed: 'Закрыто',
    failed: 'Ошибка',
}
const dimensions = {
    'minecraft:overworld': 'Обычный мир',
    'minecraft:the_nether': 'Нижний мир',
    'minecraft:the_end': 'Край',
}
const dimensionOf = (change) => change.dimension || 'minecraft:overworld'
let current, tile, limit, pendingAction
const playerChoices = new Set()
let selectedDimension = 'minecraft:overworld'
function node(tag, text, cls) {
    const n = document.createElement(tag)
    if (text !== undefined) n.textContent = text
    if (cls) n.className = cls
    return n
}
function button(label, fn) {
    const b = node('button', label)
    b.onclick = () => run(fn)
    return b
}
async function request(path = '', body) {
    const res = await fetch(api + path, {
        method: body ? 'POST' : 'GET',
        headers: body
            ? { 'Content-Type': 'application/json', 'X-KRWA-Review': '1' }
            : {},
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401 || res.status === 403) {
        el('workspace').hidden = true
        el('auth-state').hidden = false
        el('auth-title').textContent = res.status === 401 ? 'Войдите как администратор' : 'Требуются права администратора'
        el('login-link').hidden = res.status !== 401
        el('login-link').href = '/login?returnTo=' + encodeURIComponent('/admin/worlds' + location.search)
    }
    const result = await res.json()
    if (!res.ok) throw Error(result.detail || 'Не удалось выполнить запрос.')
    return result
}
async function run(fn) {
    try {
        el('status').textContent = ''
        await fn()
    } catch (e) {
        el('status').textContent = e.message
    }
}
function confirmAction(message, action) {
    el('confirm').hidden = false
    el('question').textContent = message
    pendingAction = action
    el('confirm-action').focus()
}
async function refresh() {
    const data = await request()
    el('auth-state').hidden = true
    el('workspace').hidden = false
    el('users').replaceChildren(
        ...data.users.map((u) => {
            const row = node('div', undefined, 'row')
            row.id = 'player-' + u.uid
            row.append(
                node('strong', u.name, 'heading'),
                node(
                    'small',
                    labels[u.state] +
                        (u.scope === 'world'
                            ? ' · весь мир, три измерения'
                            : u.cx == null
                              ? ' · участок не указан'
                              : ' · центр X ' +
                                (u.cx * 16 + 8) +
                                ', Z ' +
                                (u.cz * 16 + 8)),
                ),
            )
            const allowed = u.state === 'allowed'
            row.append(
                button(allowed ? 'Отозвать' : 'Разрешить', async () => {
                    if (
                        allowed &&
                        !window.confirm(
                            'Отозвать доступ и закрыть активную поездку игрока ' +
                                u.name +
                                '?',
                        )
                    )
                        return
                    await request(
                        '/access/' +
                            u.uid +
                            '/' +
                            (allowed ? 'denied' : 'allowed'),
                        {},
                    )
                    await refresh()
                }),
            )
            if (u.state === 'pending')
                row.append(
                    button('Отклонить', async () => {
                        await request('/access/' + u.uid + '/denied', {})
                        await refresh()
                    }),
                )
            return row
        }),
    )
    if (!data.users.length) el('users').textContent = 'Запросов пока нет.'
    el('trips').replaceChildren(
        ...data.trips.map((t) => {
            const row = node('div', undefined, 'row')
            row.append(
                node('strong', t.name, 'heading'),
                node('span', labels[t.state]),
                node('small', new Date(t.updated * 1000).toLocaleString('ru')),
                button('Открыть', () => openTrip(t.id, t.name)),
            )
            return row
        }),
    )
    if (!data.trips.length) el('trips').textContent = 'Поездок пока нет.'
    return data
}
async function openTrip(id, name) {
    current = await request('/trips/' + id)
    current.name = name
    playerChoices.clear()
    tile = null
    limit = 30
    el('filter').value = ''
    el('confirm').hidden = true
    el('review').hidden = false
    el('review-title').textContent = name + ' · ' + labels[current.trip.state]
    const { cx, cz, radius } = current.area
    el('coordinates').textContent =
        cx === undefined
            ? current.trip.detail
            : 'Обычный мир · X ' +
              (cx - radius) * 16 +
              ' … ' +
              ((cx + radius + 1) * 16 - 1) +
              ' · Z ' +
              (cz - radius) * 16 +
              ' … ' +
              ((cz + radius + 1) * 16 - 1) +
              ' · ' +
              current.changes.length +
              ' изменений. ' +
              current.trip.detail
    const map = el('map')
    map.replaceChildren()
    const counts = new Map()
    for (const c of current.changes)
        if (c.pos) {
            const key =
                Math.floor(c.pos[0] / 16) + ',' + Math.floor(c.pos[2] / 16)
            const entry = counts.get(key) || { n: 0, rank: 0 }
            entry.n++
            entry.rank = Math.max(
                entry.rank,
                { auto: 1, conflict: 2, manual: 3 }[c.mode],
            )
            counts.set(key, entry)
        }
    const full = current.area.scope === 'world'
    el('dimensions').hidden = !full
    map.classList.toggle('whole-world', full)
    if (full) {
        dimensionControls(current.area.dimensions || Object.keys(dimensions))
        el('coordinates').textContent =
            'Весь мир · ' +
            current.changes.length +
            ' изменений. ' +
            current.trip.detail
        selectedDimension =
            current.changes.find((c) => c.pos)?.dimension ||
            'minecraft:overworld'
        drawWorldTiles()
    }
    if (cx !== undefined)
        for (let z = cz - radius; z <= cz + radius; z++)
            for (let x = cx - radius; x <= cx + radius; x++) {
                const key = x + ',' + z,
                    entry = counts.get(key)
                const b = button(entry ? String(entry.n) : '·', () => {
                    tile = key
                    limit = 30
                    render()
                })
                b.title = 'Чанк ' + key + ' · ' + (entry?.n || 0) + ' изменений'
                b.setAttribute('aria-label', b.title)
                b.dataset.tile = key
                b.className = ['', 'auto', 'conflict', 'manual'][
                    entry?.rank || 0
                ]
                map.append(b)
            }
    const countsByMode = mode => current.changes.filter(c => c.mode === mode).length
    el('merge-summary').textContent = 'Совместимые: ' + countsByMode('auto') + ' · Конфликты: ' + countsByMode('conflict') + ' · Ручной перенос: ' + countsByMode('manual')
    el('merge').hidden = current.trip.state !== 'review' || !current.trip.review
    updateMerge()
    if (countsByMode('conflict')) el('filter').value = 'conflict'
    else if (countsByMode('manual')) el('filter').value = 'manual'
    el('accept').hidden =
        current.trip.state !== 'review' ||
        !current.trip.review ||
        current.changes.some((c) => c.mode === 'manual')
    const manual = current.changes.filter((c) => c.mode === 'manual')
    el('accept-existing').hidden =
        current.trip.state !== 'review' ||
        !current.trip.review ||
        !manual.length ||
        manual.length === current.changes.length ||
        manual.some((c) => c.kind !== 'new_chunk')
    el('revise').hidden =
        current.trip.state !== 'review' || !current.trip.review
    el('keep').hidden = ['done', 'closed'].includes(current.trip.state)
    el('slices').hidden = true
    el('exports').replaceChildren()
    if (current.trip.review || current.changes.length) {
        for (const [file, label] of [
            ['base', 'Снимок до поездки'],
            ['live', 'Чанки сервера'],
            ['upload', 'Сохранение игрока'],
        ]) {
            const a = node('a', label)
            a.href = api + '/trips/' + id + '/archive/' + file
            el('exports').append(a)
        }
    }
    const first = current.changes.find((c) => c.pos)
    if (first && el("map-tools").open) await drawSlice(first.pos, dimensionOf(first))
    render()
    el('review').scrollIntoView({ block: 'start' })
}
function drawWorldTiles() {
    for (const control of el('dimensions').children) control.setAttribute('aria-pressed', String(control.dataset.dimension === selectedDimension))
    const map = el('map'),
        dimension = selectedDimension
    map.replaceChildren()
    const counts = new Map()
    for (const c of current.changes.filter(
        (c) => c.pos && dimensionOf(c) === dimension,
    )) {
        const key = Math.floor(c.pos[0] / 16) + ',' + Math.floor(c.pos[2] / 16)
        const entry = counts.get(key) || { count: 0, rank: 0, pos: c.pos }
        entry.count++
        entry.rank = Math.max(
            entry.rank,
            { auto: 1, conflict: 2, manual: 3 }[c.mode],
        )
        counts.set(key, entry)
    }
    for (const [key, entry] of counts) {
        const b = button(key + ' · ' + entry.count, async () => {
            tile = key
            limit = 30
            render()
            await drawSlice(entry.pos, dimension)
        })
        b.title = 'Чанк ' + key + ' · ' + entry.count + ' изменений'
        b.dataset.tile = key
        b.className = ['', 'auto', 'conflict', 'manual'][entry.rank]
        map.append(b)
    }
}
function dimensionControls(values) {
    el('dimensions').replaceChildren()
    for (const value of values) {
        const control = button(dimensions[value] || value, () => {
            selectedDimension = value
            changeDimension()
        })
        control.dataset.dimension = value
        el('dimensions').append(control)
    }
}
function changeDimension() {
    sliceRequest++
    tile = null
    limit = 30
    el('slices').hidden = true
    drawWorldTiles()
    render()
}
let sliceRequest = 0
function materialColor(id) {
    if (/:(cave_air|air|void_air)$/.test(id)) return '#132127'
    if (id.includes('water')) return '#4383bc'
    if (id.includes('lava')) return '#e97f38'
    if (id.includes('grass') || id.includes('leaves')) return '#658c4f'
    if (id.includes('dirt') || id.includes('mud')) return '#866449'
    if (id.includes('planks') || id.includes('oak') || id.includes('spruce'))
        return '#b18a57'
    if (id.includes('sand')) return '#dec98f'
    if (id.includes('stone') || id.includes('slate')) return '#83898a'
    let hash = 0
    for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0
    return 'hsl(' + Math.abs(hash % 360) + ' 36% 52%)'
}
async function drawSlice(pos, dimension = 'minecraft:overworld') {
    const seq = ++sliceRequest,
        id = current.trip.id
    const [x, y, z] = pos,
        cx = Math.floor(x / 16),
        cz = Math.floor(z / 16)
    const image = await request(
        '/trips/' +
            id +
            '/map?x=' +
            cx +
            '&z=' +
            cz +
            '&y=' +
            y +
            '&dimension=' +
            encodeURIComponent(dimension),
    )
    if (seq !== sliceRequest || id !== current.trip.id) return
    el('slices').hidden = false
    const elevation = el('slice-y')
    elevation.value = y
    elevation.onchange = () =>
        run(async () => {
            const height = elevation.valueAsNumber
            if (!Number.isInteger(height) || height < -64 || height > 319)
                throw Error('Выберите высоту от −64 до 319.')
            await drawSlice([x, height, z], dimension)
        })
    el('slice-heading').textContent =
        (dimensions[dimension] || dimension) + ' · Y ' + y + ' · чанк ' + cx + ', ' + cz
    const describe = (i) => {
        const values = image.layers.map((grid) =>
            image.palette[grid[i]].replace('minecraft:', ''),
        )
        el('under-pointer').textContent =
            'X ' +
            (cx * 16 + (i % 16)) +
            ' · Y ' +
            y +
            ' · Z ' +
            (cz * 16 + Math.floor(i / 16)) +
            ' — ' +
            values.join(' / ')
    }
    const target = (((z % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16)
    el('slice-images').replaceChildren(
        ...image.layers.map((grid, n) => {
            const figure = node('figure'),
                cv = node('canvas'),
                title = ['До поездки', 'Сейчас на сервере', 'После поездки'][n]
            cv.width = cv.height = 160
            const ctx = cv.getContext('2d')
            grid.forEach((v, i) => {
                const dx = (i % 16) * 10,
                    dz = Math.floor(i / 16) * 10
                ctx.fillStyle = materialColor(image.palette[v])
                ctx.fillRect(dx, dz, 10, 10)
                if (
                    image.layers[0][i] !== image.layers[1][i] ||
                    image.layers[0][i] !== image.layers[2][i]
                ) {
                    ctx.strokeStyle = '#ffbe54'
                    ctx.strokeRect(dx + 1, dz + 1, 8, 8)
                }
            })
            ctx.strokeStyle = 'white'
            ctx.lineWidth = 2
            ctx.strokeRect(
                (target % 16) * 10 + 1,
                Math.floor(target / 16) * 10 + 1,
                8,
                8,
            )
            cv.setAttribute(
                'aria-label',
                title + ' · срез чанка на высоте ' + y,
            )
            cv.onpointermove = (e) => {
                const r = cv.getBoundingClientRect()
                const col = Math.min(
                        15,
                        Math.max(
                            0,
                            Math.floor(((e.clientX - r.left) * 16) / r.width),
                        ),
                    ),
                    row = Math.min(
                        15,
                        Math.max(
                            0,
                            Math.floor(((e.clientY - r.top) * 16) / r.height),
                        ),
                    )
                describe(row * 16 + col)
            }
            figure.append(node('figcaption', title), cv)
            return figure
        }),
    )
    describe(target)
}
function render() {
    const visible = current.changes.filter(
        (c) =>
            (!c.pos ||
                current.area.scope !== 'world' ||
                dimensionOf(c) === selectedDimension) &&
            (!el('filter').value || el('filter').value === c.mode) &&
            (!tile ||
                (c.pos &&
                    Math.floor(c.pos[0] / 16) +
                        ',' +
                        Math.floor(c.pos[2] / 16) ===
                        tile)),
    )
    el('map')
        .querySelectorAll('button')
        .forEach((b) =>
            b.setAttribute('aria-pressed', String(b.dataset.tile === tile)),
        )
    el('comparison').replaceChildren(
        ...visible.slice(0, limit).map((c) => {
            const row = node('article', undefined, 'change'),
                states = node('div', undefined, 'states')
            row.append(
                node(
                    'strong',
                    (c.pos
                        ? (dimensions[dimensionOf(c)] || dimensionOf(c)) +
                          ' · X ' +
                          c.pos[0] +
                          ' · Y ' +
                          c.pos[1] +
                          ' · Z ' +
                          c.pos[2]
                        : c.kind) +
                        ' · ' +
                        {
                            auto: 'Совместимо',
                            manual: 'Ручной перенос',
                            conflict: 'Конфликт',
                        }[c.mode],
                ),
            )
            for (const [k, l] of [
                ['before', 'До поездки'],
                ['live', 'На сервере'],
                ['after', 'У игрока'],
            ]) {
                const col = node('div')
                col.append(node('b', l), document.createTextNode(c[k]))
                states.append(col)
            }
            if (c.mode === 'conflict' && current.trip.state === 'review') {
                const control = node('label', 'Версия после слияния ')
                const select = node('select')
                for (const [value, label] of [['server', 'Оставить серверную'], ['player', 'Взять у игрока']]) {
                    const option = node('option', label)
                    option.value = value
                    select.append(option)
                }
                select.value = playerChoices.has(c.key) ? 'player' : 'server'
                select.onchange = () => {
                    if (select.value === 'player') playerChoices.add(c.key)
                    else playerChoices.delete(c.key)
                    updateMerge()
                }
                control.append(select)
                row.append(control)
            }
            if (c.mode === 'manual') row.append(node('p','Эта правка доступна в архиве игрока для ручного переноса.'))
            if (c.pos) row.append(button('Показать на карте', async () => {
                el('map-tools').open = true
                await drawSlice(c.pos, dimensionOf(c))
                el('slices').scrollIntoView({block:'nearest'})
            }))
            row.append(states)
            return row
        }),
    )
    if (!visible.length)
        el('comparison').textContent = 'Нет изменений для выбранного фильтра.'
    el('more').hidden = visible.length <= limit
}
function updateMerge() {
    const n = current.changes.filter(c => c.mode === 'auto').length + playerChoices.size
    el('merge').disabled = n === 0
    el('merge').textContent = (playerChoices.size ? 'Применить выбранное' : 'Автослияние') + ' · ' + n
}
for (const [id, decision] of [
    ['merge','merge'],
    ['accept', 'accept'],
    ['accept-existing', 'accept-existing'],
    ['keep', 'keep'],
    ['revise', 'revise'],
]) {
    el(id).onclick = () =>
        confirmAction(
            decision === 'merge' ? 'Применить совместимые изменения и выбранные версии игрока? Для остальных сохранится версия сервера. Исходная посылка останется в архивах поездки.' : decision === 'accept'
                ? 'Применить показанные изменения игрока после повторной сверки сервера?'
                : decision === 'accept-existing'
                  ? 'Применить показанные правки персонажа и освоенных чанков, включая выбранную версию конфликтов? Новая территория останется в архиве для ручного переноса.'
                  : decision === 'revise'
                    ? 'Вернуть эту же локальную копию игроку для исправления?'
                    : 'Закрыть поездку и сохранить текущий мир сервера?',
            async () => {
                await request('/trips/' + current.trip.id + '/' + decision, {
                    fingerprint: current.trip.review,
                    ...(decision === "merge" ? {player:[...playerChoices]} : {}),
                })
                await refresh()
                await openTrip(current.trip.id, current.name)
            },
        )
}
el('confirm-action').onclick = () =>
    run(async () => {
        el('confirm').hidden = true
        await pendingAction()
    })
el('cancel').onclick = () => {
    el('confirm').hidden = true
}
el('all').onclick = () => {
    tile = null
    limit = 30
    render()
}
el('filter').onchange = () => {
    limit = 30
    render()
}
el('more').onclick = () => {
    limit += 30
    render()
}
el('refresh').onclick = () =>
    run(async () => {
        await refresh()
        if (current) await openTrip(current.trip.id, current.name)
    })
el('grant').onsubmit = (e) => {
    e.preventDefault()
    run(async () => {
        await request('/grant', { name: el('grant-name').value.trim(), scope: 'world' })
        el('grant-name').value = ''
        await refresh()
    })
}
run(async () => {
    const data = await refresh()
    const query = new URLSearchParams(location.search)
    const trip = query.get('trip'), player = query.get('player')
    if (trip && /^[a-f0-9]{32}$/i.test(trip)) {
        const recent = data.trips.find(t => t.id === trip)
        const owner = recent || data.users.find(u => u.uid === player)
        await openTrip(trip, owner?.name || 'Поездка')
    } else if (player && /^[a-f0-9]{32}$/i.test(player)) {
        const row = el('player-' + player)
        if (row) {
            row.scrollIntoView({block: 'center'})
            row.querySelector('button')?.focus({preventScroll: true})
        } else {
            const field = el('grant-name')
            field.focus()
            const response = await fetch('/api/v1/admin/minecraft-profiles/' + player)
            if (response.ok) {
                const {data: profile} = await response.json()
                if (!field.value && profile?.uuid?.replaceAll('-', '').toLowerCase() === player.toLowerCase() && /^[a-zA-Z0-9_]{1,16}$/.test(profile.name)) {
                    field.value = profile.name
                }
            }
        }
    }
})
