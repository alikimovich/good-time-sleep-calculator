# App Store screenshots (LKM-771)

The Exact app on the iOS Simulator (iOS 27.2), light appearance, status bar 9:41 with full battery. Made by
`scripts/appstore-screenshots`, which `scripts/appstore-prepare` uploads (deliver's layout: one folder per locale,
display type by size, order by file name).

| File | Display type | Size |
| --- | --- | --- |
| `<locale>/iphone69-*.png` | iPhone 6.9" (iPhone 17 Pro Max), `APP_IPHONE_67` | 1320×2868 |
| `<locale>/ipad13-*.png` | iPad 13" (iPad Pro 13-inch M5), `APP_IPAD_PRO_3GEN_129` | 2064×2752 |

Each set: 1 the intro, 2 Wake Up's times, 3 Settings with the Sunrise tone, 4 Bed Time with an alarm set. Locales:
en-US, ru, es-ES, es-MX; the app and the simulator's language and region are the locale's.

How they are made, so nothing in them claims more than the app does:

- The drive's clock starts on Monday 23 November 2026 at 10:47 PM (UTC), so every set shows the same times.
- The alarm is the native module's fixture (`GoodTimeAlarmFixture authorized`): the app's real UI for a set alarm,
  with nothing scheduled in AlarmKit. Alarms need iOS 26 or later, which the description says.
- The iPad is in iPadOS's default windowed-apps mode: its status bar names the app and the window's corner shows
  the resize grabber.
- Development builds draw Exact's frame-health presentation probe, a transparent 1-point layer the simulator
  composites as a black square at the iPhone screen's top-left corner. Release builds do not install it.
  `scripts/appstore-screenshot-probe.swift` paints that 4×4-pixel corner with the background next to it. Nothing
  else is edited.
