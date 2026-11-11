// The UI-test bundle needs a host application; the tests drive Good Time by its bundle ID, not this.
import SwiftUI

@main
struct GTPerfHostApp: App {
    var body: some Scene { WindowGroup { Text("Good Time perf runner") } }
}
