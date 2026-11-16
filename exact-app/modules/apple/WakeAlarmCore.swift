// Good Time's one wake-up alarm (LKM-696): the part that does not touch AlarmKit, so it compiles on
// every Apple host and its tests run on a Mac (`swift tools/wake-alarm-tests`, from `scripts/check`).
//
// - `WakeAlarmPlan.next` is the next future instant at a wall-clock "HH:MM" in a time zone, by
//   `Calendar` (midnight rollover, a DST gap or overlap), never by adding seconds.
// - `WakeAlarmController` holds the app's one alarm: the UUID AlarmKit knows it by is stored
//   (`WakeAlarmStore`), it is only ever cancelled by that UUID, a repeated tap for the same time
//   schedules nothing new, a tap while one is in flight is refused, and a new time replaces the old
//   alarm only after the new one is scheduled. It never reads or changes another app's alarms or
//   the Clock app's.
// - `WakeAlarmBackend` is AlarmKit (WakeAlarm.swift) or, under the agent and in tests, the fixture.
import Foundation

enum WakeAlarmAuth: String {
    /// No AlarmKit here: before iOS 26, macOS, the web.
    case unsupported
    case notDetermined
    case denied
    case authorized
}

enum WakeAlarmBackendError: Error {
    case notAuthorized
    case failed(String)
}

/// What the system says of one alarm: it has it (at this date), it does not, or it could not say.
enum WakeAlarmLookup: Equatable {
    case present(Date)
    case absent
    case unknown
}

/// The alarm's sound: the system's default or one of Good Time's own tones, bundled as
/// `assets/sounds/alarm-<id>.wav` (tools/alarm-tones.mjs; app.ts `ALARM_SOUNDS` lists the same ids).
/// AlarmKit plays a custom sound by file name from the app's main bundle or its `Library/Sounds`; the
/// tone is copied there under a name of its own, so where the build puts assets does not matter.
enum WakeAlarmSound {
    static let systemDefault = "default"
    static let tones = ["sunrise", "chime", "pulse"]

    /// A requested id the app has; anything else is the system's default.
    static func normalized(_ id: String?) -> String {
        guard let id, tones.contains(id) else { return systemDefault }
        return id
    }

    /// The name `AlertSound.named` is given, in `Library/Sounds`.
    static func installedName(_ id: String) -> String { "goodtime-alarm-\(id).wav" }

    /// Puts the tone's file in `library/Sounds` (again when the bundled one changed) and answers its
    /// name there; nil for the system's default, or when the tone is not in the bundle or cannot be
    /// copied, so the caller falls back to the default.
    static func install(_ id: String, bundleRoot: URL, library: URL, files: FileManager = .default) -> String? {
        let id = normalized(id)
        guard id != systemDefault else { return nil }
        let source = bundleRoot.appendingPathComponent("assets/sounds/alarm-\(id).wav")
        guard let data = try? Data(contentsOf: source), !data.isEmpty else { return nil }
        let dir = library.appendingPathComponent("Sounds", isDirectory: true)
        let target = dir.appendingPathComponent(installedName(id))
        if (try? Data(contentsOf: target)) == data { return installedName(id) }
        do {
            try files.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: target, options: .atomic)
            return installedName(id)
        } catch {
            return nil
        }
    }
}

/// What the system scheduled: when, and with which sound (the default if the tone was not there).
struct WakeAlarmScheduled: Equatable {
    var at: Date
    var sound: String
}

protocol WakeAlarmBackend: AnyObject {
    var auth: WakeAlarmAuth { get }
    func requestAuthorization() async -> WakeAlarmAuth
    /// Schedules a one-time alarm at `at` with `sound` (a `WakeAlarmSound` id); returns the date the
    /// system holds it for and the sound it was actually given.
    func schedule(id: UUID, at: Date, title: String, stop: String, sound: String) async throws -> WakeAlarmScheduled
    /// The system's alarm with this id: `absent` once it rang and was stopped or was removed;
    /// `unknown` when the list could not be read, which never drops the record.
    func lookup(id: UUID) -> WakeAlarmLookup
    /// Ends the alarm (stopping it if it is ringing); true when the system no longer has it.
    func cancel(id: UUID) -> Bool
}

struct WakeAlarmRecord: Codable, Equatable {
    var id: UUID
    var at: Date
    var hhmm: String
    /// The sound it rings with; nil in a record from before sounds, which rang the default.
    var sound: String?
    var soundID: String { WakeAlarmSound.normalized(sound) }
}

protocol WakeAlarmStore: AnyObject {
    var record: WakeAlarmRecord? { get set }
}

final class DefaultsWakeAlarmStore: WakeAlarmStore {
    private let defaults: UserDefaults
    private let key: String
    init(defaults: UserDefaults = .standard, key: String) { self.defaults = defaults; self.key = key }
    var record: WakeAlarmRecord? {
        get { defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(WakeAlarmRecord.self, from: $0) } }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) { defaults.set(data, forKey: key) }
            else { defaults.removeObject(forKey: key) }
        }
    }
}

final class MemoryWakeAlarmStore: WakeAlarmStore {
    var record: WakeAlarmRecord?
    init(_ record: WakeAlarmRecord? = nil) { self.record = record }
}

enum WakeAlarmPlan {
    /// "HH:MM" (24-hour) as hour and minute, or nil.
    static func parse(_ hhmm: String) -> (hour: Int, minute: Int)? {
        let parts = hhmm.split(separator: ":", omittingEmptySubsequences: false)
        // "HH:MM", or "HH:MM:SS" as an `input type="time"` may write it; seconds are ignored.
        guard (2...3).contains(parts.count), (1...2).contains(parts[0].count), parts[1].count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]), (0..<24).contains(h), (0..<60).contains(m) else { return nil }
        return (h, m)
    }

    /// The first instant strictly after `now` whose wall clock in `timeZone` reads `hhmm`. A time
    /// that a spring-forward skips is the first time that exists after it; one that a fall-back
    /// repeats is its first occurrence.
    static func next(_ hhmm: String, after now: Date, timeZone: TimeZone) -> Date? {
        guard let (hour, minute) = parse(hhmm) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.nextDate(after: now, matching: DateComponents(hour: hour, minute: minute, second: 0),
                                 matchingPolicy: .nextTime, repeatedTimePolicy: .first, direction: .forward)
    }
}

/// What the app shows: `scheduled` with its date, or why not.
struct WakeAlarmSnapshot: Equatable {
    var auth: WakeAlarmAuth
    var record: WakeAlarmRecord?
    /// "" or what the last request ran into: unsupported, denied, invalid, busy, failed.
    var error: String = ""

    var json: [String: Any] {
        ["available": auth != .unsupported, "auth": auth.rawValue, "scheduled": record != nil,
         "at": record.map { $0.at.timeIntervalSince1970 * 1000 } ?? 0, "hhmm": record?.hhmm ?? "", "error": error,
         "sound": record?.soundID ?? ""]
    }
}

@MainActor
final class WakeAlarmController {
    let backend: WakeAlarmBackend?
    let store: WakeAlarmStore
    private var inFlight = false

    init(backend: WakeAlarmBackend?, store: WakeAlarmStore) {
        self.backend = backend
        self.store = store
    }

    private var auth: WakeAlarmAuth { backend?.auth ?? .unsupported }

    /// The stored alarm, if the system still has it; a record whose alarm is gone is dropped. The
    /// system's own date wins over the stored one.
    func status() -> WakeAlarmSnapshot {
        guard let backend else { return WakeAlarmSnapshot(auth: .unsupported, record: nil) }
        guard var record = store.record else { return WakeAlarmSnapshot(auth: backend.auth, record: nil) }
        switch backend.lookup(id: record.id) {
        case .absent:
            store.record = nil
            return WakeAlarmSnapshot(auth: backend.auth, record: nil)
        case .unknown:
            // The list could not be read: the record stands, so the alarm can still be cancelled.
            return WakeAlarmSnapshot(auth: backend.auth, record: record)
        case .present(let date):
            if date != record.at { record.at = date; store.record = record }
            return WakeAlarmSnapshot(auth: backend.auth, record: record)
        }
    }

    /// Sets the alarm for the next `hhmm` in `timeZone` after `now`. Asks for permission first when
    /// the person has not been asked. Answers the alarm the system now holds, or the error and the
    /// alarm that was there before (kept on any failure).
    func set(_ hhmm: String, timeZone: TimeZone, now: Date, title: String, stop: String = "Stop",
             sound requested: String = WakeAlarmSound.systemDefault) async -> WakeAlarmSnapshot {
        let sound = WakeAlarmSound.normalized(requested)
        guard let backend else { return WakeAlarmSnapshot(auth: .unsupported, record: nil, error: "unsupported") }
        if inFlight { return with(status(), error: "busy") }
        inFlight = true
        defer { inFlight = false }
        let current = status()
        guard let target = WakeAlarmPlan.next(hhmm, after: now, timeZone: timeZone) else { return with(current, error: "invalid") }
        // The same alarm again (time and sound): nothing new is scheduled.
        if let record = current.record, record.at == target, record.hhmm == hhmm, record.soundID == sound { return current }
        var auth = backend.auth
        if auth == .notDetermined { auth = await backend.requestAuthorization() }
        guard auth == .authorized else { return with(status(), error: auth == .unsupported ? "unsupported" : "denied") }
        let id = UUID()
        let scheduled: WakeAlarmScheduled
        do {
            scheduled = try await backend.schedule(id: id, at: target, title: title, stop: stop, sound: sound)
        } catch WakeAlarmBackendError.notAuthorized {
            return with(status(), error: "denied")
        } catch {
            return with(status(), error: "failed")
        }
        // The new one is set: only now does the one it replaces go, and only ours, by its id. If the
        // old one will not go, the new one is taken back, so there are never two.
        if let old = store.record, old.id != id, !backend.cancel(id: old.id) {
            if backend.cancel(id: id) { return with(status(), error: "failed") }
            // Neither went: keep the new one (the one asked for); the old id stays unreachable.
        }
        let record = WakeAlarmRecord(id: id, at: scheduled.at, hhmm: hhmm, sound: WakeAlarmSound.normalized(scheduled.sound))
        store.record = record
        // The system's answer to `schedule`, not a re-read its list may not have caught up with.
        return WakeAlarmSnapshot(auth: backend.auth, record: record)
    }

    /// Cancels the app's own alarm, by its stored id. Nothing else is touched. If the system still
    /// has it afterwards, the record stays and the error says so.
    func cancel() -> WakeAlarmSnapshot {
        if inFlight { return with(status(), error: "busy") }
        guard let backend, let record = store.record else { return status() }
        guard backend.cancel(id: record.id) else { return with(status(), error: "failed") }
        store.record = nil
        return status()
    }

    private func with(_ snapshot: WakeAlarmSnapshot, error: String) -> WakeAlarmSnapshot {
        var s = snapshot
        s.error = error
        return s
    }
}

/// The alarm system under the agent and in tests: nothing reaches AlarmKit. Its permission is
/// `initial` until asked; asked, it becomes `answer`.
final class FixtureWakeAlarmBackend: WakeAlarmBackend {
    private(set) var auth: WakeAlarmAuth
    let answer: WakeAlarmAuth
    var alarms: [UUID: Date] = [:]
    var failNext = false
    /// The list cannot be read (`lookup` answers unknown).
    var unreadable = false
    /// Ids whose cancel does not take.
    var stuck: Set<UUID> = []
    private(set) var scheduleCount = 0
    /// The sound each scheduled alarm was given.
    private(set) var sounds: [UUID: String] = [:]
    /// Tones that are not in the bundle: they fall back to the default, as AlarmKit's backend does.
    var missingTones: Set<String> = []
    private(set) var cancelled: [UUID] = []
    /// Called inside `schedule`, before it answers: a test's second tap lands here.
    var duringSchedule: (() async -> Void)?

    init(auth: WakeAlarmAuth, answer: WakeAlarmAuth = .authorized) {
        self.auth = auth
        self.answer = answer
    }

    /// `GoodTimeAlarmFixture` (a launch default): unsupported (the default), prompt, prompt-deny,
    /// denied or authorized.
    static func named(_ name: String?) -> FixtureWakeAlarmBackend? {
        switch name {
        case "prompt": return FixtureWakeAlarmBackend(auth: .notDetermined)
        case "prompt-deny": return FixtureWakeAlarmBackend(auth: .notDetermined, answer: .denied)
        case "denied": return FixtureWakeAlarmBackend(auth: .denied)
        case "authorized": return FixtureWakeAlarmBackend(auth: .authorized)
        case "failing":
            let f = FixtureWakeAlarmBackend(auth: .authorized)
            f.failNext = true
            return f
        default: return nil
        }
    }

    func requestAuthorization() async -> WakeAlarmAuth {
        if auth == .notDetermined { auth = answer }
        return auth
    }

    func schedule(id: UUID, at: Date, title: String, stop: String, sound: String) async throws -> WakeAlarmScheduled {
        scheduleCount += 1
        if let duringSchedule { await duringSchedule() }
        guard auth == .authorized else { throw WakeAlarmBackendError.notAuthorized }
        if failNext { failNext = false; throw WakeAlarmBackendError.failed("fixture") }
        alarms[id] = at
        let given = missingTones.contains(sound) ? WakeAlarmSound.systemDefault : WakeAlarmSound.normalized(sound)
        sounds[id] = given
        return WakeAlarmScheduled(at: at, sound: given)
    }

    func lookup(id: UUID) -> WakeAlarmLookup {
        if unreadable { return .unknown }
        return alarms[id].map { .present($0) } ?? .absent
    }

    func cancel(id: UUID) -> Bool {
        cancelled.append(id)
        if stuck.contains(id) { return false }
        alarms[id] = nil
        return true
    }
}
