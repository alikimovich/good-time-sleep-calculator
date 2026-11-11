// LKM-650: unit tests of the release job (scripts/release.ts), with fake git, Exact, fastlane and Apple.
// Run: bun test scripts/release.test.ts (the pinned Bun: ~/.bun-1.4.2/bin/bun).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  acquireLock,
  archiveEnv,
  type AppleStatus,
  assertOutsideRepo,
  type Deps,
  distributionIdentities,
  fastlaneArgs,
  fastlaneEnv,
  IPA_NAME,
  latestReceipt,
  loadConfig,
  makeShutdown,
  type Options,
  parseArgs,
  pickIdentity,
  planRetry,
  type ProfileFacts,
  profileProblems,
  readiness,
  release,
  releaseSettings,
  reserveBuildNumber,
  run,
  type Runner,
} from "./release";

const ROOT = resolve(import.meta.dir, "..");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const KEY_ID = "ABCDE12345";
const ISSUER = "69a6de70-0000-47e3-e053-5b8c7c11a4d1";
const SHA1 = "67D854599CF7A050623F80D3AD52D7A4F5C772DE";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "gt-release-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeConfig(extra: Record<string, unknown> = {}, keyMode = 0o600) {
  const key = join(dir, "AuthKey.p8");
  writeFileSync(key, "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n");
  chmodSync(key, keyMode);
  const profile = join(dir, "GoodTime_AppStore.mobileprovision");
  writeFileSync(profile, "profile");
  const path = join(dir, "good-time.json");
  writeFileSync(path, JSON.stringify({ key_id: KEY_ID, issuer_id: ISSUER, key_path: key, provisioning_profile: profile, ...extra }));
  return { path, key, profile };
}

describe("loadConfig", () => {
  test("reads identifiers and paths, not the key", () => {
    const { path, key, profile } = writeConfig({ testflight_group: "App Store Connect Users" });
    const result = loadConfig(path, ROOT);
    expect(result.problems).toEqual([]);
    expect(result.config).toEqual({ keyId: KEY_ID, issuerId: ISSUER, keyPath: key, profilePath: profile, identity: undefined, group: "App Store Connect Users" });
    const env = fastlaneEnv(result.config!);
    expect(env).toMatchObject({ GT_ASC_KEY_ID: KEY_ID, GT_ASC_ISSUER_ID: ISSUER, GT_ASC_KEY_PATH: key });
    expect(JSON.stringify(env)).not.toContain("not-a-real-key");
  });

  test("needs the App Store profile and names how to make one", () => {
    const { path } = writeConfig({ provisioning_profile: "" });
    expect(loadConfig(path, ROOT).problems.join(" ")).toContain("fastlane ios profile");
    const missing = writeConfig({ provisioning_profile: join(dir, "nope.mobileprovision") });
    expect(loadConfig(missing.path, ROOT).problems.join(" ")).toContain("does not exist");
  });

  test("reports a missing config, bad identifiers, a bad identity and a missing key file", () => {
    expect(loadConfig(join(dir, "none.json"), ROOT).problems[0]).toContain("does not exist");
    const { path } = writeConfig({ key_id: "x", issuer_id: "y", key_path: join(dir, "missing.p8"), signing_identity: "nope" });
    const problems = loadConfig(path, ROOT).problems.join("\n");
    expect(problems).toContain("key_id");
    expect(problems).toContain("issuer_id");
    expect(problems).toContain("missing.p8");
    expect(problems).toContain("signing_identity");
  });

  test("refuses a config inside the repository and warns about open key permissions", () => {
    expect(loadConfig(join(ROOT, "release.json"), ROOT).problems[0]).toContain("inside the repository");
    const { path } = writeConfig({}, 0o644);
    expect(loadConfig(path, ROOT).warnings[0]).toContain("readable by other users");
  });
});

test("assertOutsideRepo refuses release state in the repository", () => {
  expect(() => assertOutsideRepo(join(ROOT, "build"), ROOT, "GT_RELEASE_HOME")).toThrow("inside the repository");
  expect(() => assertOutsideRepo(dir, ROOT, "GT_RELEASE_HOME")).not.toThrow();
});

describe("signing", () => {
  const identities = `
  1) ${SHA1} "Apple Distribution: Andrei Alikimovich (ZMVK3ALPSD)"
  2) 1111111111111111111111111111111111111111 "Apple Development: Andrei Alikimovich (ABCDE12345)"
  3) 2222222222222222222222222222222222222222 "Apple Distribution: Someone Else (OTHERTEAM1)"
     3 valid identities found`;

  test("picks the team's only Apple Distribution identity, or the configured one", () => {
    expect(distributionIdentities(identities).map((i) => i.sha1)).toEqual([SHA1]);
    expect(pickIdentity(identities).sha1).toBe(SHA1);
    expect(pickIdentity(identities, SHA1.toLowerCase()).sha1).toBe(SHA1);
    expect(() => pickIdentity(identities, "2222222222222222222222222222222222222222")).toThrow("not a valid Apple Distribution identity");
    expect(() => pickIdentity("0 valid identities found")).toThrow("no valid Apple Distribution identity");
  });

  const profile: ProfileFacts = {
    name: "com.alikimovich.good-time-to-sleep AppStore",
    uuid: "05e35e18-bb99-40e3-9312-8046a74770fb",
    team: "ZMVK3ALPSD",
    appId: "ZMVK3ALPSD.com.alikimovich.good-time-to-sleep",
    getTaskAllow: false,
    hasDevices: false,
    provisionsAllDevices: false,
    expires: new Date("2027-11-03T04:56:51Z"),
    certificates: [SHA1],
  };
  const now = new Date("2026-11-11T00:00:00Z");

  test("accepts the App Store profile of this app and team with the identity's certificate", () => {
    expect(profileProblems(profile, SHA1, now)).toEqual([]);
  });

  test("refuses another app, a development or ad hoc profile, an expired one and a missing certificate", () => {
    expect(profileProblems({ ...profile, appId: "ZMVK3ALPSD.com.alikimovich.agentmessenger.daily" }, SHA1, now)[0]).toContain("App ID");
    expect(profileProblems({ ...profile, getTaskAllow: true, hasDevices: true }, SHA1, now)[0]).toContain("not an App Store profile");
    expect(profileProblems(profile, SHA1, new Date("2028-01-01"))[0]).toContain("expired");
    expect(profileProblems(profile, "3333333333333333333333333333333333333333", now)[0]).toContain("signing certificate");
  });
});

describe("acquireLock", () => {
  test("lets one job in and names the holder to the next", () => {
    const unlock = acquireLock(dir, "scripts/beta-ios");
    expect(() => acquireLock(dir, "scripts/beta-ios", new Date(), () => true, 999_999)).toThrow("Another release job holds the lock");
    unlock();
    expect(existsSync(join(dir, "lock"))).toBe(false);
  });

  test("takes over a lock whose process is gone", () => {
    acquireLock(dir, "old", new Date(), () => true, 12345);
    const unlock = acquireLock(dir, "new", new Date(), () => false);
    expect(JSON.parse(readFileSync(join(dir, "lock", "owner.json"), "utf8")).command).toBe("new");
    unlock();
  });
});

describe("reserveBuildNumber", () => {
  test("is unique and monotonic, above the local counter, Apple and the SwiftUI app's build 3", () => {
    expect(reserveBuildNumber(dir, 0)).toBe(4);
    expect(reserveBuildNumber(dir, 4)).toBe(5);
    expect(reserveBuildNumber(dir, 2)).toBe(6);
    expect(reserveBuildNumber(dir, 10)).toBe(11);
    expect(readFileSync(join(dir, "build-number"), "utf8")).toBe("11\n");
  });

  test("refuses a corrupt counter or Apple value", () => {
    writeFileSync(join(dir, "build-number"), "abc");
    expect(() => reserveBuildNumber(dir, 1)).toThrow("not a build number");
    rmSync(join(dir, "build-number"));
    expect(() => reserveBuildNumber(dir, -1)).toThrow("invalid build number");
  });
});

describe("readiness and planRetry", () => {
  const READY: AppleStatus = { app_record: true, found: true, processing_state: "VALID", internal_build_state: "IN_BETA_TESTING", group: "App Store Connect Users" };

  test("uploaded and processed are not ready; IN_BETA_TESTING in a group is", () => {
    expect(readiness({ app_record: true, found: false }).state).toBe("waiting");
    expect(readiness({ app_record: true, found: true, processing_state: "PROCESSING" }).state).toBe("waiting");
    expect(readiness({ ...READY, internal_build_state: "READY_FOR_BETA_TESTING" }).state).toBe("waiting");
    expect(readiness(READY).state).toBe("ready");
  });

  test("fails with a reason the owner can act on", () => {
    expect(readiness({ app_record: false, found: false }).message).toContain("no app record");
    expect(readiness({ ...READY, processing_state: "INVALID" }).state).toBe("failed");
    expect(readiness({ ...READY, group: undefined }).message).toContain("internal TestFlight group");
    expect(readiness({ ...READY, internal_build_state: "MISSING_EXPORT_COMPLIANCE" }).message).toContain("export compliance");
  });

  test("retries keep the build number unless Apple rejected the artifact", () => {
    const r = { upload_status: "failed" } as any;
    expect(planRetry(r, READY, true)).toBe("wait");
    expect(planRetry(r, { ...READY, processing_state: "FAILED" }, true)).toBe("new_number");
    expect(planRetry(r, { app_record: true, found: false }, true)).toBe("upload");
    expect(planRetry(r, { app_record: true, found: false }, false)).toBe("archive");
    expect(planRetry({ upload_status: "uploaded" } as any, { app_record: true, found: false }, false)).toBe("wait");
  });
});

describe("release settings and the Exact build environment", () => {
  test("the committed release.json is valid and above the App Store's released 1.0.4", () => {
    const s = releaseSettings(readFileSync(join(ROOT, "release.json"), "utf8"));
    const [a, b, c] = s.marketingVersion.split(".").map(Number);
    expect(a * 1e6 + (b ?? 0) * 1e3 + (c ?? 0)).toBeGreaterThan(1 * 1e6 + 0 * 1e3 + 4);
    expect(s.nonExemptEncryption).toBe(false);
  });

  test("refuses a bad version or a missing encryption answer", () => {
    expect(() => releaseSettings(`{"marketing_version":"v2","uses_non_exempt_encryption":false}`)).toThrow("marketing_version");
    expect(() => releaseSettings(`{"marketing_version":"1.1.0"}`)).toThrow("uses_non_exempt_encryption");
  });

  test("passes the identity, profile, numbers and pinned toolchain to Exact, and no key material", () => {
    const env = archiveEnv({
      exactDir: "/x/exact",
      target: "/x/target",
      identity: SHA1,
      profilePath: "/x/p.mobileprovision",
      buildNumber: 7,
      settings: { marketingVersion: "1.1.0", nonExemptEncryption: false },
      home: "/h",
    });
    expect(env).toMatchObject({
      EXACT2: "/x/exact",
      CARGO_TARGET_DIR: "/x/target",
      EXACT_IDENTITY: SHA1,
      EXACT_PROFILE: "/x/p.mobileprovision",
      EXACT_BUILD_NUMBER: "7",
      EXACT_VERSION: "1.1.0",
      EXACT_NON_EXEMPT_ENCRYPTION: "false",
      EXACT_FEEDBACK: "0",
    });
    expect(env.PATH).toStartWith("/h/.bun-1.4.2/bin:/h/.cargo/bin:");
  });
});

test("parseArgs and fastlaneArgs", () => {
  expect(parseArgs([])).toEqual({ ref: "HEAD", forceNew: false, doctor: false });
  expect(parseArgs(["abc123", "--force-new"])).toEqual({ ref: "abc123", forceNew: true, doctor: false });
  expect(parseArgs(["--doctor"])).toEqual({ ref: "HEAD", forceNew: false, doctor: true });
  expect(() => parseArgs(["a", "b"])).toThrow("usage");
  expect(() => parseArgs(["--submit"])).toThrow("usage");
  expect(() => parseArgs(["--doctor", "abc"])).toThrow("usage");
  expect(fastlaneArgs({ build_number: 7, ensure_group: true })).toEqual(["build_number:7", "ensure_group:true"]);
});

// ---- The job, with fake git, Exact, fastlane and Apple --------------------------------------------

type Fake = Deps & { calls: string[]; apple: AppleStatus[]; appleMax: number; failUpload?: boolean; badIpa?: boolean };

function fakeDeps(): Fake {
  let clock = Date.parse("2026-11-11T10:00:00Z");
  const fake: Fake = {
    calls: [],
    apple: [],
    appleMax: 4,
    async resolveCommit(ref) {
      fake.calls.push(`resolve ${ref}`);
      return SHA;
    },
    async exportTree(sha, dest) {
      fake.calls.push(`export ${sha.slice(0, 7)}`);
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, "release.json"), `{"marketing_version":"1.1.0","uses_non_exempt_encryption":false}`);
    },
    async archive(r, settings) {
      fake.calls.push(`archive ${r.build_number} ${r.short_sha} ${settings.marketingVersion}`);
      writeFileSync(join(r.paths.artifacts, IPA_NAME), "ipa");
      mkdirSync(join(r.paths.artifacts, "GoodTime.dSYMs"), { recursive: true });
      return "c582b3b52da71ec5882fee338cad5ce150a7ff4d";
    },
    async verifyIpa(r) {
      fake.calls.push(`verify ${r.build_number}`);
      if (fake.badIpa) throw Error("CFBundleVersion is wrong");
    },
    async upload(r) {
      fake.calls.push(`upload ${r.build_number}`);
      if (fake.failUpload) throw Error("upload failed");
    },
    async latestBuildNumber() {
      fake.calls.push("latest");
      return fake.appleMax;
    },
    async status(r, ensureGroup) {
      fake.calls.push(`status ${r.build_number}${ensureGroup ? " ensure" : ""}`);
      return fake.apple.length > 1 ? fake.apple.shift()! : (fake.apple[0] ?? { app_record: true, found: false });
    },
    async sleep(ms) {
      fake.calls.push("sleep");
      clock += ms;
    },
    now: () => new Date(clock),
    say() {},
  };
  // The fake archive writes into the artifacts directory, as Exact does with --archive <path>.
  const archive = fake.archive;
  fake.archive = async (r, s, log) => {
    mkdirSync(r.paths.artifacts, { recursive: true });
    return archive(r, s, log);
  };
  return fake;
}

const READY: AppleStatus = { app_record: true, found: true, processing_state: "VALID", internal_build_state: "IN_BETA_TESTING", group: "App Store Connect Users" };
const opts = (o: Partial<Options> = {}): Options => ({ home: dir, ref: "HEAD", forceNew: false, pollMs: 60_000, timeoutMs: 600_000, ...o });

describe("release", () => {
  test("builds a clean tree, verifies, uploads and waits until internal testers can install", async () => {
    const deps = fakeDeps();
    deps.apple = [
      { app_record: true, found: false },
      { app_record: true, found: true, processing_state: "PROCESSING" },
      { ...READY, internal_build_state: "READY_FOR_BETA_TESTING" },
      READY,
    ];
    const r = await release(opts(), deps);
    expect(deps.calls).toEqual([
      "resolve HEAD",
      "latest",
      "export 0123456",
      "archive 5 0123456 1.1.0",
      "verify 5",
      "upload 5",
      "status 5 ensure",
      "sleep",
      "status 5 ensure",
      "sleep",
      "status 5 ensure",
      "sleep",
      "status 5 ensure",
    ]);
    expect(r).toMatchObject({
      status: "ready",
      ready_to_install: true,
      build_number: 5,
      marketing_version: "1.1.0",
      exact_commit: "c582b3b52da71ec5882fee338cad5ce150a7ff4d",
      upload_status: "uploaded",
      processing_status: "VALID",
      internal_build_state: "IN_BETA_TESTING",
      testflight_group: "App Store Connect Users",
    });
    for (const t of ["reserved_at", "archive_started_at", "archived_at", "upload_started_at", "uploaded_at", "processed_at", "ready_at"]) expect(r.timestamps[t]).toBeString();
    expect(r.paths.ipa).toEndWith(IPA_NAME);
    expect(r.paths.dsyms).toEndWith("GoodTime.dSYMs");
    expect(existsSync(r.paths.source)).toBe(false);
    expect(JSON.parse(readFileSync(r.paths.receipt, "utf8")).status).toBe("ready");
  });

  test("a commit that is already ready is not built again unless forced", async () => {
    const first = fakeDeps();
    first.apple = [READY];
    await release(opts(), first);
    const again = fakeDeps();
    expect((await release(opts(), again)).build_number).toBe(5);
    expect(again.calls).toEqual(["resolve HEAD"]);
    const forced = fakeDeps();
    forced.apple = [READY];
    expect((await release(opts({ forceNew: true }), forced)).build_number).toBe(6);
  });

  test("an .ipa that fails verification is never uploaded", async () => {
    const deps = fakeDeps();
    deps.badIpa = true;
    await expect(release(opts(), deps)).rejects.toThrow("CFBundleVersion");
    expect(deps.calls).not.toContain("upload 5");
    expect(latestReceipt(dir, SHA)!.failure?.stage).toBe("archive");
  });

  test("a failed upload is retried with the same artifact and build number after asking Apple", async () => {
    const first = fakeDeps();
    first.failUpload = true;
    await expect(release(opts(), first)).rejects.toThrow("upload failed");
    const failed = latestReceipt(dir, SHA)!;
    expect(failed).toMatchObject({ status: "failed", upload_status: "failed", failure: { stage: "upload" } });
    const retry = fakeDeps();
    retry.apple = [{ app_record: true, found: false }, READY];
    const r = await release(opts(), retry);
    expect(retry.calls).toEqual(["resolve HEAD", "status 5", "upload 5", "status 5 ensure"]);
    expect(r.build_number).toBe(5);
    expect(r.status).toBe("ready");
  });

  test("a build Apple rejected gets a new build number", async () => {
    const first = fakeDeps();
    first.apple = [{ ...READY, processing_state: "INVALID" }];
    await expect(release(opts(), first)).rejects.toThrow("INVALID");
    const retry = fakeDeps();
    retry.apple = [{ ...READY, processing_state: "INVALID" }];
    retry.status = async (r, ensure) => {
      retry.calls.push(`status ${r.build_number}${ensure ? " ensure" : ""}`);
      return r.build_number === 5 ? { ...READY, processing_state: "INVALID" } : READY;
    };
    const r = await release(opts(), retry);
    expect(r.build_number).toBe(6);
    expect(JSON.parse(readFileSync(join(dir, "receipts", "5.json"), "utf8")).status).toBe("failed");
  });

  test("a processing timeout leaves the receipt resumable under the same build number", async () => {
    const first = fakeDeps();
    first.apple = [{ app_record: true, found: true, processing_state: "PROCESSING" }];
    await expect(release(opts({ timeoutMs: 120_000 }), first)).rejects.toThrow("scripts/beta-ios 0123456 again");
    expect(latestReceipt(dir, SHA)!.status).toBe("processing");
    const resume = fakeDeps();
    resume.apple = [READY];
    const r = await release(opts(), resume);
    expect(resume.calls).toEqual(["resolve HEAD", "status 5", "status 5 ensure"]);
    expect(r.build_number).toBe(5);
  });
});

describe("shutdown", () => {
  test("a second signal does nothing, and no new command starts while stopping", async () => {
    const r: Runner = { children: new Set(), stopping: false };
    const exits: number[] = [];
    const shutdown = makeShutdown({ runner: r, unlock: () => {}, exit: (code) => exits.push(code), graceMs: 10 });
    await Promise.all([shutdown(143), shutdown(130)]);
    expect(exits).toEqual([143]);
    await expect(run(["true"], { cwd: dir, log: join(dir, "x.log") }, r)).rejects.toThrow("stopping");
  });

  test("run streams output to the log and fails with the log's path", async () => {
    const log = join(dir, "run.log");
    const r: Runner = { children: new Set(), stopping: false };
    expect(await run(["sh", "-c", "echo out; echo err >&2"], { cwd: dir, log }, r)).toBe("out\n");
    expect(readFileSync(log, "utf8")).toContain("err");
    await expect(run(["sh", "-c", "exit 3"], { cwd: dir, log }, r)).rejects.toThrow(`exit code 3. Log: ${log}`);
  });
});

// ---- fastlane: the lanes never reach review or external testers ---------------------------------

describe("fastlane", () => {
  const fastfile = readFileSync(join(ROOT, "fastlane", "Fastfile"), "utf8");

  test("upload is internal only: no submission, no external distribution, no waiting", () => {
    const upload = fastfile.slice(fastfile.indexOf("lane :upload"), fastfile.indexOf("lane :status"));
    expect(upload).toContain("skip_submission: true");
    expect(upload).toContain("distribute_external: false");
    expect(upload).toContain("skip_waiting_for_build_processing: true");
    // No lane can submit for review, publish to the App Store or name tester groups for distribution.
    const code = fastfile.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(code).not.toMatch(/submit_for_review|deliver\(|upload_to_app_store|app_store_build_number|distribute_external:\s*true|\bgroups:/);
  });

  test("the paging helper finds the highest build number across pages", () => {
    const script = `
      require "json"
      require ARGV[0]
      FakeBuild = Struct.new(:version)
      class FakePage
        def initialize(pages, index); @pages = pages; @index = index; end
        def to_models; @pages[@index].map { |v| FakeBuild.new(v) }; end
        def next_page; @index + 1 < @pages.length ? FakePage.new(@pages, @index + 1) : nil; end
      end
      puts JSON.generate(GoodTimeBuildNumbers.max_build_number(FakePage.new(JSON.parse(STDIN.read), 0)))
    `;
    const builds = Array.from({ length: 450 }, (_, i) => String(450 - i));
    builds[420] = "999";
    const proc = Bun.spawnSync(["ruby", "-e", script, join(ROOT, "fastlane", "build_numbers.rb")], {
      stdin: new TextEncoder().encode(JSON.stringify([builds.slice(0, 200), builds.slice(200, 400), builds.slice(400)])),
    });
    expect(proc.exitCode).toBe(0);
    expect(JSON.parse(proc.stdout.toString())).toEqual({ max: 999, builds: 450, pages: 3 });
  });
});
