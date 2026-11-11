# Performance: the SwiftUI app and the Exact app

LKM-652. Both apps were measured the same way on one iOS Simulator on 2026-11-11. Run `scripts/perf` to
measure again. It writes `perf/results/<date>-simulator.json`; the numbers below come from
[`perf/results/2026-11-11-simulator.json`](../perf/results/2026-11-11-simulator.json).

**No physical iPhone was measured.** No iPhone was connected to this Mac during the run:
`xcrun devicectl list devices` listed only simulators. The section
[On a physical iPhone](#on-a-physical-iphone) says how to fill that gap. All the timings below are from the
simulator. The simulator runs on the Mac's CPU and GPU at 60 Hz, so read its numbers as a comparison between the
two apps, not as what an iPhone shows. The download sizes come from real device (`iphoneos`) builds.

## Summary

| | SwiftUI app (1.0.4) | Exact app | |
| --- | --- | --- | --- |
| First frame, process start → first presented frame (median of 10 relaunches) | **355 ms** (337–364) | **437 ms** (419–445) | Exact +82 ms |
| First frame, first launch after install | 418 ms | 521 ms | Exact +103 ms |
| Exact's own `present` mark (`EXACT_SMOKE=1`, median of 10) | — | 408 ms (391–425) | |
| Missed refreshes during motion (3 journeys × 13 taps) | 138 in 2,751 frames (**5.0 per 100**) | 119 in 2,786 frames (**4.3 per 100**) | Exact 15 % fewer |
| Frame interval during motion: median / p95 / p99 | 16.7 / 16.7 / **42.7 ms** | 16.7 / 16.7 / **38.2 ms** | |
| Worst frame during motion (median of 3 journeys) | 163 ms | 157 ms | about equal |
| Memory 1 s after the first frame (phys_footprint, intro screen) | **17.8 MB** | **21.0 MB** | Exact +3.2 MB |
| Peak memory over a journey (XCUITest attached) | 43.2 MB | 39.4 MB | Exact −3.8 MB |
| Download size (device build, zipped .ipa, unsigned) | **1.5 MB** | **12.2 MB** | 8× |
| Installed size (device .app) | 1.6 MB | 24.1 MB | main executable 0.17 MB vs 22.9 MB |
| TestFlight build 6 (`scripts/beta-ios`, signed .ipa) | — | 12.2 MB | |

What this means:

- **Motion on the simulator: Exact is no worse, and slightly better.** Both apps hold 60 fps for at
  least 95 % of motion frames. Exact misses about 15 % fewer refreshes and has a lower p99, even though it
  animates more (staggered rows, springs, a badge pop; the SwiftUI app mostly fades and pushes). The worst frames
  in both apps are about 160 ms. The probe does not record which tap caused them. Because they are so similar
  in both apps, they probably come from work the two apps share (UIKit, XCTest's event delivery, the
  simulator), not from either app's own code.
- **Exact's first frame comes about 80 ms later.** Exact's own marks show where the time goes: the
  process reaches `main` at about 210 ms, the same as a native app, because dyld loads the 23 MB executable.
  `didFinishLaunching` → first render then takes about 165 ms (session boot about 180 ms: the runner, layout and
  the first apply of about 19 views). The SwiftUI app draws its intro in 8 layers; Exact draws it in 126.
- **Exact uses about 3 MB more memory at idle** (the Rust runtime and Hermes). It used about 4 MB less at the
  journey's peak.
- **Size is the biggest cost.** The executable carries the Exact runtime, so the download grows from 1.5 MB to
  12.2 MB. This size does not grow much as the app grows.

## Method

`scripts/perf` runs every step below. Run `scripts/setup` first. The script also needs `xcodegen`
(`brew install xcodegen`). A warm run takes about 8 minutes (496 s on 2026-11-11). The first run on a Mac also
builds Exact's simulator and device release targets.

```sh
scripts/perf                                  # everything; writes perf/results/<date>-simulator.json
scripts/perf --launches 5 --journeys 1 --no-device --no-exact-perf   # a quick look
```

Options: `--launches N` (default 10), `--journeys N` (3), `--rounds N` (3: tab and settings round trips per
journey), `--no-device` (skip the device builds), `--no-exact-perf`, `--out <file>`. Scratch builds, logs and
`.xcresult` bundles go to `$GTPERF_WORK` (default `/tmp/gt-perf`).

### What is built

- **SwiftUI:** `xcodebuild -configuration Release -sdk iphonesimulator` of `good-time.xcodeproj`, unchanged.
- **Exact:** `bun exact.mjs ios --release --sim <udid> --no-install`, the production (shipping) configuration.
- Both apps use the bundle ID `com.alikimovich.good-time-to-sleep`, so they are installed one at a time on a
  simulator of their own, **`Good Time Perf`** (iPhone 17 Pro, iOS 27.2; created on first use). Every journey
  starts from a fresh install, so the intro shows.

### The probe: the same measurement in both apps

[`perf/probe/GTPerfProbe.m`](../perf/probe/GTPerfProbe.m) is a small dylib. It is injected with
`DYLD_INSERT_LIBRARIES`: `SIMCTL_CHILD_DYLD_INSERT_LIBRARIES` for the launches, and the XCUITest's
`launchEnvironment` for the journeys. The source and build settings of both apps stay unchanged, and the same
code measures both.

- **First frame:** the time from process start (the kernel's `p_starttime`) to the first vsync after the first
  Core Animation commit in which the key window holds the content. This is Exact's own definition of its
  `present` mark (`ExactKit/Launch.swift`), so the Exact app also prints its `EXACT_SMOKE=1` number as a
  cross-check. The probe reads the time at the end of the commit's run-loop turn, so it reads about 25–30 ms
  later than Exact's own mark (437 against 408 ms). This offset is the same for both apps. In both apps, the
  first commit with a visible key window already holds the whole first screen (8 and 126 layers; the counts
  are the same 1 s later).
  These are relaunches of a terminated process with the simulator's caches warm, which is what a person sees
  most often. The first launch after install is reported separately.
- **Frames:** a `CADisplayLink` on the main thread in common modes records the timestamp of every callback. An
  interval longer than 1.5 × the display period (16.7 ms) is a long frame. A long frame counts
  `round(interval / period) − 1` missed refreshes. Intervals in the 1.2 s after each touch ends are counted as
  **motion**, which covers every transition in either app. The rest are idle. The probe sees touches through
  `UIApplication.sendEvent:`. This proxy measures main-thread frame cadence, the thing that makes animation
  stutter; it does not measure the GPU or the compositor.
- **Memory:** `phys_footprint` from `task_info(TASK_VM_INFO)`, the figure Xcode's memory gauge and jetsam use.
  It is read 1 s after the first frame, plus the ledger's peak when the journey ends. The peak is inflated in
  both apps because XCUITest turns accessibility on.

### The journey

[`perf/runner/UITests/MotionTests.swift`](../perf/runner/UITests/MotionTests.swift) is an XCUITest, generated
with xcodegen from [`perf/runner/project.yml`](../perf/runner/project.yml). It launches the installed app by
bundle ID and sends both apps the same 13 real touches, each followed by a 1.5 s pause:

1. the intro's arrow (the intro leaves, then Wake Up's rows rise in);
2. Bed Time, then Wake Up, 3 times (the tab bar);
3. Settings (the gear on Wake Up), then Back, 3 times;
4. Home. The probe writes its summary when the app enters the background.

### Exact's perf operation

The issue asked to use Exact's own instrument too. `scripts/perf` drives the Exact app's **development** build
with `bun exact.mjs agent ios --reset-storage --timing platform` (Exact's agent cannot drive a release build). It
makes the same taps and reads `perf frames live 1200` after each one (`exact.frame-health.metrics/2`):

| | Exact `perf frames live`, 13 windows |
| --- | --- |
| Frames with frame work | 351 |
| Missed frames / skipped refreshes | 4 / 4 |
| Worst frame interval | 54.5 ms |
| Frame work per frame, median / p99 (upper bin bounds) | ≤ 18.5 ms / ≤ 48 ms |
| Cadence assessment per window | 2 fail, 5 insufficient evidence (`simulator-deadlines`), 6 not applicable (no Exact frame work: UIKit's own tab and push animations) |

This counts only Exact's own frames, the display-link callbacks that did frame work. That is why it sees 4
misses where the probe, which counts every main-thread callback, sees about 40 per journey. On the simulator,
the development build's work per frame (a median of about 18.5 ms) is above the 16.7 ms budget. The production
build is optimised, and the probe numbers above come from it. Exact itself says these are proxies, with
presentation unobserved on the simulator.

### Sizes

- **Simulator .app:** total size of the files and size of the main executable. SwiftUI is 2.7 MB with a 1.3 MB
  executable. Exact is 33.2 MB with a 31.2 MB executable, because it is an arm64 simulator slice with symbols.
- **Device:** the SwiftUI app is built with `xcodebuild archive -destination generic/platform=iOS
  CODE_SIGNING_ALLOWED=NO` and zipped as `Payload/` into an .ipa. The Exact app is built with
  `bun exact.mjs ios --release --device --archive <ipa> --unsigned`, the same build `scripts/beta-ios` signs
  (its dSYM, 8.4 MB, is split off). The newest TestFlight .ipa in `~/.good-time/release` (build 6, 12.2 MB) is
  listed as a check.
- These are not App Store thinned sizes, which need a signed export. Thinning would change both apps by a
  similar small amount, because the asset catalog is under 1 MB.

## Machine and versions (2026-11-11)

Apple M4 Pro Mac mini, macOS 27.0.1, Xcode 27.2. Simulator: iPhone 17 Pro, iOS 27.2, 60 Hz. Good Time at
`f4ea06d` (main after LKM-651), Exact at `c582b3b` (`exact.pin`).

## Limits

- **Simulator only.** This is the main gap; see the next section. ProMotion (120 Hz), the GPU, thermal state
  and the dyld cache of a real phone change every timing.
- The two apps show different motion for the same taps: Exact's port animates more. So the frame comparison
  answers "does each app keep up with its own motion", not "the same animation, rendered two ways".
- The probe's display link asks for the screen's maximum rate. It runs in both apps alike, but it keeps the
  main run loop awake every frame.
- Numbers vary between runs by about ±10 ms for launch and ±5 missed refreshes per journey (see the min–max in
  the results file). Compare apps within one run.

## On a physical iPhone

This run had no iPhone connected, so it has no device numbers; nothing above was estimated for a device. To
measure on a device later, connect the iPhone by cable or Wi-Fi pairing, check that
`xcrun devicectl list devices` lists it, and use two methods that need no probe:

- **Exact:** `bun exact.mjs ios --device --phone "<name>" --run` with `EXACT_SMOKE=1` for the launch marks.
  `bun exact.mjs agent ios --device "tap intro-continue" "perf frames live 1200" …` gives frame health; on a
  device it also reports late frames, which the simulator cannot.
- **Both apps:** `xcrun xctrace record --template "App Launch"` and `--template "Animation Hitches"` with
  `--device <udid>` against the TestFlight builds. On the simulator these templates record no lifecycle or
  hitch data (tried 2026-11-11), which is why this run uses the probe.

`scripts/perf` does not automate the device run yet. It is the follow-up once an iPhone is connected to this
Mac.
