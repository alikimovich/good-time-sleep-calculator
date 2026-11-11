// LKM-652: measures the SwiftUI app and the Exact app the same way on one iOS Simulator and writes the results.
// Run it through scripts/perf (which puts the pinned Bun and Cargo on PATH). docs/performance.md explains the
// method and holds the results.
//
//   scripts/perf                       # everything: build both Release apps, launches, journeys, Exact perf, sizes
//   scripts/perf --launches 5 --journeys 1 --no-device   # quicker
//
// Both apps use the bundle ID com.alikimovich.good-time-to-sleep, so they are installed on the simulator one at a
// time. The measurement probe (perf/probe/GTPerfProbe.m) is injected with DYLD_INSERT_LIBRARIES; neither app's
// source or build changes. The journey is an XCUITest (perf/runner) that taps the same controls in both apps.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const APP_DIR = join(ROOT, "exact-app");
const BUNDLE_ID = "com.alikimovich.good-time-to-sleep";
const SIM_NAME = "Good Time Perf";
const SIM_TYPE = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";

const args = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const launches = opt("--launches", 10);
const journeys = opt("--journeys", 3);
const rounds = opt("--rounds", 3);
const device = !args.includes("--no-device");
const exactPerf = !args.includes("--no-exact-perf");
const work = resolve(process.env.GTPERF_WORK ?? "/tmp/gt-perf");
const date = new Date().toISOString().slice(0, 10);
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(ROOT, "perf", "results", `${date}-simulator.json`);
const iosTarget = process.env.GOOD_TIME_IOS_TARGET ?? join(homedir(), ".cache", "good-time", "exact-target");
const releaseTarget = process.env.GT_RELEASE_TARGET ?? join(homedir(), ".cache", "good-time", "exact-release-target");

function step(text: string) {
  console.log(`==> ${text}`);
}

type Run = { status: number; stdout: string; stderr: string };
function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; quiet?: boolean; check?: boolean; log?: string } = {}): Run {
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs,
  });
  const result = { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  if (opts.log) writeFileSync(opts.log, `$ ${cmd.join(" ")}\n${result.stdout}\n${result.stderr}`);
  if ((opts.check ?? true) && result.status !== 0) {
    throw Error(`${cmd.join(" ")} exited ${result.status}${opts.log ? ` (log: ${opts.log})` : ""}\n${(result.stdout + result.stderr).slice(-3000)}`);
  }
  return result;
}

const sleep = (ms: number) => Bun.sleepSync(ms);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const stats = (xs: number[]) => ({ n: xs.length, median: round(median(xs)), min: round(Math.min(...xs)), max: round(Math.max(...xs)) });
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const mb = (bytes: number) => round(bytes / 1048576, 2);

function duBytes(path: string): number {
  // Apparent size of every file (what a download and the device's storage count, before APFS compression).
  let total = 0;
  const walk = (p: string) => {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else total += st.size;
  };
  walk(path);
  return total;
}

// ---- Simulator ---------------------------------------------------------------------------------------------
function simulator(): string {
  const devices = JSON.parse(run(["xcrun", "simctl", "list", "devices", "available", "-j"]).stdout).devices as Record<string, { name: string; udid: string }[]>;
  const found = Object.entries(devices).filter(([rt]) => rt.includes("iOS")).flatMap(([, d]) => d).find((d) => d.name === SIM_NAME);
  let udid = found?.udid;
  if (!udid) {
    const runtimes = JSON.parse(run(["xcrun", "simctl", "list", "runtimes", "-j"]).stdout).runtimes as any[];
    const rts = runtimes.filter((r) => r.platform === "iOS" && r.isAvailable && (r.supportedDeviceTypes ?? []).some((d: any) => d.identifier === SIM_TYPE));
    rts.sort((a, b) => Bun.semver.order(a.version, b.version));
    if (!rts.length) throw Error("no iOS Simulator runtime for the iPhone 17 Pro; install one in Xcode, Settings, Components");
    udid = run(["xcrun", "simctl", "create", SIM_NAME, SIM_TYPE, rts.at(-1).identifier]).stdout.trim();
    console.log(`created ${SIM_NAME} (${udid})`);
  }
  run(["xcrun", "simctl", "bootstatus", udid, "-b"]);
  return udid;
}

function install(udid: string, app: string) {
  run(["xcrun", "simctl", "uninstall", udid, BUNDLE_ID], { check: false });
  run(["xcrun", "simctl", "install", udid, app]);
}

function dataContainer(udid: string) {
  return run(["xcrun", "simctl", "get_app_container", udid, BUNDLE_ID, "data"]).stdout.trim();
}

// ---- Builds ------------------------------------------------------------------------------------------------
function buildSwiftUI(): string {
  step("Build the SwiftUI app (Release, iOS Simulator)");
  const dd = join(work, "swiftui-dd");
  run(["xcodebuild", "-project", "good-time.xcodeproj", "-scheme", "good-time", "-configuration", "Release", "-sdk", "iphonesimulator",
    "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", dd, "CODE_SIGNING_ALLOWED=NO", "build"], { log: join(work, "swiftui-build.log") });
  return join(dd, "Build/Products/Release-iphonesimulator/good-time.app");
}

function buildExact(udid: string): string {
  step("Build the Exact app (bun exact.mjs ios --release, iOS Simulator)");
  run(["bun", "exact.mjs", "contract", "types", "app.contract", "-o", "app.contract.d.ts"], { cwd: APP_DIR });
  const r = run(["bun", "exact.mjs", "ios", "--release", "--sim", udid, "--no-install"], { cwd: APP_DIR, env: { CARGO_TARGET_DIR: iosTarget }, log: join(work, "exact-build.log") });
  const m = (r.stdout + r.stderr).match(/host\/apple: (.+\.app) \(/);
  if (!m) throw Error(`could not find the built app in ${join(work, "exact-build.log")}`);
  return m[1];
}

function buildProbe(): string {
  step("Build the probe (perf/probe/GTPerfProbe.m)");
  const dylib = join(work, "probe", "GTPerfProbe.dylib");
  mkdirSync(dirname(dylib), { recursive: true });
  run(["xcrun", "-sdk", "iphonesimulator", "clang", "-arch", "arm64", "-mios-simulator-version-min=17.0", "-dynamiclib", "-fobjc-arc",
    "-framework", "Foundation", "-framework", "UIKit", "-framework", "QuartzCore", "-o", dylib, join(ROOT, "perf/probe/GTPerfProbe.m")]);
  run(["codesign", "-s", "-", "-f", dylib]);
  return dylib;
}

function buildRunner(udid: string): string {
  step("Build the journey runner (perf/runner, xcodegen + build-for-testing)");
  const dir = join(work, "runner");
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(ROOT, "perf/runner"), dir, { recursive: true });
  run(["xcodegen", "generate", "-q"], { cwd: dir });
  const dd = join(work, "runner-dd");
  run(["xcodebuild", "build-for-testing", "-project", "GTPerfRunner.xcodeproj", "-scheme", "GTPerfUITests", "-destination", `id=${udid}`, "-derivedDataPath", dd],
    { cwd: dir, log: join(work, "runner-build.log") });
  const products = join(dd, "Build/Products");
  const xctestrun = readdirSync(products).find((f) => f.endsWith(".xctestrun"));
  if (!xctestrun) throw Error(`no .xctestrun in ${products}`);
  return join(products, xctestrun);
}

// ---- Measurements ------------------------------------------------------------------------------------------
type Probe = { launch?: any; memory?: any; frames?: any };
function probeLines(text: string): Probe {
  const p: Probe = {};
  for (const line of text.split("\n")) {
    const m = line.match(/gtperf (\{.*\})\s*$/) ?? line.match(/^(\{.*"kind".*\})\s*$/);
    if (!m) continue;
    const o = JSON.parse(m[1]);
    (p as any)[o.kind] = o;
  }
  return p;
}

function launchOnce(udid: string, env: Record<string, string>): string {
  const childEnv = Object.fromEntries(Object.entries(env).map(([k, v]) => [`SIMCTL_CHILD_${k}`, v]));
  const r = run(["xcrun", "simctl", "launch", "--console-pty", "--terminate-running-process", udid, BUNDLE_ID],
    { env: childEnv, timeoutMs: 30000, check: false });
  sleep(1000);
  return r.stdout + r.stderr;
}

function measureLaunches(udid: string, app: string, probe: string, label: string) {
  step(`${label}: launches (probe), ${launches} after a first launch after install`);
  install(udid, app);
  const env = { DYLD_INSERT_LIBRARIES: probe, GTPERF_EXIT: "1" };
  const first = probeLines(launchOnce(udid, env));
  const runs: Probe[] = [];
  for (let i = 0; i < launches; i++) runs.push(probeLines(launchOnce(udid, env)));
  const ok = runs.filter((r) => r.launch && r.memory);
  if (ok.length < launches) console.log(`  ${launches - ok.length} launches printed no probe line`);
  const result = {
    firstAfterInstallMs: first.launch?.processToPresentMs ?? null,
    processToFirstFrameMs: stats(ok.map((r) => r.launch.processToPresentMs)),
    settledFootprintMB: stats(ok.map((r) => r.memory.settledFootprintMB)),
    layersAtFirstFrame: ok[0]?.launch.layers ?? null,
  };
  console.log(`  first frame ${result.processToFirstFrameMs.median} ms (median of ${ok.length}; first after install ${result.firstAfterInstallMs} ms); footprint ${result.settledFootprintMB.median} MB`);
  return result;
}

function measureSmoke(udid: string, app: string) {
  step(`Exact: launches with EXACT_SMOKE=1 (Exact's own startup marks), ${launches}`);
  install(udid, app);
  launchOnce(udid, { EXACT_SMOKE: "1" });
  const present: number[] = [], render: number[] = [], boot: number[] = [];
  let sample = "";
  for (let i = 0; i < launches; i++) {
    const text = launchOnce(udid, { EXACT_SMOKE: "1" });
    const observe = text.split("\n").find((l) => l.startsWith("observe:")) ?? "";
    const p = observe.match(/ present ([\d.]+)/), t = observe.match(/timeToFirstRender ([\d.]+) ms/), b = text.match(/^boot ([\d.]+) ms/m);
    if (p) present.push(Number(p[1]));
    if (t) render.push(Number(t[1]));
    if (b) boot.push(Number(b[1]));
    if (!sample && observe) sample = observe.trim();
  }
  const result = { processToPresentMs: stats(present), didFinishLaunchingToFirstRenderMs: stats(render), sessionBootMs: stats(boot), sample };
  console.log(`  present ${result.processToPresentMs.median} ms from process start (median of ${present.length})`);
  return result;
}

function measureJourneys(udid: string, app: string, probe: string, xctestrun: string, label: string) {
  step(`${label}: journeys (XCUITest, ${rounds} rounds of tab switches and settings), ${journeys}`);
  const results: any[] = [];
  for (let i = 0; i < journeys; i++) {
    install(udid, app);
    const bundle = join(work, `${label}-journey-${i}.xcresult`);
    rmSync(bundle, { recursive: true, force: true });
    const r = run(["xcodebuild", "test-without-building", "-xctestrun", xctestrun, "-destination", `id=${udid}`, "-resultBundlePath", bundle],
      { env: { TEST_RUNNER_GTPERF_PROBE: probe, TEST_RUNNER_GTPERF_ROUNDS: String(rounds) }, log: join(work, `${label}-journey-${i}.log`), check: false });
    const file = join(dataContainer(udid), "tmp", "gtperf.jsonl");
    const frames = existsSync(file) ? probeLines(readFileSync(file, "utf8")).frames : undefined;
    if (r.status !== 0 || !frames) { console.log(`  journey ${i + 1} failed (log: ${join(work, `${label}-journey-${i}.log`)})`); continue; }
    results.push(frames);
    console.log(`  journey ${i + 1}: motion ${frames.motion.intervals} frames, ${frames.motion.missedRefreshes} missed refreshes, max ${frames.motion.maxMs} ms; peak ${frames.peakFootprintMB} MB`);
  }
  const sum = (k: string, part = "motion") => results.reduce((a, r) => a + r[part][k], 0);
  return {
    journeys: results.length,
    touchesPerJourney: results[0]?.touches ?? null,
    periodMs: results[0]?.periodMs ?? null,
    motion: {
      frames: sum("intervals"), missedRefreshes: sum("missedRefreshes"), longFrames: sum("longFrames"),
      missedPer100Frames: round((100 * sum("missedRefreshes")) / Math.max(1, sum("intervals")), 2),
      medianMs: stats(results.map((r) => r.motion.medianMs)), p95Ms: stats(results.map((r) => r.motion.p95Ms)),
      p99Ms: stats(results.map((r) => r.motion.p99Ms)), maxMs: stats(results.map((r) => r.motion.maxMs)),
    },
    idle: { frames: sum("intervals", "idle"), missedRefreshes: sum("missedRefreshes", "idle"), maxMs: stats(results.map((r) => r.idle.maxMs)) },
    peakFootprintMB: stats(results.map((r) => r.peakFootprintMB)),
    raw: results,
  };
}

/** Exact's own perf operation: `perf frames live 1200` after each tap, on the development build the agent drives. */
function measureExactPerf(udid: string) {
  step("Exact: perf frames live after each tap (bun exact.mjs agent ios --timing platform, development build)");
  const live = "perf frames live 1200";
  const ops = ["perf frames live 1500", "tap intro-continue", live];
  for (let i = 0; i < rounds; i++) ops.push("tap tab-bedtime", live, "tap tab-wakeup", live);
  for (let i = 0; i < rounds; i++) ops.push("tap wakeup-settings", live, "back", live);
  const r = run(["bun", "exact.mjs", "agent", "ios", "--reset-storage", "--timing", "platform", "--json", ...ops],
    { cwd: APP_DIR, env: { EXACT_SIM: udid, CARGO_TARGET_DIR: iosTarget }, log: join(work, "exact-perf.log"), timeoutMs: 30 * 60_000, check: false });
  const replies = r.stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  const windows = replies.filter((x) => x.format === "exact.frame-health.metrics/2");
  if (r.status !== 0 || windows.length < 2) {
    console.log(`  the agent run failed (log: ${join(work, "exact-perf.log")})`);
    return { error: (r.stderr.split("\n").find((l) => l.includes("Error")) ?? "failed").slice(0, 400) };
  }
  const motion = windows.slice(1);
  const n = (x: any) => Number(x ?? 0);
  const upper = (b: any) => (Array.isArray(b) ? (b[1] == null ? Infinity : b[1] / 1e6) : 0);
  const result = {
    idle: { intervals: n(windows[0].frames.intervals), missedFrames: n(windows[0].frames.missedFrames) },
    motionWindows: motion.length,
    intervals: motion.reduce((a, w) => a + n(w.frames.intervals), 0),
    missedFrames: motion.reduce((a, w) => a + n(w.frames.missedFrames), 0),
    skippedRefreshes: motion.reduce((a, w) => a + n(w.assessments.cadence.predicates.skippedRefreshes), 0),
    worstFrameIntervalMs: round(Math.max(...motion.map((w) => n(w.frames.lifetimeMaximumIntervalNs) / 1e6))),
    frameP99UpperBoundMs: Math.max(...motion.map((w) => upper(w.frames.p99BoundsNs))),
    workMedianUpperBoundMs: median(motion.map((w) => upper(w.work.medianBoundsNs))),
    workP99UpperBoundMs: Math.max(...motion.map((w) => upper(w.work.p99BoundsNs))),
    cadence: Object.fromEntries(["fail", "proxy-pass", "insufficient-evidence", "not-applicable", "restricted"].map((k) => [k, motion.filter((w) => w.assessments.cadence.result === k).length])),
    windows: motion.map((w) => ({ intervals: n(w.frames.intervals), missedFrames: n(w.frames.missedFrames), maxNs: w.frames.maximumBoundsNs, workP99Ns: w.work.p99BoundsNs, cadence: w.assessments.cadence.result })),
  };
  console.log(`  ${result.intervals} frames in ${motion.length} windows, ${result.missedFrames} missed, worst interval ${result.worstFrameIntervalMs} ms`);
  return result;
}

function sizes(swiftSim: string, exactSim: string) {
  step("Sizes");
  const binary = (app: string) => {
    const plist = JSON.parse(run(["plutil", "-convert", "json", "-o", "-", join(app, "Info.plist")]).stdout);
    return statSync(join(app, plist.CFBundleExecutable)).size;
  };
  const result: any = {
    simulator: {
      swiftui: { appMB: mb(duBytes(swiftSim)), binaryMB: mb(binary(swiftSim)) },
      exact: { appMB: mb(duBytes(exactSim)), binaryMB: mb(binary(exactSim)) },
    },
  };
  if (device) {
    step("Build both apps for a device (Release, unsigned) for their download sizes");
    const dir = join(work, "device");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const archive = join(dir, "swiftui.xcarchive");
    run(["xcodebuild", "archive", "-project", "good-time.xcodeproj", "-scheme", "good-time", "-configuration", "Release",
      "-destination", "generic/platform=iOS", "-archivePath", archive, "CODE_SIGNING_ALLOWED=NO"], { log: join(dir, "swiftui.log") });
    const swiftApp = join(archive, "Products/Applications/good-time.app");
    mkdirSync(join(dir, "swiftui/Payload"), { recursive: true });
    cpSync(swiftApp, join(dir, "swiftui/Payload/good-time.app"), { recursive: true });
    run(["ditto", "-c", "-k", "--sequesterRsrc", "Payload", join(dir, "swiftui.ipa")], { cwd: join(dir, "swiftui") });
    const exactIpa = join(dir, "exact.ipa");
    run(["bun", "exact.mjs", "ios", "--release", "--device", "--archive", exactIpa, "--unsigned"],
      { cwd: APP_DIR, env: { CARGO_TARGET_DIR: releaseTarget }, log: join(dir, "exact.log"), timeoutMs: 60 * 60_000 });
    run(["ditto", "-x", "-k", exactIpa, join(dir, "exact")]);
    const exactApp = join(dir, "exact/Payload", readdirSync(join(dir, "exact/Payload")).find((f) => f.endsWith(".app"))!);
    result.device = {
      swiftui: { ipaMB: mb(statSync(join(dir, "swiftui.ipa")).size), appMB: mb(duBytes(swiftApp)), binaryMB: mb(binary(swiftApp)) },
      exact: { ipaMB: mb(statSync(exactIpa).size), appMB: mb(duBytes(exactApp)), binaryMB: mb(binary(exactApp)),
        largest: readdirSync(exactApp).map((f) => ({ f, s: duBytes(join(exactApp, f)) })).sort((a, b) => b.s - a.s).slice(0, 4).map((x) => `${x.f} ${mb(x.s)} MB`) },
    };
  }
  // The newest Exact build uploaded to TestFlight by scripts/beta-ios, if this Mac made one.
  const builds = join(homedir(), ".good-time/release/builds");
  if (existsSync(builds)) {
    const latest = readdirSync(builds).filter((d) => /^\d+$/.test(d)).sort((a, b) => Number(b) - Number(a))
      .find((d) => existsSync(join(builds, d, "artifacts/GoodTime.ipa")));
    if (latest) result.testflight = { build: Number(latest), ipaMB: mb(statSync(join(builds, latest, "artifacts/GoodTime.ipa")).size) };
  }
  console.log(JSON.stringify(result));
  return result;
}

// ---- Main --------------------------------------------------------------------------------------------------
mkdirSync(work, { recursive: true });
const started = Date.now();
const udid = simulator();
const swiftApp = buildSwiftUI();
const exactApp = buildExact(udid);
const probe = buildProbe();
const xctestrun = buildRunner(udid);

const sw = run(["sw_vers", "-productVersion"]).stdout.trim();
const xcode = run(["xcodebuild", "-version"]).stdout.split("\n")[0];
const chip = run(["sysctl", "-n", "machdep.cpu.brand_string"]).stdout.trim();
const runtime = run(["xcrun", "simctl", "list", "devices", "-j"]).stdout;
const runtimeName = Object.entries(JSON.parse(runtime).devices as Record<string, any[]>).find(([, d]) => d.some((x) => x.udid === udid))?.[0];

const results: any = {
  date,
  machine: { chip, macOS: sw, xcode, simulator: `${SIM_NAME}: iPhone 17 Pro, ${runtimeName}` },
  commits: {
    goodTime: run(["git", "rev-parse", "--short", "HEAD"]).stdout.trim(),
    exact: readFileSync(join(ROOT, "exact.pin"), "utf8").trim().slice(0, 7),
  },
  settings: { launches, journeys, rounds },
  swiftui: {}, exact: {},
};
results.swiftui.launch = measureLaunches(udid, swiftApp, probe, "SwiftUI");
results.exact.launch = measureLaunches(udid, exactApp, probe, "Exact");
results.exact.smoke = measureSmoke(udid, exactApp);
results.swiftui.journey = measureJourneys(udid, swiftApp, probe, xctestrun, "swiftui");
results.exact.journey = measureJourneys(udid, exactApp, probe, xctestrun, "exact");
if (exactPerf) results.exact.perf = measureExactPerf(udid);
results.sizes = sizes(swiftApp, exactApp);
results.seconds = Math.round((Date.now() - started) / 1000);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
step(`wrote ${out} (${results.seconds} s)`);
