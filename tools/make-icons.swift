// Renders the extension icon at every size Safari and the app need.
// Usage: swift tools/make-icons.swift <output-dir>
// Design: a white "dome" (Atmos height layer) over a floor line, with an
// equaliser inside and one glowing sound "object" orbiting on the dome,
// on an indigo → magenta gradient tile.
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let sizes = [16, 19, 32, 38, 48, 64, 96, 128, 256, 512, 1024]

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext
    let space = CGColorSpaceCreateDeviceRGB()
    func c(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
        CGColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
                blue: CGFloat(hex & 255) / 255, alpha: a)
    }

    // Tile
    let tile = CGPath(roundedRect: CGRect(x: 0, y: 0, width: s, height: s),
                      cornerWidth: s * 0.235, cornerHeight: s * 0.235, transform: nil)
    ctx.saveGState()
    ctx.addPath(tile); ctx.clip()
    let grad = CGGradient(colorsSpace: space, colors: [c(0x5B5BF7), c(0x8B3DF0), c(0xE0459B)] as CFArray,
                          locations: [0, 0.55, 1])!
    ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: s), end: CGPoint(x: s, y: 0), options: [])
    // soft top highlight
    let hi = CGGradient(colorsSpace: space, colors: [c(0xFFFFFF, 0.22), c(0xFFFFFF, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(hi, startCenter: CGPoint(x: s * 0.3, y: s * 0.95), startRadius: 0,
                           endCenter: CGPoint(x: s * 0.3, y: s * 0.95), endRadius: s * 0.75, options: [])
    ctx.restoreGState()

    let white = c(0xFFFFFF)
    let cx = s * 0.5, floorY = s * 0.33, r = s * 0.31
    let lw = max(1.2, s * 0.058)

    // Floor
    ctx.setStrokeColor(white); ctx.setLineCap(.round); ctx.setLineWidth(lw)
    ctx.move(to: CGPoint(x: s * 0.16, y: floorY)); ctx.addLine(to: CGPoint(x: s * 0.84, y: floorY)); ctx.strokePath()

    // Dome
    ctx.addArc(center: CGPoint(x: cx, y: floorY), radius: r, startAngle: 0, endAngle: .pi, clockwise: false)
    ctx.strokePath()

    // Equaliser bars inside the dome
    if px >= 32 {
        let heights: [CGFloat] = [0.08, 0.15, 0.20, 0.15, 0.08]
        let bw = s * 0.045, gap = s * 0.03
        let total = CGFloat(heights.count) * bw + CGFloat(heights.count - 1) * gap
        var x = cx - total / 2
        ctx.setFillColor(c(0xFFFFFF, 0.92))
        for h in heights {
            let rect = CGRect(x: x, y: floorY + lw * 0.9, width: bw, height: s * h)
            ctx.addPath(CGPath(roundedRect: rect, cornerWidth: bw / 2, cornerHeight: bw / 2, transform: nil))
            ctx.fillPath()
            x += bw + gap
        }
    }

    // Orbiting sound object with glow
    let ang = CGFloat.pi * 0.27
    let p = CGPoint(x: cx + r * cos(ang), y: floorY + r * sin(ang))
    let dot = max(1.6, s * 0.06)
    let glow = CGGradient(colorsSpace: space, colors: [c(0xFFF3B0, 0.9), c(0xFFF3B0, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(glow, startCenter: p, startRadius: 0, endCenter: p, endRadius: dot * 2.6, options: [])
    ctx.setFillColor(c(0xFFF7C8))
    ctx.fillEllipse(in: CGRect(x: p.x - dot, y: p.y - dot, width: dot * 2, height: dot * 2))

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
for px in sizes {
    try render(px).write(to: URL(fileURLWithPath: "\(outDir)/icon-\(px).png"))
}
print("wrote \(sizes.count) icons to \(outDir)")
