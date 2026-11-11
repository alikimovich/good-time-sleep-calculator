<!-- exact:begin (exact new writes this block; bun exact.mjs update rewrites it) -->
# exact-app: an Exact app

`app.contract` is the view, `app.ts` its data module, `app.test.contract` its tests, `app.json`
the manifest: set its `app.name` and `app.id` before the first build. The app uses the exact2
checkout at `../../exact` by path (`EXACT2` overrides it).

This file is already in your instructions. Start from the nearest pattern: `bun exact.mjs
pattern` lists them and `pattern <name>` writes one, tested. ../../exact/docs/start-here-site.md (a site) or
../../exact/docs/start-here.md is the only required reading. `bun exact.mjs contract vocab <name>` answers a
name (none: the card); `bun exact.mjs docs <heading words>` a guide's
section. Run `bun exact.mjs verify` when the features work, and `verify ios|android` at the end for a
phone app. When an iPhone app is ready for the person to try, run `bun exact.mjs share` and give
them the link it prints; run it again after each change they should see. `bun exact.mjs help` lists the verbs, and your own in app.json `"commands"`.
`bun exact.mjs update` refreshes files. A native verb (`ios`, `mac`, `linux`, `android`,
`windows`) names its platform in app.json the first time it runs and builds it in a generated
workspace; `update --without <platform>` stops it.
`bun ../../exact/scripts/exact.mjs setup --check` names what a native build lacks.
Shared data: `exact new <path> --snapback`, or `bun exact.mjs snapback` here.
Install `snapback4@0.4.33` above; ../../exact/snapback4/README.md has setup and server commands.

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
| `app.tamber` | The asset catalog's colours (`gt.*`, light and dark), the accent, and the tab and settings icons (SF Symbols on Apple, `assets/icons/*.svg` elsewhere). |
| `strings/{en,es,ru}.json` | The `Localizable.strings`, with `%d`/`%@` as `{count}`/`{time}`. |
| `assets/icon-1024.png` | The app icon (`AppIcon.appiconset`). |
| `tools/sleep.test.ts` | Unit tests of the math: `bun test tools/`. |
| `tools/typecheck.mjs`, `tools/bun-test.d.ts` | `tsc` on `app.ts` and the unit tests, with Exact's pinned TypeScript and its build's strict options: `bun tools/typecheck.mjs`. |
| `app.test.contract` | The Contract tests, run on the web, macOS and the iOS Simulator by `../scripts/check`. |

## Motion (LKM-651)

Everything that moves is in `app.contract` and is gated on `still` (`exactViewport().prefersReducedMotion`, the
system's Reduce Motion): with it on, every `animation`, `transition`, exit and press scale is `none`/1.

| What | How |
| --- | --- |
| Intro → Wake Up | The intro leaves with `-exact-exit-animation` (`introLeave`: fade, drift left; filmed on the web; on iOS the intro and Wake Up share one route, which swaps at once), then Wake Up's time rows rise in. The screen and the tab bar themselves don't animate in: an entrance that holds its first frame left the tab bar off screen and the settings button hidden until the clock moved (macOS tests). |
| Time rows | Each row rises in with a 70 ms stagger; "the best time to wake up" pops in (`badgePop`). Bed Time's rows are keyed by their time too, so a picked wake-up time replays them; Wake Up's are not, since they follow the clock every minute. |
| Tab change | The panel fades and springs up (`-exact-spring(320, 30, 1)`); the tab's icon springs larger where the tab bar is ours (web, macOS; iOS uses UIKit's tab bar). |
| Time picker | A picked time sets `bumping` for 140 ms (task `unbump`): the picker and the Bed Time header spring to a slightly larger scale and back. |
| Presses | `:active` `-exact-press-scale` on the intro arrow, the settings buttons and the tabs (where they are custom nodes). |

Film a motion with the agent: `bun exact.mjs agent ios "tap intro-continue" "screenshot f.png over 600 every 50"`
(add `"prefer prefers-reduced-motion reduce"` first for the reduced-motion version). The films are in
`../docs/screenshots/LKM-651/`.
