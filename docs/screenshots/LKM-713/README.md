# LKM-713: one row geometry on both tabs, "Recommended" beside the time

iOS Simulator, the alarm fixture `authorized` (so Wake Up has its alarm buttons), light appearance.

| File | What it shows |
| --- | --- |
| `1-before-wakeup.png` | Before, iPhone 17 Pro: the 64-point alarm button made every time line taller (label→time 15.7 pt, time→bar 23.3 pt), and "the best time to wake up" took a line of its own. |
| `2-after-wakeup.png` | After, same device: every row 86 pt, label→time 0 pt, time→bar 8 pt, as Bed Time; "Recommended" on the 5-cycle time's baseline; alarm buttons centred on the time line. |
| `3-after-bedtime.png` | Bed Time, unchanged (rows 86 pt, the same gaps). |
| `4-accessibility-xl-alarm-set.png` | Accessibility XL text: "Recommended" wraps under the time at full size, the alarm buttons stay; after a tap on the 5-cycle alarm, the card says it is set for 7:45 AM. |
| `5-se-ru-xxxl.png` | iPhone SE (375 pt), Russian, xxxL text: "Рекомендуется" fits beside the time. |
