// LKM-771: clears Exact's frame-health presentation probe from a development-build screenshot. The probe is a
// transparent 1-point Metal layer at the window's top-left (ExactKit PresentationProbeIOS.swift) that the iOS
// Simulator composites as an opaque black square; release builds ("demand" frame health) do not install it.
// Only a top-left square that is black where its neighbour is not is repainted, with that neighbour's colour.
//   swift scripts/appstore-screenshot-probe.swift <png> …
import AppKit

for path in CommandLine.arguments.dropFirst() {
    guard let data = FileManager.default.contents(atPath: path), let rep = NSBitmapImageRep(data: data) else {
        FileHandle.standardError.write("cannot read \(path)\n".data(using: .utf8)!); exit(1)
    }
    let size = 4 // 1 point at 3x, and its antialiased edge
    guard let corner = rep.colorAt(x: 0, y: 0), let ground = rep.colorAt(x: size + 2, y: size + 2),
          corner.brightnessComponent < 0.05, ground.brightnessComponent > 0.2 else { continue }
    for y in 0..<size { for x in 0..<size { rep.setColor(ground, atX: x, y: y) } }
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
    print("cleared the probe square in \(path)")
}
