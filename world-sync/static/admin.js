'use strict'
const api = '/api/offline-worlds/admin'
const el = (id) => document.getElementById(id)
const labels = {
    pending: 'Запрос доступа',
    allowed: 'Разрешён',
    denied: 'Закрыт',
    preparing: 'Готовится снимок',
    ready: 'Готово к игре',
    submitted: 'Ожидает проверки',
    approved: 'Ожидает применения',
    review: 'На проверке',
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
const modeTitles = { conflict: 'Конфликты', auto: 'Совместимые', manual: 'Ручной перенос', all: 'Все' }
const kinds = {
    block: 'Изменение блока',
    container: 'Содержимое контейнера',
    block_entity: 'Данные блока',
    chunk: 'Данные чанка',
    new_chunk: 'Новый чанк',
    Inventory: 'Инвентарь',
    EnderItems: 'Эндер-сундук',
    XpLevel: 'Уровень опыта',
    XpP: 'Прогресс уровня',
    XpTotal: 'Общий опыт',
    advancements: 'Достижения',
    quests: 'Квесты',
}
const materials = {
    'minecraft:air': 'Воздух',
    'minecraft:bricks': 'Кирпичи',
    'minecraft:stone': 'Камень',
    'minecraft:oak_planks': 'Дубовые доски',
    'minecraft:dirt': 'Земля',
    'minecraft:cobblestone': 'Булыжник',
    'minecraft:grass_block': 'Дёрн',
}
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
})
const playerChoices = new Set()
let current,
    tile,
    limit,
    pendingAction,
    sending = false
let mode = 'all',
    selectedDimension = 'minecraft:overworld',
    counts = {}
let tripRequest = 0
function node(tag, text, cls) {
    const n = document.createElement(tag)
    if (text !== undefined) n.textContent = text
    if (cls) n.className = cls
    return n
}
function button(label, fn, cls) {
    const b = node('button', label, cls)
    b.type = 'button'
    b.onclick = () => run(fn)
    return b
}
function badge(status) {
    return node('span', labels[status] || status, 'badge state-' + status)
}
function tripLink(id) {
    const target = new URL('/admin/worlds', location.origin)
    target.searchParams.set('trip', id)
    const a = node('a', 'Открыть', 'action')
    a.href = target.href
    a.target = '_top'
    return a
}
async function request(path = '', body) {
    const res = await fetch(api + path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json', 'X-KRWA-Review': '1' } : {},
        body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401 || res.status === 403) {
        el('workspace').hidden = true
        el('auth-state').hidden = false
        el('back').hidden = true
        el('auth-title').textContent =
            res.status === 401 ? 'Войдите как администратор' : 'Требуются права администратора'
        el('login-link').hidden = res.status !== 401
        el('login-link').href =
            '/login?returnTo=' + encodeURIComponent('/admin/worlds' + location.search)
        throw Error('')
    }
    const result = await res.json().catch(() => ({}))
    if (!res.ok) {
        if (res.status === 409)
            throw Error('Состояние изменилось. Нажмите «Обновить» и проверьте актуальные данные.')
        throw Error(
            typeof result.detail === 'string'
                ? result.detail
                : 'Не удалось выполнить запрос. Попробуйте ещё раз.',
        )
    }
    return result
}
async function run(fn) {
    el('status').textContent = ''
    try {
        await fn()
    } catch (e) {
        el('status').textContent =
            e.message === 'Failed to fetch'
                ? 'Нет связи с сервером. Проверьте подключение и повторите запрос.'
                : e.message
        if (el('status').textContent) el('status').scrollIntoView({ block: 'nearest' })
    }
}
function confirmAction(title, message, label, action, plan = false) {
    if (sending) return
    pendingAction = action
    el('confirm-title').textContent = title
    el('question').textContent = message
    el('confirm-action').textContent = label
    el('confirm-plan').hidden = !plan
    if (plan) fillPlan(el('confirm-plan'))
    el('confirm').showModal()
    el('cancel').focus()
}
function selectSection(access) {
    el('access').hidden = !access
    el('queue').hidden = access
    el('trips-tab').setAttribute('aria-pressed', String(!access))
    el('access-tab').setAttribute('aria-pressed', String(access))
}
function dataRow(name, status, detail, actions, kind) {
    const row = node('div', undefined, 'data-row ' + kind)
    row.append(node('strong', name, 'player-name'), badge(status), node('span', detail, 'row-detail'))
    const controls = node('div', undefined, 'row-actions')
    controls.append(...actions)
    row.append(controls)
    return row
}
async function refresh() {
    const data = await request()
    el('auth-state').hidden = true
    el('workspace').hidden = false
    const pending = data.users.filter((u) => u.state === 'pending').length
    el('pending-count').textContent = String(pending)
    el('pending-count').hidden = pending === 0
    el('access-tab').setAttribute(
        'aria-label',
        pending ? 'Доступ игроков. Запросов: ' + pending : 'Доступ игроков',
    )
    const names = [...data.users]
        .sort((a, b) => Number(b.state === 'pending') - Number(a.state === 'pending'))
        .map((u) => {
            const toggle = async (state) => {
                await request('/access/' + u.uid + '/' + state, {})
                await refresh()
            }
            const actions = []
            if (u.state === 'allowed') {
                actions.push(
                    button('Отозвать', () =>
                        confirmAction(
                            'Отозвать доступ у ' + u.name + '?',
                            'Активная поездка игрока будет закрыта.',
                            'Отозвать доступ',
                            () => toggle('denied'),
                        ),
                    ),
                )
            } else {
                actions.push(button('Разрешить', () => toggle('allowed')))
                if (u.state === 'pending')
                    actions.push(button('Отклонить', () => toggle('denied'), 'quiet'))
            }
            const scope =
                u.scope === 'world'
                    ? 'Весь мир'
                    : u.cx == null
                      ? 'Участок не указан'
                      : 'Центр участка · X ' + (u.cx * 16 + 8) + ' · Z ' + (u.cz * 16 + 8)
            const row = dataRow(u.name, u.state, scope, actions, 'user-row')
            row.id = 'player-' + u.uid
            return row
        })
    el('users').replaceChildren(
        ...(names.length ? names : [node('p', 'Запросов доступа пока нет.', 'empty')]),
    )
    renderQueue(data.trips)
    return data
}
let queueSignature = ''
function renderQueue(items) {
    const signature = JSON.stringify(items.map((t) => [t.id, t.state, t.name, t.updated, t.activity]))
    if (signature === queueSignature) return
    queueSignature = signature
    const focused = el('trips').contains(document.activeElement) ? document.activeElement.href : null
    const trips = [...items].sort(
        (a, b) => Number(b.state === 'review') - Number(a.state === 'review') || b.updated - a.updated,
    )
    const awaiting = trips.filter((t) => t.state === 'review').length
    el('queue-summary').textContent = 'На проверке · ' + awaiting
    el('queue-summary').classList.toggle('state-review', awaiting > 0)
    const rows = trips.map((t) => {
        const link = tripLink(t.id)
        link.setAttribute('aria-label', 'Открыть поездку ' + t.name)
        return dataRow(t.name, t.state, activityText(t) || dateFormat.format(t.updated * 1000), [link], 'trip-row')
    })
    el('trips').replaceChildren(
        ...(rows.length
            ? rows
            : [
                  node(
                      'p',
                      'Поездок пока нет. Здесь появятся сохранения, отправленные игроками.',
                      'empty',
                  ),
              ]),
    )
    if (focused) [...el('trips').querySelectorAll('a')].find((a) => a.href === focused)?.focus({ preventScroll: true })
}
const stages = {
    stopping: 'Сохраняем и останавливаем игровой сервер',
    player: 'Сравниваем данные игрока',
    transport: 'Сверяем транспорт и механизмы',
    files: 'Сравниваем файлы мира',
    finalizing: 'Готовим результат сравнения',
    applying: 'Создаём резервную копию и применяем правки',
}
function activityText(t) {
    const a = t.activity
    if (a) return (stages[a.phase] || 'Обрабатываем поездку') +
        (a.total > 0 ? ' · ' + a.completed + ' из ' + a.total : '')
    if (t.state === 'submitted') return 'Сохранение получено · в очереди на сравнение'
    if (t.state === 'approved') return 'Решение принято · в очереди на применение'
    return ''
}
function showActivity(t) {
    const title = activityText(t)
    el('trip-progress').hidden = !title
    if (!title) return
    if (el('activity-title').textContent !== title) el('activity-title').textContent = title
    const a = t.activity, bar = el('activity-bar')
    el('activity-detail').textContent = a ? 'Статус обновляется автоматически.' :
        'Обработка начнётся, когда игровой сервер освободится.'
    bar.hidden = !a
    if (a?.total > 0) { bar.max = a.total; bar.value = a.completed }
    else bar.removeAttribute('value')
}
async function openTrip(id, name) {
    const seq = ++tripRequest
    const data = await request('/trips/' + id)
    if (seq !== tripRequest) return
    const same =
        current &&
        current.trip.id === id &&
        current.trip.review === data.trip.review &&
        current.trip.state === data.trip.state
    current = data
    current.name = name
    const lostChoices = !same && playerChoices.size > 0 && data.trip.state === 'review'
    el('selection-note').hidden = !lostChoices
    el('selection-note').textContent = lostChoices
        ? 'Сверка обновилась. Проверьте конфликты и выберите версии заново.'
        : ''
    if (!same) playerChoices.clear()
    sliceRequest++
    tile = null
    limit = 12
    counts = { all: data.changes.length, auto: 0, conflict: 0, manual: 0 }
    for (const c of data.changes) counts[c.mode]++
    mode = same
        ? mode
        : counts.conflict
          ? 'conflict'
          : counts.manual
            ? 'manual'
            : counts.auto
              ? 'auto'
              : 'all'
    el('overview').hidden = true
    el('review').hidden = false
    el('back').hidden = false
    el('review-title').textContent = name ? 'Поездка ' + name : 'Поездка игрока'
    el('trip-state').textContent = labels[data.trip.state] || data.trip.state
    el('trip-state').className = 'badge state-' + data.trip.state
    el('trip-date').textContent = dateFormat.format(data.trip.updated * 1000)
    const area = data.area
    const full = area.scope === 'world'
    el('coordinates').textContent = full
        ? 'Весь мир' + (area.dimensions?.length ? ' · Измерений: ' + area.dimensions.length : '')
        : area.cx === undefined
          ? 'Офлайн-поездка'
          : 'Обычный мир · X ' +
            (area.cx - area.radius) * 16 +
            '…' +
            ((area.cx + area.radius + 1) * 16 - 1) +
            ' · Z ' +
            (area.cz - area.radius) * 16 +
            '…' +
            ((area.cz + area.radius + 1) * 16 - 1)
    el('trip-detail').textContent = data.trip.detail || ''
    el('trip-detail').hidden =
        !data.trip.detail || data.trip.detail === 'Требуется решение администратора.'
    showActivity(data.trip)
    document.querySelector('.changes-area').hidden = ['submitted', 'approved'].includes(data.trip.state)
    const reviewing = data.trip.state === 'review' && Boolean(data.trip.review)
    el('merge-plan').hidden = !reviewing
    el('plan-jump').hidden = !reviewing
    el('accept').hidden = !reviewing || counts.manual > 0
    el('accept-existing').hidden =
        !reviewing ||
        !counts.manual ||
        counts.manual === counts.all ||
        data.changes.some((c) => c.mode === 'manual' && c.kind !== 'new_chunk')
    el('revise').hidden = !reviewing
    el('keep').hidden = ['done', 'closed'].includes(data.trip.state)
    el('other-actions').hidden = ['accept', 'accept-existing', 'revise', 'keep'].every(
        (key) => el(key).hidden,
    )
    el('archives').hidden = !data.trip.review && !counts.all
    el('exports').replaceChildren(
        ...[
            ['base', 'Снимок до поездки'],
            ['live', 'Чанки сервера'],
            ['upload', 'Сохранение игрока'],
        ].map(([side, label]) => {
            const a = node('a', label, 'archive-link')
            a.href = api + '/trips/' + id + '/archive/' + side
            return a
        }),
    )
    el('plan').hidden = el('merge-plan').hidden && el('other-actions').hidden && el('archives').hidden
    el('map-tools').open = false
    el('other-actions').open = false
    el('archives').open = false
    el('map-tools').hidden = !data.changes.some((c) => c.pos)
    el('slices').hidden = true
    el('dimensions').hidden = !full
    selectedDimension = data.changes.find((c) => c.pos)?.dimension || 'minecraft:overworld'
    const map = el('map')
    map.replaceChildren()
    map.classList.toggle('whole-world', full)
    if (full) {
        dimensionControls(area.dimensions || Object.keys(dimensions))
        drawWorldTiles()
    } else if (area.cx !== undefined) {
        const tiles = new Map()
        for (const c of data.changes.filter((c) => c.pos)) {
            const key = chunkKey(c)
            const item = tiles.get(key) || { count: 0, rank: 0 }
            item.count++
            item.rank = Math.max(item.rank, { auto: 1, conflict: 2, manual: 3 }[c.mode])
            tiles.set(key, item)
        }
        for (let z = area.cz - area.radius; z <= area.cz + area.radius; z++)
            for (let x = area.cx - area.radius; x <= area.cx + area.radius; x++) {
                const key = x + ',' + z,
                    entry = tiles.get(key)
                const b = button(entry ? String(entry.count) : '·', () => selectTile(key))
                b.title = 'Чанк ' + key + ' · Изменений: ' + (entry?.count || 0)
                b.setAttribute('aria-label', b.title)
                b.dataset.tile = key
                b.className = ['', 'auto', 'conflict', 'manual'][entry?.rank || 0]
                map.append(b)
            }
    }
    setupFilters()
    updateMerge()
    render()
}
function chunkKey(c) {
    return Math.floor(c.pos[0] / 16) + ',' + Math.floor(c.pos[2] / 16)
}
function selectTile(key) {
    tile = key
    limit = 12
    mode = 'all'
    render()
}

function drawWorldTiles() {
    for (const control of el('dimensions').children)
        control.setAttribute('aria-pressed', String(control.dataset.dimension === selectedDimension))
    const map = el('map'),
        dimension = selectedDimension
    map.replaceChildren()
    const counts = new Map()
    for (const c of current.changes.filter((c) => c.pos && dimensionOf(c) === dimension)) {
        const key = Math.floor(c.pos[0] / 16) + ',' + Math.floor(c.pos[2] / 16)
        const entry = counts.get(key) || { count: 0, rank: 0, pos: c.pos }
        entry.count++
        entry.rank = Math.max(entry.rank, { auto: 1, conflict: 2, manual: 3 }[c.mode])
        counts.set(key, entry)
    }
    for (const [key, entry] of counts) {
        const b = button(key + ' · ' + entry.count, async () => {
            selectTile(key)
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
    limit = 12
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
    if (id.includes('planks') || id.includes('oak') || id.includes('spruce')) return '#b18a57'
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
        const values = image.layers.map((grid) => image.palette[grid[i]].replace('minecraft:', ''))
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
            ctx.strokeRect((target % 16) * 10 + 1, Math.floor(target / 16) * 10 + 1, 8, 8)
            cv.setAttribute('aria-label', title + ' · срез чанка на высоте ' + y)
            cv.onpointermove = (e) => {
                const r = cv.getBoundingClientRect()
                const col = Math.min(15, Math.max(0, Math.floor(((e.clientX - r.left) * 16) / r.width))),
                    row = Math.min(15, Math.max(0, Math.floor(((e.clientY - r.top) * 16) / r.height)))
                describe(row * 16 + col)
            }
            figure.append(node('figcaption', title), cv)
            return figure
        }),
    )
    describe(target)
}
function valueNode(raw) {
    const value = String(raw ?? '—')
    const box = node('div', undefined, 'value')
    if (materials[value]) {
        box.append(node('strong', materials[value]), node('code', value))
    } else if (value.length > 190) {
        const more = node('details', undefined, 'long-value')
        more.append(node('summary', 'Полное значение'), node('code', value))
        box.append(node('span', value.slice(0, 160) + '…'), more)
    } else {
        box.append(node(value.includes('minecraft:') ? 'code' : 'span', value))
    }
    return box
}
function changeCard(c, i) {
    const row = node('article', undefined, 'change')
    const head = node('header', undefined, 'change-head')
    head.append(node('h3', kinds[c.kind] || c.kind))
    if (mode === 'all')
        head.append(
            node(
                'span',
                { auto: 'Совместимо', manual: 'Ручной перенос', conflict: 'Конфликт' }[c.mode],
                'badge ' + (c.mode === 'conflict' ? 'state-review' : ''),
            ),
        )
    row.append(head)
    if (c.pos) {
        const info = node('div', undefined, 'location')
        info.append(
            node('span', dimensions[dimensionOf(c)] || dimensionOf(c)),
            node('code', 'X ' + c.pos[0] + '   Y ' + c.pos[1] + '   Z ' + c.pos[2]),
        )
        row.append(info)
    }
    const choosing =
        c.mode === 'conflict' && current.trip.state === 'review' && Boolean(current.trip.review)
    const group = node(choosing ? 'fieldset' : 'div', undefined, 'versions')
    if (choosing) group.append(node('legend', 'Версия после слияния', 'screen-reader'))
    for (const [key, field, title] of [
        ['server', 'live', choosing ? 'Оставить серверную' : 'На сервере'],
        ['player', 'after', choosing ? 'Взять у игрока' : 'У игрока'],
    ]) {
        const card = node('div', undefined, 'version' + (choosing ? ' selectable' : ''))
        const header = node(choosing ? 'label' : 'span', undefined, 'version-title')
        if (choosing) {
            const radio = node('input')
            radio.type = 'radio'
            radio.id = 'version-' + i + '-' + key
            radio.name = 'version-' + i
            radio.value = key
            radio.checked = (key === 'player') === playerChoices.has(c.key)
            radio.setAttribute('aria-describedby', radio.id + '-value')
            header.htmlFor = radio.id
            if (c.group === 'loot') radio.dataset.lootChoice = key
            radio.onchange = () => {
                const linked = c.group ? current.changes.filter((other) => other.mode === 'conflict' && other.group === c.group) : [c]
                for (const change of linked) {
                    if (key === 'player') playerChoices.add(change.key)
                    else playerChoices.delete(change.key)
                }
                if (c.group) {
                    for (const input of el('comparison').querySelectorAll('input[data-loot-choice]'))
                        input.checked = input.dataset.lootChoice === key
                }
                updateMerge()
            }
            header.append(radio)
        }
        header.append(document.createTextNode(title))
        const value = valueNode(c[field])
        if (choosing) value.id = 'version-' + i + '-' + key + '-value'
        card.append(header, value)
        group.append(card)
    }
    row.append(group)
    if (c.group === 'loot') row.append(node('p', 'Инвентарь и содержимое контейнеров переносятся вместе, чтобы предметы не дублировались.', 'muted'))
    const foot = node('div', undefined, 'change-foot')
    const baseline = node('div', undefined, 'baseline')
    baseline.append(node('span', 'До поездки'), valueNode(c.before))
    foot.append(baseline)
    if (c.pos)
        foot.append(
            button(
                'Показать на карте',
                async () => {
                    selectedDimension = dimensionOf(c)
                    el('map-tools').open = true
                    if (current.area.scope === 'world') drawWorldTiles()
                    await drawSlice(c.pos, selectedDimension)
                    el('map-tools').scrollIntoView({ block: 'start' })
                },
                'text-button',
            ),
        )
    row.append(foot)
    if (c.mode === 'manual') {
        const note = node('div', undefined, 'manual-note')
        note.append(
            node('span', 'Эта правка сохранится в архиве для ручного переноса.'),
            button(
                'Открыть архивы',
                () => {
                    el('archives').open = true
                    el('archives').querySelector('summary').focus()
                },
                'text-button',
            ),
        )
        row.append(note)
    }
    return row
}
function setupFilters() {
    el('filters').replaceChildren(
        ...Object.entries(modeTitles).map(([key, title]) => {
            const b = button('', () => {
                mode = key
                limit = 12
                render()
            })
            b.append(document.createTextNode(title + ' '), node('span', String(counts[key]), 'count'))
            b.dataset.mode = key
            b.setAttribute('aria-controls', 'comparison')
            return b
        }),
    )
}
function render() {
    const visible = current.changes.filter(
        (c) =>
            (mode === 'all' || mode === c.mode) &&
            (!tile || (c.pos && chunkKey(c) === tile && dimensionOf(c) === selectedDimension)),
    )
    for (const b of el('filters').children)
        b.setAttribute('aria-pressed', String(mode === b.dataset.mode))
    for (const b of el('map').children) b.setAttribute('aria-pressed', String(tile === b.dataset.tile))
    el('tile-scope').hidden = !tile
    el('tile-name').textContent = tile
        ? (dimensions[selectedDimension] || selectedDimension) + ' · Чанк ' + tile
        : ''

    el('comparison').replaceChildren(...visible.slice(0, limit).map(changeCard))
    if (!visible.length)
        el('comparison').append(
            node(
                'p',
                counts.all
                    ? 'В этой выборке изменений нет.'
                    : 'Для этой поездки ещё нет изменений для сравнения.',
                'empty',
            ),
        )
    el('more').hidden = visible.length <= limit
    el('more').textContent = 'Показать ещё · ' + Math.min(12, Math.max(0, visible.length - limit))
}
function fillPlan(target) {
    const rows = [
        ['Совместимые', counts.auto],
        ['Взять у игрока', playerChoices.size],
        ['Оставить на сервере', counts.conflict - playerChoices.size],
        ['Ручной перенос', counts.manual],
    ]
    target.replaceChildren(
        ...rows.map(([name, total]) => {
            const row = node('div')
            row.append(node('dt', name), node('dd', String(total)))
            return row
        }),
    )
}
function updateMerge() {
    fillPlan(el('merge-summary'))
    const n = counts.auto + playerChoices.size
    el('merge').disabled = n === 0
    el('plan-total').textContent = 'К применению: ' + n
    el('plan-note').textContent = n
        ? 'Сервер повторно сверит изменения перед записью.'
        : counts.conflict
          ? 'Можно выбрать версию игрока в карточке конфликта.'
          : 'Совместимых изменений для применения нет.'
}
const decisions = {
    merge: [
        'Применить изменения?',
        'Для остальных конфликтов сохранится серверная версия. Исходное сохранение останется в архиве.',
        'Применить',
    ],
    accept: [
        'Принять все версии игрока?',
        'Все конфликты будут решены в пользу игрока после повторной сверки.',
        'Принять все',
    ],
    'accept-existing': [
        'Применить без новых чанков?',
        'Сервер применит совместимые изменения и версии игрока для конфликтов. Новые чанки останутся в архиве.',
        'Применить',
    ],
    revise: [
        'Вернуть поездку игроку?',
        'Игрок сможет исправить эту же локальную копию и отправить её повторно.',
        'Вернуть на доработку',
    ],
    keep: [
        'Закрыть поездку?',
        'Сервер сохранит текущий мир. Изменения игрока останутся в архиве.',
        'Закрыть поездку',
    ],
}
for (const [id, [title, message, label]] of Object.entries(decisions)) {
    el(id).onclick = () => {
        const { id: tripId, review: fingerprint } = current.trip
        const name = current.name
        const payload = id === 'merge' ? { fingerprint, player: [...playerChoices] } : { fingerprint }
        confirmAction(
            title,
            message,
            id === 'merge' ? label + ' · ' + (counts.auto + playerChoices.size) : label,
            async () => {
                await request('/trips/' + tripId + '/' + id, payload)
                await openTrip(tripId, name)
            },
            id === 'merge',
        )
    }
}
el('confirm-action').onclick = () =>
    run(async () => {
        if (sending || !pendingAction) return
        sending = true
        el('confirm-action').disabled = true
        el('cancel').disabled = true
        try {
            await pendingAction()
        } finally {
            sending = false
            pendingAction = null
            el('confirm-action').disabled = false
            el('cancel').disabled = false
            el('confirm').close()
        }
    })
el('confirm').addEventListener('cancel', (e) => {
    if (sending) e.preventDefault()
})
el('confirm').addEventListener('close', () => {
    pendingAction = null
})
el('cancel').onclick = () => el('confirm').close()
el('all').onclick = () => {
    tile = null
    limit = 12
    render()
}
el('more').onclick = () => {
    const firstNew = el('comparison').children.length
    limit += 12
    render()
    const card = el('comparison').children[firstNew]
    if (card) {
        card.tabIndex = -1
        card.focus()
    }
}
el('trips-tab').onclick = () => selectSection(false)
el('access-tab').onclick = () => selectSection(true)
el('grant').onsubmit = (e) => {
    e.preventDefault()
    const submit = el('grant').querySelector('button')
    if (submit.disabled) return
    submit.disabled = true
    run(async () => {
        try {
            await request('/grant', { name: el('grant-name').value.trim(), scope: 'world' })
            el('grant-name').value = ''
            await refresh()
        } finally {
            submit.disabled = false
        }
    })
}
async function loadPage() {
    el('refresh').disabled = true
    el('loading').hidden = false
    try {
        const query = new URLSearchParams(location.search)
        const trip = query.get('trip'),
            player = query.get('player')
        const directTrip = Boolean(trip && /^[a-f0-9]{32}$/i.test(trip))
        el('overview').hidden = directTrip
        el('back').hidden = !directTrip
        const data = await refresh()
        if (directTrip) {
            const recent = data.trips.find((t) => t.id === trip)
            await openTrip(trip, recent?.name || data.users.find((u) => u.uid === player)?.name)
            if (!current.name) {
                const owner = data.users.find((u) => u.uid === current.trip.uid)
                if (owner) {
                    current.name = owner.name
                    el('review-title').textContent = 'Поездка ' + owner.name
                }
            }
        } else if (player && /^[a-f0-9]{32}$/i.test(player)) {
            selectSection(true)
            const row = el('player-' + player)
            if (row) {
                row.querySelector('button')?.focus()
                return
            }
            const field = el('grant-name')
            field.focus()
            const response = await fetch('/api/v1/admin/minecraft-profiles/' + player)
            if (response.ok) {
                const { data: profile } = await response.json()
                if (
                    !field.value &&
                    profile?.uuid?.replaceAll('-', '').toLowerCase() === player.toLowerCase() &&
                    /^[a-zA-Z0-9_]{1,16}$/.test(profile.name)
                )
                    field.value = profile.name
            }
        }
    } finally {
        el('refresh').disabled = false
        el('loading').hidden = true
    }
}
el('refresh').onclick = () => run(loadPage)
run(loadPage)
let polling = false
async function poll() {
    if (polling || document.hidden || !el('auth-state').hidden || el('refresh').disabled ||
        sending || pendingAction || (!current && !el('access').hidden)) return
    if (current && ['done', 'closed', 'failed'].includes(current.trip.state)) return
    polling = true
    const seq = tripRequest, id = current?.trip.id
    try {
        const trips = await request('/activity' + (id ? '?trip=' + encodeURIComponent(id) : ''))
        if (seq !== tripRequest || el('refresh').disabled || pendingAction || sending) return
        el('connection-note').hidden = true
        if (!id) renderQueue(trips)
        else if (trips[0]) {
            const t = trips[0]
            if (t.state !== current.trip.state || t.review !== current.trip.review || t.updated !== current.trip.updated)
                await openTrip(id, t.name)
            else showActivity(t)
        }
    } catch {
        el('connection-note').hidden = !el('auth-state').hidden
    } finally { polling = false }
}
setInterval(poll, 4000)
document.addEventListener('visibilitychange', poll)
