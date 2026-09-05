const { inferModelType, loadSkinToCanvas } = require('skinview-utils')

// Normalize legacy skins before drawing, including their mirrored limbs and hat transparency.
exports.prepareSkin = (image, canvas) => {
    if (image.width < 64 || image.width % 64 || ![image.width, image.width / 2].includes(image.height)) throw new Error('Нужен скин Minecraft: 64 × 64, 64 × 32 или их HD-вариант.')
    loadSkinToCanvas(canvas, image)
    return image.height * 2 === image.width ? 'default' : inferModelType(canvas)
}

exports.drawSkin = (ctx, skin, model) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.imageSmoothingEnabled = false
    const unit = skin.width / 64, scale = 6, x = 56, y = 24, arm = model === 'slim' ? 3 : 4
    const draw = (sx, sy, w, h, dx, dy) => ctx.drawImage(skin, sx * unit, sy * unit, w * unit, h * unit, dx, dy, w * scale, h * scale)
    draw(8, 8, 8, 8, x, y)
    draw(20, 20, 8, 12, x, y + 48)
    draw(44, 20, arm, 12, x - arm * scale, y + 48)
    draw(36, 52, arm, 12, x + 48, y + 48)
    draw(4, 20, 4, 12, x, y + 120)
    draw(20, 52, 4, 12, x + 24, y + 120)
    draw(20, 36, 8, 12, x, y + 48)
    draw(44, 36, arm, 12, x - arm * scale, y + 48)
    draw(52, 52, arm, 12, x + 48, y + 48)
    draw(4, 36, 4, 12, x, y + 120)
    draw(4, 52, 4, 12, x + 24, y + 120)
    draw(40, 8, 8, 8, x, y)
}
