// Tests of modules/apple/WakeAlarmCore.swift: the date, the permission and the one alarm.
// Run: bun tools/wake-alarm-tests.mjs (compiles this file with the core for the Mac and runs it).
import Foundation

var failures = 0
var count = 0
func check(_ ok: Bool, _ what: String, file: String = #file, line: Int = #line) {
    count += 1
    if !ok { failures += 1; print("FAIL \(what) (line \(line))") }
}

let iso = ISO8601DateFormatter()
func d(_ s: String) -> Date { iso.date(from: s)! }
func tz(_ id: String) -> TimeZone { TimeZone(identifier: id)! }

// MARK: the date

check(WakeAlarmPlan.next("08:00", after: d("2026-03-15T22:00:00Z"), timeZone: tz("UTC")) == d("2026-03-16T08:00:00Z"),
      "an evening tap rings tomorrow morning")
check(WakeAlarmPlan.next("23:30", after: d("2026-03-15T22:00:00Z"), timeZone: tz("UTC")) == d("2026-03-15T23:30:00Z"),
      "a later time today rings today")
check(WakeAlarmPlan.next("22:00", after: d("2026-03-15T22:00:00Z"), timeZone: tz("UTC")) == d("2026-03-16T22:00:00Z"),
      "the time now is tomorrow's, never the past")
check(WakeAlarmPlan.next("00:00", after: d("2026-12-31T23:59:30Z"), timeZone: tz("UTC")) == d("2027-01-01T00:00:00Z"),
      "midnight rolls over into the new year")
check(WakeAlarmPlan.next("07:00", after: d("2026-03-15T22:00:00Z"), timeZone: tz("Europe/Moscow")) == d("2026-03-16T04:00:00Z"),
      "the wall clock of the zone given (Moscow, UTC+3)")
check(WakeAlarmPlan.next("07:00", after: d("2026-03-15T22:00:00Z"), timeZone: tz("America/Los_Angeles")) == d("2026-03-16T14:00:00Z"),
      "a zone west of UTC, still the evening before")
// US spring-forward 2026-03-08: 02:00 EST becomes 03:00 EDT. 7:00 the morning after is 11:00Z, not 12:00Z.
check(WakeAlarmPlan.next("07:00", after: d("2026-03-08T03:00:00Z"), timeZone: tz("America/New_York")) == d("2026-03-08T11:00:00Z"),
      "7:00 on the spring-forward morning is 7:00 EDT")
// 02:30 does not exist that night: the next time that does, 03:00 EDT (07:00Z).
check(WakeAlarmPlan.next("02:30", after: d("2026-03-08T05:00:00Z"), timeZone: tz("America/New_York")) == d("2026-03-08T07:00:00Z"),
      "a skipped time rings at the first time after the gap")
// US fall-back 2026-11-01: 01:30 happens twice; the first (EDT, 05:30Z).
check(WakeAlarmPlan.next("01:30", after: d("2026-11-01T03:00:00Z"), timeZone: tz("America/New_York")) == d("2026-11-01T05:30:00Z"),
      "a repeated time rings at its first occurrence")
check(WakeAlarmPlan.next("08:00", after: d("2026-11-01T03:00:00Z"), timeZone: tz("America/New_York")) == d("2026-11-01T13:00:00Z"),
      "8:00 on the fall-back morning is 8:00 EST")
check(WakeAlarmPlan.next("8:5", after: d("2026-03-15T22:00:00Z"), timeZone: tz("UTC")) == nil, "a malformed time is refused")
check(WakeAlarmPlan.next("24:00", after: d("2026-03-15T22:00:00Z"), timeZone: tz("UTC")) == nil, "24:00 is refused")
check(WakeAlarmPlan.parse("07:05")! == (7, 5), "HH:MM parses")

// MARK: the controller

let now = d("2026-03-15T22:00:00Z")
let utc = tz("UTC")

@MainActor func run() async {
    // Unsupported: no backend.
    do {
        let c = WakeAlarmController(backend: nil, store: MemoryWakeAlarmStore())
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(s.auth == .unsupported && s.record == nil && s.error == "unsupported", "no AlarmKit: unsupported, nothing set")
        check(s.json["available"] as? Bool == false, "unsupported says available false")
    }
    // Asked on the tap, allowed: scheduled at the next 8:00.
    do {
        let f = FixtureWakeAlarmBackend(auth: .notDetermined)
        let store = MemoryWakeAlarmStore()
        let c = WakeAlarmController(backend: f, store: store)
        check(c.status().auth == .notDetermined && f.scheduleCount == 0, "nothing is asked or scheduled before a tap")
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(s.auth == .authorized && s.error == "", "the tap asks and is allowed")
        check(s.record?.at == d("2026-03-16T08:00:00Z") && f.scheduleCount == 1, "scheduled once, at the next 8:00")
        check(store.record?.id == s.record?.id && f.alarms[s.record!.id] != nil, "the alarm's id is stored")
        check((s.json["at"] as? Double) == d("2026-03-16T08:00:00Z").timeIntervalSince1970 * 1000, "json carries the instant in ms")
        // The same time again: nothing new.
        let again = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(f.scheduleCount == 1 && again.record == s.record && f.alarms.count == 1, "the same time again schedules nothing")
        // A new time: the new one is set, then the old one goes, by its id only.
        let moved = await c.set("06:30", timeZone: utc, now: now, title: "Wake up")
        check(f.scheduleCount == 2 && f.alarms.count == 1 && f.cancelled == [s.record!.id], "a new time replaces the old alarm")
        check(moved.record?.at == d("2026-03-16T06:30:00Z") && store.record?.id == moved.record?.id, "the new alarm is stored")
        // Cancel: ours only.
        let foreign = UUID()
        f.alarms[foreign] = d("2026-03-17T05:00:00Z")
        let gone = c.cancel()
        check(gone.record == nil && store.record == nil && f.alarms[foreign] != nil, "cancel removes ours and no other")
        check(f.cancelled == [s.record!.id, moved.record!.id], "cancel names only the stored id")
    }
    // Asked on the tap, refused: nothing scheduled, denied said.
    do {
        let f = FixtureWakeAlarmBackend(auth: .notDetermined, answer: .denied)
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore())
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(s.auth == .denied && s.error == "denied" && s.record == nil && f.scheduleCount == 0, "refused: nothing scheduled")
    }
    // Already denied (in Settings): not asked again, nothing scheduled.
    do {
        let f = FixtureWakeAlarmBackend(auth: .denied, answer: .authorized)
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore())
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(s.error == "denied" && f.auth == .denied && f.scheduleCount == 0, "denied stays denied and schedules nothing")
    }
    // The system fails: the old alarm stays, and no success is claimed.
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore())
        let first = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        f.failNext = true
        let s = await c.set("07:00", timeZone: utc, now: now, title: "Wake up")
        check(s.error == "failed" && s.record == first.record && f.alarms.count == 1 && f.cancelled.isEmpty, "a failed schedule keeps the old alarm")
    }
    // A second tap while the first is in flight: refused, one alarm.
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore())
        var second: WakeAlarmSnapshot?
        f.duringSchedule = { second = await c.set("08:00", timeZone: utc, now: now, title: "Wake up") }
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(second?.error == "busy" && f.scheduleCount == 1 && f.alarms.count == 1 && s.error == "", "a tap in flight is refused")
    }
    // Reconcile: the system no longer has it (it rang and was stopped): the record goes.
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let store = MemoryWakeAlarmStore()
        let c = WakeAlarmController(backend: f, store: store)
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        f.alarms[s.record!.id] = nil
        check(c.status().record == nil && store.record == nil, "a gone alarm is dropped at the next read")
        // After it rang, the same time again schedules a new one.
        let again = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(f.scheduleCount == 2 && again.record != nil, "after it is gone, the same time schedules again")
    }
    // The list cannot be read: the record stays (never a forgotten alarm, never a duplicate).
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let store = MemoryWakeAlarmStore()
        let c = WakeAlarmController(backend: f, store: store)
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        f.unreadable = true
        check(c.status().record == s.record && store.record == s.record, "an unreadable list keeps the record")
        let again = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(f.scheduleCount == 1 && again.record == s.record, "and a tap for its time still does not duplicate it")
    }
    // set answers what schedule returned, even before the system's list shows it.
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore())
        f.unreadable = true
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(s.record?.at == d("2026-03-16T08:00:00Z") && s.error == "", "set answers the scheduled alarm without re-reading the list")
    }
    // A cancel that does not take: the record stays and the error says so.
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let store = MemoryWakeAlarmStore()
        let c = WakeAlarmController(backend: f, store: store)
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        f.stuck = [s.record!.id]
        let gone = c.cancel()
        check(gone.error == "failed" && gone.record == s.record && store.record == s.record, "a failed cancel keeps the record")
        // Replacing it: the old will not go, so the new one is taken back; still one alarm.
        let moved = await c.set("06:30", timeZone: utc, now: now, title: "Wake up")
        check(moved.error == "failed" && moved.record == s.record && f.alarms.count == 1, "a replace whose old alarm stays takes the new one back")
    }
    // A cancel while a set is in flight is refused, so the set cannot undo it.
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore())
        var during: WakeAlarmSnapshot?
        f.duringSchedule = { during = c.cancel() }
        _ = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(during?.error == "busy" && f.alarms.count == 1, "cancel during a set is busy")
    }
    // A record from an earlier launch, read back.
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let id = UUID()
        f.alarms[id] = d("2026-03-16T08:00:00Z")
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore(WakeAlarmRecord(id: id, at: d("2026-03-16T08:00:00Z"), hhmm: "08:00")))
        check(c.status().record?.id == id, "a stored alarm the system has is shown")
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up")
        check(f.scheduleCount == 0 && s.record?.id == id, "and a tap for its time does not duplicate it")
    }
    // The defaults store round-trips.
    do {
        let defaults = UserDefaults(suiteName: "goodtime.tests.\(UUID().uuidString)")!
        let store = DefaultsWakeAlarmStore(defaults: defaults, key: "k")
        let r = WakeAlarmRecord(id: UUID(), at: d("2026-03-16T08:00:00Z"), hhmm: "08:00")
        store.record = r
        check(DefaultsWakeAlarmStore(defaults: defaults, key: "k").record == r, "the record persists")
        store.record = nil
        check(store.record == nil, "and is removed")
    }
    // The sound (Andrei's follow-up): the chosen tone is what the system is given, and kept.
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore())
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up", sound: "chime")
        check(s.record.map { f.sounds[$0.id] } == "chime" && s.record?.soundID == "chime", "the chosen tone is scheduled")
        check(s.json["sound"] as? String == "chime", "and answered")
        let again = await c.set("08:00", timeZone: utc, now: now, title: "Wake up", sound: "chime")
        check(f.scheduleCount == 1 && again.record?.id == s.record?.id, "the same time and tone again schedules nothing")
        let changed = await c.set("08:00", timeZone: utc, now: now, title: "Wake up", sound: "pulse")
        check(f.scheduleCount == 2 && changed.record?.soundID == "pulse" && f.alarms.count == 1,
              "a new tone for the same time replaces the alarm, one alarm left")
        check(s.record.map { f.cancelled.contains($0.id) } == true, "the old one, by its id")
    }
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore())
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up", sound: "../../etc/passwd")
        check(s.record?.soundID == "default" && s.record.map { f.sounds[$0.id] } == "default", "an unknown sound is the default")
        let plain = await c.set("09:00", timeZone: utc, now: now, title: "Wake up")
        check(plain.record?.soundID == "default", "no sound is the default")
    }
    do {
        let f = FixtureWakeAlarmBackend(auth: .authorized)
        f.missingTones = ["sunrise"]
        let c = WakeAlarmController(backend: f, store: MemoryWakeAlarmStore())
        let s = await c.set("08:00", timeZone: utc, now: now, title: "Wake up", sound: "sunrise")
        check(s.record?.soundID == "default" && s.error == "", "a tone that is not there rings the default, and says so")
    }
    // A record from before sounds decodes, as the default.
    do {
        let old = #"{"id":"6F9619FF-8B86-D011-B42D-00C04FC964FF","at":795_000_000,"hhmm":"08:00"}"#
            .replacingOccurrences(of: "_", with: "")
        let r = try? JSONDecoder().decode(WakeAlarmRecord.self, from: Data(old.utf8))
        check(r?.hhmm == "08:00" && r?.soundID == "default", "an old record reads as the default sound")
    }
    // The tone's file goes to Library/Sounds, under Good Time's own name.
    do {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("goodtime-sound-\(UUID().uuidString)")
        let bundle = root.appendingPathComponent("Good Time.app"), library = root.appendingPathComponent("Library")
        try? files.createDirectory(at: bundle.appendingPathComponent("assets/sounds"), withIntermediateDirectories: true)
        try? Data("RIFF-chime".utf8).write(to: bundle.appendingPathComponent("assets/sounds/alarm-chime.wav"))
        let name = WakeAlarmSound.install("chime", bundleRoot: bundle, library: library)
        check(name == "goodtime-alarm-chime.wav", "installed by name")
        check((try? Data(contentsOf: library.appendingPathComponent("Sounds/goodtime-alarm-chime.wav"))) == Data("RIFF-chime".utf8),
              "with the bundled bytes")
        try? Data("RIFF-chime-2".utf8).write(to: bundle.appendingPathComponent("assets/sounds/alarm-chime.wav"))
        _ = WakeAlarmSound.install("chime", bundleRoot: bundle, library: library)
        check((try? Data(contentsOf: library.appendingPathComponent("Sounds/goodtime-alarm-chime.wav"))) == Data("RIFF-chime-2".utf8),
              "a changed tone is copied again")
        check(WakeAlarmSound.install("pulse", bundleRoot: bundle, library: library) == nil, "a tone not in the bundle: none (the default)")
        check(WakeAlarmSound.install("default", bundleRoot: bundle, library: library) == nil, "the default: none")
        try? files.removeItem(at: root)
    }
    // The real tones are in the app's assets.
    do {
        let here = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
        for tone in WakeAlarmSound.tones {
            let url = here.appendingPathComponent("assets/sounds/alarm-\(tone).wav")
            check(((try? Data(contentsOf: url))?.prefix(4)).map { String(decoding: $0, as: UTF8.self) } == "RIFF", "assets/sounds/alarm-\(tone).wav is bundled")
        }
    }
    // The launch default's fixtures.
    check(FixtureWakeAlarmBackend.named(nil) == nil, "under the agent, unset is unsupported")
    check(FixtureWakeAlarmBackend.named("prompt")?.auth == .notDetermined, "prompt")
}

let done = DispatchSemaphore(value: 0)
Task { @MainActor in
    await run()
    done.signal()
}
while done.wait(timeout: .now()) == .timedOut { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
print(failures == 0 ? "wake-alarm: \(count) checks passed" : "wake-alarm: \(failures) of \(count) checks failed")
exit(failures == 0 ? 0 : 1)
