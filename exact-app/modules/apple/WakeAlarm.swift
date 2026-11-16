// Good Time's native module (LKM-696): the wake-up alarm, through Apple's AlarmKit on iOS 26 and
// later. The alarm is Good Time's own system alarm: it rings through silent mode and Focus with the
// system's alert and Stop button, and shows in Settings > Good Time > Alarms. It is not an entry in
// the Clock app, which has no public API for that.
//
// No countdown (no snooze, no pre-alert): an alarm with a countdown needs a Live Activity widget
// extension, which needs an App ID and provisioning profile of its own.
//
// AlarmKit is weak-linked (app.json `host.ios.link`); before iOS 26, on macOS and on the web the
// module answers `unsupported`, and the app says so instead of falling back to a notification.
// Under the agent nothing reaches AlarmKit: the fixture answers (`GoodTimeAlarmFixture`, a launch
// default; unset, it is `unsupported`, as the web and macOS are; `system` drives the real AlarmKit
// path on a simulator).
//
// `native.later` requests (app.ts):
//   {op: "status"}
//   {op: "set", hhmm: "07:15", timeZone: "Europe/Madrid", title: "Wake up", sound: "chime", now: <ms, agent only>}
//   {op: "cancel"}
// Each answers WakeAlarmSnapshot.json. A change says `changed("alarm")`.
import Foundation
#if os(iOS)
import ActivityKit
import AlarmKit
import SwiftUI
#endif

final class GoodTimeModule: ExactModule {
    private var controller: WakeAlarmController?
    private var watching: [Task<Void, Never>] = []

    @MainActor
    private func alarm() -> WakeAlarmController {
        if let controller { return controller }
        let made: WakeAlarmController
        if context.agent && UserDefaults.standard.string(forKey: "GoodTimeAlarmFixture") == "system" {
            // A simulator drive of the real AlarmKit path (never a phone's): its own record.
            made = WakeAlarmController(backend: Self.system(), store: DefaultsWakeAlarmStore(key: "goodtime.wakeAlarm.agent"))
            watch()
        } else if context.agent {
            let fixture = FixtureWakeAlarmBackend.named(UserDefaults.standard.string(forKey: "GoodTimeAlarmFixture"))
            made = WakeAlarmController(backend: fixture, store: MemoryWakeAlarmStore())
        } else {
            made = WakeAlarmController(backend: Self.system(), store: DefaultsWakeAlarmStore(key: "goodtime.wakeAlarm"))
            watch()
        }
        controller = made
        return made
    }

    private static func system() -> WakeAlarmBackend? {
        #if os(iOS)
        if #available(iOS 26.0, *) { return AlarmKitWakeAlarmBackend() }
        #endif
        return nil
    }

    /// The person may stop the alarm on the Lock Screen or turn alarms off in Settings while the
    /// app is away: both are read again.
    private func watch() {
        #if os(iOS)
        if #available(iOS 26.0, *), watching.isEmpty {
            let changed = context.changed
            watching = [
                Task { for await _ in AlarmManager.shared.alarmUpdates { changed("alarm") } },
                Task { for await _ in AlarmManager.shared.authorizationUpdates { changed("alarm") } },
            ]
        }
        #endif
    }

    override func later(_ request: [String: Any], reply: ExactReply) {
        let op = request["op"] as? String ?? ""
        let hhmm = request["hhmm"] as? String ?? ""
        let zone = (request["timeZone"] as? String).flatMap(TimeZone.init(identifier:)) ?? .current
        let title = (request["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Wake up"
        let stop = (request["stop"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Stop"
        let sound = WakeAlarmSound.normalized(request["sound"] as? String)
        let agentNow = (request["now"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
        Task { @MainActor in
            let controller = self.alarm()
            switch op {
            case "status":
                reply.send(controller.status().json)
            case "set":
                // The session's clock under the agent, so a drive repeats; the device's otherwise.
                let now = self.context.agent ? (agentNow ?? Date()) : Date()
                let snapshot = await controller.set(hhmm, timeZone: zone, now: now, title: title, stop: stop, sound: sound)
                reply.send(snapshot.json)
                self.context.changed("alarm")
            case "cancel":
                reply.send(controller.cancel().json)
                self.context.changed("alarm")
            default:
                reply.fail("GoodTimeModule answers status, set and cancel")
            }
        }
    }

    override func destroy() {
        watching.forEach { $0.cancel() }
        watching = []
    }
}

let exactModule: ExactModule.Type = GoodTimeModule.self

#if os(iOS)
@available(iOS 26.0, *)
struct GoodTimeAlarmMetadata: AlarmMetadata {}

@available(iOS 26.0, *)
final class AlarmKitWakeAlarmBackend: WakeAlarmBackend {
    private var manager: AlarmManager { .shared }

    var auth: WakeAlarmAuth {
        switch manager.authorizationState {
        case .authorized: return .authorized
        case .denied: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }

    func requestAuthorization() async -> WakeAlarmAuth {
        _ = try? await manager.requestAuthorization()
        return auth
    }

    func schedule(id: UUID, at: Date, title: String, stop: String, sound: String) async throws -> WakeAlarmScheduled {
        // A tone is given by its name in Library/Sounds; one that is not there rings the default.
        let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first
        let installed = library.flatMap { WakeAlarmSound.install(sound, bundleRoot: Bundle.main.bundleURL, library: $0) }
        let alertSound: AlertConfiguration.AlertSound = installed.map { .named($0) } ?? .default
        let given = installed == nil ? WakeAlarmSound.systemDefault : WakeAlarmSound.normalized(sound)
        let text = LocalizedStringResource(String.LocalizationValue(title))
        let alert: AlarmPresentation.Alert
        if #available(iOS 26.1, *) {
            alert = AlarmPresentation.Alert(title: text)
        } else {
            // 26.0 takes the Stop button from the app; 26.1 draws the system's own.
            alert = AlarmPresentation.Alert(title: text, stopButton: AlarmButton(text: LocalizedStringResource(String.LocalizationValue(stop)), textColor: .white, systemImageName: "stop.circle"))
        }
        let attributes = AlarmAttributes<GoodTimeAlarmMetadata>(presentation: AlarmPresentation(alert: alert), metadata: nil, tintColor: .orange)
        let configuration = AlarmManager.AlarmConfiguration<GoodTimeAlarmMetadata>.alarm(schedule: .fixed(at), attributes: attributes, sound: alertSound)
        do {
            let alarm = try await manager.schedule(id: id, configuration: configuration)
            if case .fixed(let date)? = alarm.schedule { return WakeAlarmScheduled(at: date, sound: given) }
            return WakeAlarmScheduled(at: at, sound: given)
        } catch {
            if manager.authorizationState != .authorized { throw WakeAlarmBackendError.notAuthorized }
            throw WakeAlarmBackendError.failed(String(describing: error))
        }
    }

    func lookup(id: UUID) -> WakeAlarmLookup {
        guard let listed = try? manager.alarms else { return .unknown }
        guard let alarm = listed.first(where: { $0.id == id }) else { return .absent }
        if case .fixed(let date)? = alarm.schedule { return .present(date) }
        return .unknown
    }

    func cancel(id: UUID) -> Bool {
        let ringing = (try? manager.alarms)?.first(where: { $0.id == id })?.state == .alerting
        try? manager.cancel(id: id)
        // `cancel` may leave a ringing alarm ringing (Exact's packages/alarms measures this): stop it.
        if ringing || lookup(id: id) != .absent { try? manager.stop(id: id) }
        return lookup(id: id) == .absent
    }
}
#endif
