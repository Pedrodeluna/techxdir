/** Recorta la foto en vertical (4:5) a 400×500 y la devuelve como data URL JPEG. */
export function cropPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const W = 400
      const H = 500
      let sw = img.naturalWidth
      let sh = img.naturalHeight
      let sx = 0
      let sy = 0
      if (sw / sh > W / H) { const nw = sh * W / H; sx = (sw - nw) / 2; sw = nw }
      else { const nh = sw * H / W; sy = (sh - nh) / 2; sh = nh }
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, W, H)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', .85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('imagen no válida'))
    }
    img.src = url
  })
}
