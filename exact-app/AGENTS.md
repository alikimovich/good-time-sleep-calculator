<!-- exact:begin (exact new writes this block; bun exact.mjs update rewrites it) -->
# exact-app: an Exact app

Run `bun exact.mjs --help` first to create `.exact/checkout`; set `EXACT=<checkout>` if needed.

`app.contract` is the view, `app.ts` the data module, `app.test.contract` the tests, `app.json`
the manifest: set `app.name` and `app.id` before building. The app uses Exact at
`.exact/checkout` by path (`EXACT` overrides it).

Start from the nearest pattern: `bun exact.mjs
pattern` lists them and `pattern <name>` writes one, tested. .exact/checkout/docs/start-here-site.md (a site) or
.exact/checkout/docs/start-here.md is the only required reading. `bun exact.mjs contract vocab <name>` answers a
name (none: the card); `bun exact.mjs docs <heading words>` a guide's
section. Run `bun exact.mjs verify` when the features work, and `verify ios|android` at the end for a
phone app. When an iPhone app is ready to try, run `bun exact.mjs share` and send its link;
repeat for each change the person should see. `bun exact.mjs help` lists the verbs, including
app.json's `"commands"`.
`bun exact.mjs update` refreshes files. Native verbs (`ios`, `mac`, `linux`, `android`, `windows`)
name their platform in app.json on first use and build in a generated workspace;
`update --without <platform>` stops shipping it.
`bun .exact/checkout/scripts/exact.mjs setup --check` names what a native build lacks (`--platform ios --device` for a phone's: `share`, `ios --device`).

Generated, so don't edit: `exact.mjs` and this block.

## Feedback (required)

When a doc was wrong or missing, a workaround was needed, something took several tries or a
command confused you, record it: `bun exact.mjs feedback note "<what happened>"`. It attaches
exact2's commit and the last exit code, never output or code. `bun exact.mjs feedback status` says
whether notes are sent and whether to keep a diary; under `never`, skip all of this.
<!-- exact:end -->

## Good Time (LKM-649)

The port of the SwiftUI app in `../good-time/`. Screenshots of both: `../docs/screenshots/LKM-649/`.

| File | Holds |
| --- | --- |
| `app.contract` | The view: the intro (shown until the arrow or a left swipe; `showIntro`, persisted), the Wake Up and Bed Time tabs, Settings (pushed from either tab). Settings are root `state … persist`, under the SwiftUI app's `@AppStorage` names. |
| `app.ts` | The sleep-cycle math, as the Swift views do it: `wakeUpTimes`, `bedTimes`, `progressPercentage`, `wakeUpInstant`, and `formatClock` (DateFormatter's `.short` time, via `Intl`'s `timeStyle: 'short'`). The `schedule` source answers both tabs' rows. |
| `app.forma` | The asset catalog's colours (`gt.*`, light and dark), the accent, and the tab and settings icons (SF Symbols on Apple, `assets/icons/*.svg` elsewhere). |
| `strings/{en,es,ru}.json` | The `Localizable.strings`, with `%d`/`%@` as `{count}`/`{time}`. |
| `assets/icon-1024.png` | The app icon (`AppIcon.appiconset`). |
| `tools/sleep.test.ts` | Unit tests of the math: `bun test tools/`. |
| `tools/typecheck.mjs`, `tools/bun-test.d.ts` | `tsc` on `app.ts` and the unit tests, with Exact's pinned TypeScript and its build's strict options: `bun tools/typecheck.mjs`. |
| `app.test.contract` | The Contract tests, run on the web, macOS and the iOS Simulator by `../scripts/check`. |

## Titles and backgrounds (LKM-707)

- The three screen titles (Wake Up, Bed Time, Settings) are level-1 headings, so iOS shows them as UIKit large titles.
  All three use `class=ScreenTitle` (New York italic: `ui-serif`, `font-style: italic`). The style sets only the
  family and the italic, so each title keeps UIKit's size, weight and Dynamic Type. Section headers, row labels and
  "Recommended" keep their own roles.
- UIKit sizes the large-title label to the words' advance width, which cuts off an italic's last glyph where it leans
  past that width ("Up"'s p). `screenTitle(words)` adds a no-break space and a word joiner (U+00A0 U+2060) after the
  words. UIKit drops trailing spaces of any kind (U+00A0 too) when it sizes the label, so the space alone does
  nothing; the zero-width joiner keeps the space from trailing. Keep both characters in `app.contract`, not in
  `strings/*.json`. At the largest accessibility sizes UIKit truncates the long titles, with or without them.
- Settings uses `gt.background` on its route and on its `list`, as Wake Up and Bed Time do. With no background set,
  a grouped list's page is the system's grouped grey. The rows keep their native grouped card surfaces.

## Cycle rows (LKM-713)

Both tabs' rows are one component, `Times`, with one geometry: the cycles label, the time line right under it, the
bar 8 points below (iPhone 17 Pro, default text: every row 86 points tall on both tabs). The time line is as tall as
its text. Wake Up's alarm button is placed over the line's trailing edge (`position="absolute"`, centred with
`top="50%" translate="0px -50%"`, 44×44) and the line keeps 52 points of room for it, so its hit area can't make the
line taller (it was 64 points tall, adding about 15 points above and below the time). The 5-cycle wake-up time has
"Recommended" (`wakeup.recommended`, New York italic, `gt.highlight`) beside it on the time's baseline; where there
is no room (large text, a long translation) it wraps under the time at full size, and the alarm button stays,
centred on the two lines together. The button's `right` and the line's `padding-right` are physical (Exact has no
inline-end inset): a right-to-left locale would need them mirrored; none ships today.
Bed Time's wake-time picker and alarm button are in its subtitle (LKM-724, below). Views of both tabs:
`../docs/screenshots/LKM-713/`.

## Bed Time's subtitle is the wake-time control (LKM-724)

The subtitle (`bedtime-header`) reads "If you want to wake up at" (`bedtime.header_lead`) and then the time picker
(`bedtime-wake`, spoken "Choose time you want to wake up:") where the static time was, and, where the device has
alarms, an icon-only alarm button (`bedtime-alarm`, spoken `alarm.set_for` with the picked time; it sets exactly
`wakeUpTime`) on the same line, its icon on the content's trailing edge as Wake Up's are. The old control row under
the rows ("Set alarm" pill, picker, "Choose time…" label) is gone. The subtitle keeps its geometry: the line is as
tall as its text, the picker's 36-point pill takes 7 points back above and below (`margin="-7px 0px"`), and the button
is placed over the line (absolute, centred, 44×44), so neither moves it (iPhone 17 Pro: the subtitle at y 168, 38
points with its bottom padding, the first row at 206, before and after). The button's hit area reaches across the
16-point screen margin (`right=-16`, its icon `flex-end` inside 16 points of padding), so the line keeps only 28
points of room and English with a "10:30 AM" picker fits one line on a 375-point iPhone SE. Where there is no room
(large text; on a 375-point screen, Spanish and Russian with a 12-hour picker) the picker wraps under the words and
the button centres on both lines, as Wake Up's does beside a wrapped "Recommended". `right` and `padding-right` are
physical, as on Wake Up. Views: `../docs/screenshots/LKM-724/`.

## Motion (LKM-651, LKM-703)

Everything that moves is in `app.contract` and is gated on `still` (`exactViewport().prefersReducedMotion`, the
system's Reduce Motion): with it on, every `animation`, `transition`, exit and press scale is `none`/1.

| What | How |
| --- | --- |
| Cycle bars (LKM-703) | **The only content entrance.** When a result screen is shown (the intro left, a launch, a tab selected), every bar fills at once from the track's leading edge to its fraction: keyframes `fill` (the fill's `translate` from -100%), 300 ms, `cubic-bezier(0.23, 1, 0.32, 1)` (a strong ease-out), no stagger. The fill's `width` is its fraction from the first frame and the track (`overflow="hidden"`) clips it, so the first painted frame is an empty track and the geometry never moves. `Times`' `fill` prop is `not still and nav.tab == <this tab>`: it turns on when the tab is shown, which plays the fill once; a picked time, the clock, the alarm, Settings and back leave it on, so rows (keyed by cycles only) update in place without replaying it. The bar is drawn (a 4-point capsule track in `-exact-fill`, the fill in the row's tone, `role="progressbar"`), as UIProgressView draws one, since a native `progress` eases only by UIKit's own curve and not on first show. |
| Time rows, "Recommended" | No entrance (LKM-703): they are in place at their final geometry and opacity from the first frame. (LKM-651's `rise` stagger and `badgePop` are gone.) |
| Intro → Wake Up | The intro leaves with `-exact-exit-animation` (`introLeave`: fade, drift left; filmed on the web; on iOS the intro and Wake Up share one route, which swaps at once); Wake Up's bars then fill. The screen and the tab bar don't animate in: an entrance that holds its first frame left the tab bar off screen and the settings button hidden until the clock moved (macOS tests). |
| Tab change | The panel switches at once (LKM-703 dropped its fade and slide-up); the tab's icon springs larger where the tab bar is ours (web, macOS; iOS uses UIKit's tab bar, with its own selection motion). |
| Time picker | A picked time sets `bumping` for 140 ms (task `unbump`): the Bed Time picker springs to a slightly larger scale and back (LKM-724: the subtitle's words, which no longer change, stay still). |
| Presses | `:active` `-exact-press-scale` on the intro arrow, the settings buttons and the tabs (where they are custom nodes). |

Film a motion with the agent: `bun exact.mjs agent ios "tap intro-continue" "screenshot f.png over 600 every 50"`
(add `"prefer prefers-reduced-motion reduce"` first for the reduced-motion version). The films are in
`../docs/screenshots/LKM-651/` and, for the bar fill, `../docs/screenshots/LKM-703/`.

## Wake-up alarm (LKM-696)

A wake-up time sets a real system alarm through Apple's **AlarmKit** (iOS 26 and later): each Wake Up row has an
alarm button, and Bed Time has one beside the picker in its subtitle (LKM-724). The alarm is Good Time's own. It rings
through silent mode and Focus with the system's alert and Stop, and Settings > Good Time > Alarms lists it. It is
**not** an entry in the Clock app, because no public API adds one.

| File | Holds |
| --- | --- |
| `modules/apple/WakeAlarmCore.swift` | No AlarmKit, so it compiles on every Apple host. `WakeAlarmPlan.next` is the next future "HH:MM" in a time zone by `Calendar` (midnight, DST gap and overlap). `WakeAlarmController` keeps one alarm: its UUID is stored in `UserDefaults` (`goodtime.wakeAlarm`), it is cancelled only by that UUID, the same time again schedules nothing, a tap while one is in flight is refused, and a new time replaces the old alarm only after the new one is scheduled. A record whose alarm the system no longer has is dropped at the next read. `FixtureWakeAlarmBackend` stands in for AlarmKit under the agent and in tests. |
| `modules/apple/WakeAlarm.swift` | The module (`native.later` ops `status`, `set`, `cancel`) and the AlarmKit backend: a one-time `.fixed` alarm with no countdown. |
| `app.ts` | `wakeAlarm`, `setWakeAlarm`, `cancelWakeAlarm`; `alarmView` writes the system's date for the person's region. With no module (the web) it is unsupported. `grants = 'device.alarms purpose.alarms'` writes `NSAlarmKitUsageDescription` from `strings/*.json`. |
| `app.json` `host.ios.link` | Weak-links AlarmKit, so iOS 17 to 25 still launch. There the module says `unsupported`, and the app says alarms need iOS 26 (no notification stands in for an alarm). |
| `tools/wake-alarm-tests.swift`, `.mjs` | The Swift core's tests, run on the Mac: `bun tools/wake-alarm-tests.mjs` (also in `scripts/check`). |
| `tools/alarm.test.ts` | `alarmView`, `wallClock`, `formatAlarm`. |

**Sound.** Settings' Alarm section (LKM-698; pushed from either tab's gear) holds the Sound picker (`state alarmSound … persist`), which offers System default and
Good Time's own tones, Sunrise, Chime and Pulse: `assets/sounds/alarm-<id>.wav`, synthesized from sine waves by
`tools/alarm-tones.mjs` (no recording, nothing downloaded; 16-bit PCM mono WAV, 8 s, inside both Contract's 10 s
`sound` limit and Apple's 30 s custom-sound limit). `bun tools/alarm-tones.mjs` rewrites them;
`tools/alarm-tones.test.ts` checks the committed files against it. **Preview** plays a tone only when tapped
(`playSound`, group `alarm-preview`); under the agent nothing plays (the runner records the voice; output
`agent`). `audio_session` is `playback`, so a preview is heard with the ring/silent switch on; Exact holds that
session only while something sounds. On set, `WakeAlarmSound.install` copies the tone from the bundle's
`assets/sounds/` to the app's `Library/Sounds/goodtime-alarm-<id>.wav` and AlarmKit is given
`AlertConfiguration.AlertSound.named(<that name>)`; a tone that is not there, or an unknown id, rings `.default`, and
the result screens' alarm card says which sound the scheduled alarm actually has ("Sound: …"). A new sound for a set alarm sets it again
at the same time (the old one goes only once the new one is scheduled). There is no API to the Clock app's
ringtones or to Apple Music, and the app says so.

**Where it shows (LKM-698).** The result screens keep the per-time alarm buttons (and Bed Time's, in its subtitle). With
nothing to report they show only the one-line hint "Tap an alarm button…"; the card (`AlarmStatus`) appears only for a
scheduled alarm (when, its sound, Cancel), denied permission, a failure, or no alarms on this device. Settings' Alarm
section has the picker, Preview (when a tone is chosen) and a footer saying alarms are set from the time buttons;
where there are no alarms it says only that. A sound change that fails to re-set a scheduled alarm puts "could not be
set" in that footer too. Preview is the section's own `button` row (LKM-714), not a `button` inside a `row`: as a
grouped list's button row it is UIKit's standard cell, its title on the cell's margin with Sound's label, its whole
row the hit area, its text `AccentColor`. A native `button` inside a custom `row` adds UIButton's content inset, and
its text started 12 points further in (iPhone 17 Pro: Sound at 33, Preview at 45; now both 33, also at
accessibility-extra-large). Views: `../docs/screenshots/LKM-714/`. Leaving Settings (`back`, `follow`, a tab) stops a preview still playing. The Contract tests only
see the no-alarms answer; the available path (picker, Preview, the sound kept across a relaunch, an alarm set with it)
is checked on the simulator with `GoodTimeAlarmFixture authorized`:
`"tap intro-continue" "tap wakeup-settings" "type settings-alarm-sound chime" "tap settings-alarm-preview" "back" "tap wake-5-alarm" "clock +500" "tree"`.

**No snooze, by design.** A countdown (snooze, pre-alert) needs a Live Activity widget extension, which needs its own
App ID (`<app id>.widgets`) and App Store profile. `@exact/alarms` always adds one, which is why the app does not
use that package. Adding snooze later means registering that App ID and profile first.

**Under the agent** nothing reaches AlarmKit. The launch default `GoodTimeAlarmFixture` picks the fixture:
unset means `unsupported` (as the web and macOS are, so `app.test.contract` passes on every host), and the others
are `prompt`, `prompt-deny`, `denied`, `authorized` and `failing`. `system` drives the real AlarmKit path on a
**simulator** only. Never schedule a test alarm on a personal phone.

```sh
xcrun simctl spawn "Good Time Check" defaults write com.alikimovich.good-time-to-sleep GoodTimeAlarmFixture prompt
EXACT_SIM="Good Time Check" bun exact.mjs agent ios --reset-storage "tap intro-continue" "tap wake-5-alarm" "clock +500" "tree"
xcrun simctl spawn "Good Time Check" defaults delete com.alikimovich.good-time-to-sleep GoodTimeAlarmFixture
```

Still to verify on a real iPhone running iOS 26 or later: the permission prompt's text, the ring through silent
mode and Focus, Stop, the alarm leaving the app once stopped, and that a chosen tone (not the default) is what
rings, and whether AlarmKit repeats an 8 s tone until Stop. On the simulator AlarmKit's permission could not be
granted (`simctl privacy` has no alarms service), so the real path with a named sound is checked only up to the
tones being in the built bundle's `assets/sounds/`.
