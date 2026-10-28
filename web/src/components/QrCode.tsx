import qrcode from 'qrcode-generator'

/**
 * A QR code, drawn as SVG rects from the module matrix — no `innerHTML`, no
 * canvas, so it scales crisply and prints. Error correction M: the code is shown
 * on a screen and read by a phone a hand away, where a damaged module is rare and
 * a smaller symbol is easier to frame.
 *
 * Always dark on white, whatever the theme: a phone camera reads an inverted QR
 * badly or not at all, and a white quiet zone is part of the symbol.
 */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()
  const n = qr.getModuleCount()
  const quiet = 4
  const cells: string[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) cells.push(`M${c + quiet} ${r + quiet}h1v1h-1z`)
    }
  }
  const box = n + quiet * 2
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
      data-testid="qr"
    >
      <rect width={box} height={box} fill="#fff" />
      <path d={cells.join('')} fill="#000" />
    </svg>
  )
}
