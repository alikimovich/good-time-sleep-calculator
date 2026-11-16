# LKM-703 motion films: the cycle bars fill, nothing else enters

Contact sheets, read left to right, top to bottom; `at=` is the agent clock in ms. iOS: the `Good Time Check`
simulator (402×874 points); web: headless Chromium.

| File | What it shows |
| --- | --- |
| `ios/1-intro-to-wakeup.png` | The arrow pressed, 0–400 ms every 50: frame 0 has every row, label and "the best time" in place and every track empty; the four bars fill together (300 ms, ease-out) to 0.5, 0.67, 0.83, 1. |
| `ios/2-tab-to-bedtime.png` | Bed Time selected (frames from 300 ms, after the tap): the panel is in place at once and its bars fill. |
| `ios/3-picked-time-no-replay.png` | 6:30 picked on Bed Time: the times change in place and the bars stay full at their fractions (only the picker and header spring). |
| `ios/4-clock-tick-no-replay.png` | 30 s later on Wake Up (the minute tick): the bars do not move. Frame 0's tab bar is UIKit's own selection motion. |
| `ios/5-settings-back-no-replay.png` | Back from Settings to Wake Up: every frame is identical, so nothing replays. |
| `ios/6-reduced-motion-intro.png` | Reduce Motion on, the arrow pressed: the bars are at their fractions from frame 0. |
| `web/1-first-frames.png` | The web, 0–40 ms every 10: frame 0 has empty tracks, then the fill starts. |
| `web/2-intro-to-wakeup.png` | The web, 0–400 ms every 50. |
