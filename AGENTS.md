# Good Time: agent guide

Good Time is a sleep calculator for iOS. This repository holds two apps:

| Path | What |
| --- | --- |
| `good-time/`, `good-time.xcodeproj`, `good-time*Tests/` | The original SwiftUI app (v1.0.4, build 3). **Keep it. Do not change or delete it**; Andrei decides its fate later. |
| `exact-app/` | The rebuild on [Exact](https://github.com/expo/exact): `app.contract` (the view, Contract), `app.ts` (its data, TypeScript), `app.test.contract` (tests that run on every host), `app.json` (name, bundle ID, hosts). Read `exact-app/AGENTS.md` and the Exact checkout's `docs/start-here.md` before editing it. |

Both apps use the name "Good Time" and bundle ID `com.alikimovich.good-time-to-sleep` (team `ZMVK3ALPSD`).

Project rules: use Bun, not npm. Never submit to the App Store, never submit for review, never add external testers.
Keep secrets (the App Store Connect key, signing material) outside the repository.

## Toolchain

| Tool | Where | Checked by |
| --- | --- | --- |
| Exact source checkout | `~/dev/exact` (`EXACT_DIR` overrides), detached at the commit in [`exact.pin`](exact.pin) | `scripts/doctor` |
| Bun **1.4.2** (Exact pins it) | `~/.bun-1.4.2/bin/bun`, beside the default `~/.bun` (another version). The scripts put it first on `PATH`; `exact-app/exact.mjs` also finds it there. | `scripts/doctor` |
| Rust | rustup in `~/.cargo`; Exact's `rust-toolchain.toml` pins stable 1.97.0, and setup adds `nightly-2026-08-21` for the web's wasm | Exact `setup --check` |
| Hermes bundles | `~/.cargo/hermes-lean-sys/`: `aarch64-apple-darwin`, `aarch64-apple-ios-sim`, `aarch64-apple-ios` (and tvOS) | Exact `setup --check` |
| Xcode 27.1 or later with the iOS Simulator SDK | `/Applications/Xcode.app` (this Mac: 27.2) | `scripts/doctor` |
| Chromium for web tests | Playwright's pinned build in `~/Library/Caches/ms-playwright` | Exact `setup --check` |

Exact has no packaged CLI: the app runs Exact's scripts from the checkout. `exact-app/exact.mjs` finds it at `../../exact`
from the main checkout (`~/dev/good-time-sleep-calculator`), which is `~/dev/exact`. In a git worktree it resolves
the path from the main checkout; the scripts below also export `EXACT2=$EXACT_DIR`, so they work from any worktree.

Optional: `xcodebuild -downloadComponent MetalToolchain` lets iOS builds compile Exact's Metal shaders (SVG filters,
GPU canvases). Without it they fall back to Core Image and Core Graphics, which this app does not need.

## Scripts

| Command | What it does | Time on this Mac |
| --- | --- | --- |
| `scripts/setup` | **The Forge setup command.** Idempotent: installs rustup and Bun 1.4.2 if missing, clones Exact to `~/dev/exact` if missing, checks out `exact.pin` (refuses if the checkout has local changes), and runs `bun scripts/exact.mjs setup` only when `setup --check` fails. | ~30 s when everything is present; ~15 min cold |
| `scripts/doctor` | Checks the toolchain and changes nothing: Xcode, rustup, Cargo, Bun 1.4.2, the Exact pin, Exact's `setup --check` and `exact-app/`. Names the fix for each gap. | ~30 s |
| `scripts/check` | **The Forge check command.** Doctor, `git diff --check`, compiles `app.contract` and type-checks `app.ts`, then builds the app and runs its Contract tests on the web (headless Chromium) and on the iOS Simulator `Good Time Check` (created on first use). `--web` (or `GOOD_TIME_CHECK_IOS=0`) skips iOS. | see below |

Check runtime, measured 2026-11-11: see the "Check timings" section at the end.

The iOS step builds into a Cargo target shared by every worktree, `~/.cache/good-time/exact-target`
(`GOOD_TIME_IOS_TARGET` overrides). Only the first iOS build on a Mac is cold. A fresh Forge worktree reuses the
compiled dependencies and rebuilds only the app's own crates.

## Build, run and test the Exact app

Run these in `exact-app/`, with the pinned Bun first on `PATH`
(`export PATH="$HOME/.bun-1.4.2/bin:$HOME/.cargo/bin:$PATH"`):

```sh
bun exact.mjs contract types app.contract -o app.contract.d.ts   # the types app.ts imports (generated, gitignored)
bun exact.mjs contract build app.contract --json --errors-only   # [] means no errors
bun exact.mjs web                  # the dev loop at http://127.0.0.1:8765/, rebuilds on save
bun exact.mjs test web             # Contract tests on the web
EXACT_SIM="Good Time Check" bun exact.mjs test ios   # Contract tests on the iOS Simulator
bun exact.mjs verify               # tests, plus checks light/dark, two widths, the largest text size
bun exact.mjs ios --run            # launch on a simulator for a person to watch
bun exact.mjs ios --release        # the build that ships (Exact has no TestFlight upload; that is ours)
bun exact.mjs agent web tree "screenshot .exact/home.png"   # drive and screenshot (also: ios)
```

Many simulators are usually booted on this Mac. Name one with `EXACT_SIM`, or Exact refuses to guess.

## Update the Exact pin

Exact is pre-1.0 and changes daily. Move the pin on purpose, in its own commit:

```sh
git -C ~/dev/exact fetch origin
git -C ~/dev/exact log --oneline HEAD..origin/main | head -50    # read what changed
git -C ~/dev/exact rev-parse origin/main > exact.pin              # the new commit
scripts/setup                                                     # checks it out, runs exact setup if needed
(cd exact-app && EXACT2=~/dev/exact bun exact.mjs update)         # rewrites exact.mjs, AGENTS.md block, lock drift
scripts/check
git add exact.pin exact-app && git commit -m "<issue>: move Exact to <short sha>"
```

Run `bun exact.mjs update` from the main checkout (`~/dev/good-time-sleep-calculator/exact-app`), or check that it
kept the relative path `../../exact` in `exact-app/exact.mjs`, `app.json` and `exact-app/AGENTS.md`. Run from a
worktree elsewhere, it writes a path relative to that worktree, which breaks the main checkout.
`~/dev/exact` is shared by every worktree on this Mac: moving the pin moves it for all of them.
