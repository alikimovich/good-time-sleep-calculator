# LKM-651 motion films

Each PNG is a contact sheet of 13 frames, 0 to 600 ms every 50 ms (`screenshot <png> over 600 every 50`), read
left to right, top to bottom. iOS: the `Good Time Check` simulator (402×874 points); web: headless Chromium.

| File | Motion |
| --- | --- |
| `ios/1-intro-to-wakeup.png` | The arrow pressed: Wake Up's rows stagger in and the best-time badge pops. The screen and the tab bar are in place at frame 0. |
| `web/1-intro-to-wakeup.png` | The same on the web (headless Chromium, the page's own tab bar). |
| `ios/2-tab-to-bedtime.png` | Bed Time selected: the panel springs up and its rows stagger in. |
| `ios/3-picker-spring.png` | 6:30 picked: the picker and header spring, the new bed times rise in. |
| `ios/4-tab-to-wakeup.png` | Back to Wake Up: the panel springs up. |
| `ios/6-reduced-motion-intro.png` | Reduce Motion on: Wake Up is in place at frame 0. |
| `ios/7-reduced-motion-tab.png` | Reduce Motion on: Bed Time is in place at frame 0. |
| `ios/8-reduced-motion-picker.png` | Reduce Motion on: the new bed times replace the old at once. |

There is no film 5. It was meant to show the settings button's press scale, but that button sits in the native top
bar (UINavigationBar), and the agent can't hold a native bar button down for a film.

The Wake Up screen and the tab bar used to rise in too (`rise`, `barRise`, with a delay and `both` fill). They were
dropped: an entrance that holds its first frame left the tab bar half off screen and Wake Up's settings button hidden
until time moved, which failed the macOS Contract tests.

Exact refused nothing in this pass, so there is no refusal ID. Andrei's SwiftUI wish list was asked for on LKM-651 and
hasn't been answered yet; anything on it that Exact refuses will be listed here with its refusal ID.
