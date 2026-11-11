// LKM-652: one scripted journey, the same for the SwiftUI app and the Exact app (whichever is installed under
// com.alikimovich.good-time-to-sleep). Every tap is a real touch through XCTest, and each is followed by a
// 1.5 s pause, so each transition finishes before the next one and the probe's 1.2 s motion window after a
// touch covers it. The probe (GTPerfProbe.dylib, injected through launchEnvironment) records the frames.
import XCTest

final class MotionTests: XCTestCase {
    let pause: TimeInterval = 1.5

    func testJourney() throws {
        let env = ProcessInfo.processInfo.environment
        let app = XCUIApplication(bundleIdentifier: "com.alikimovich.good-time-to-sleep")
        if let probe = env["GTPERF_PROBE"] { app.launchEnvironment["DYLD_INSERT_LIBRARIES"] = probe }
        let rounds = Int(env["GTPERF_ROUNDS"] ?? "") ?? 3
        app.launch()

        // The intro (a fresh install shows it): its arrow, "⟼" in SwiftUI, "Continue" (intro-continue) in Exact.
        let arrow = first(app, [
            app.buttons["intro-continue"], app.buttons["Continue"], app.buttons["⟼"],
        ])
        XCTAssertNotNil(arrow, "no intro arrow:\n\(app.debugDescription)")
        Thread.sleep(forTimeInterval: pause)
        arrow?.tap()
        Thread.sleep(forTimeInterval: pause)

        let bed = app.tabBars.buttons["Bed Time"], wake = app.tabBars.buttons["Wake Up"]
        XCTAssertTrue(bed.waitForExistence(timeout: 5), "no Bed Time tab:\n\(app.debugDescription)")
        for _ in 0..<rounds {
            bed.tap(); Thread.sleep(forTimeInterval: pause)
            wake.tap(); Thread.sleep(forTimeInterval: pause)
        }

        // Settings, pushed from Wake Up, and back.
        let settings = first(app, [
            app.buttons["wakeup-settings"], app.buttons["Settings"], app.buttons["gearshape.fill"], app.buttons["Gear"],
        ])
        XCTAssertNotNil(settings, "no settings button:\n\(app.debugDescription)")
        for _ in 0..<rounds {
            settings?.tap(); Thread.sleep(forTimeInterval: pause)
            let back = app.navigationBars.buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 5), "no back button:\n\(app.debugDescription)")
            back.tap(); Thread.sleep(forTimeInterval: pause)
        }

        // Home: the probe writes its frame summary when the app enters the background.
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: pause)
    }

    private func first(_ app: XCUIApplication, _ candidates: [XCUIElement]) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(10)
        repeat {
            if let hit = candidates.first(where: { $0.exists && $0.isHittable }) { return hit }
            Thread.sleep(forTimeInterval: 0.2)
        } while Date() < deadline
        return nil
    }
}
