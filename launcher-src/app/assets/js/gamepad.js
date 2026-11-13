const DEAD_ZONE = 0.48

function readGamepad(pad) {
    const pressed = index => Boolean(pad.buttons[index]?.pressed)
    const [x = 0, y = 0, , rightY = 0] = pad.axes
    const horizontal = Number(pressed(15)) - Number(pressed(14))
    const vertical = Number(pressed(13)) - Number(pressed(12))
    const dx = horizontal || (vertical ? 0 : x)
    const dy = vertical || (horizontal ? 0 : y)
    const direction = Math.max(Math.abs(dx), Math.abs(dy)) < DEAD_ZONE ? null
        : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
    const select = pressed(0)
    const back = pressed(1)
    const keyboard = pressed(2)
    const tab = Number(pressed(5)) - Number(pressed(4))
    const scroll = Math.abs(rightY) > DEAD_ZONE ? rightY : 0
    return { direction, select, back, keyboard, tab, scroll, engaged: Boolean(direction || select || back || keyboard || tab || scroll) }
}

function findInDirection(current, elements, direction) {
    const source = current.getBoundingClientRect()
    const vertical = direction === 'up' || direction === 'down'
    const sign = direction === 'up' || direction === 'left' ? -1 : 1
    const primaryCenter = rect => vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2
    const secondaryCenter = rect => vertical ? rect.left + rect.width / 2 : rect.top + rect.height / 2
    let nearest = null
    let bestScore = Infinity
    for (const candidate of elements) {
        if (candidate === current) continue
        const rect = candidate.getBoundingClientRect()
        const distance = (primaryCenter(rect) - primaryCenter(source)) * sign
        if (distance <= 1) continue
        const alignment = Math.abs(secondaryCenter(rect) - secondaryCenter(source))
        const score = distance + alignment * 2
        if (score < bestScore) {
            nearest = candidate
            bestScore = score
        }
    }
    return nearest
}

module.exports = { findInDirection, readGamepad }
