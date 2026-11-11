#!/usr/bin/env bun
// LKM-650: the serialized internal TestFlight release job of the Exact app. scripts/beta-ios runs it.
// The design is agent-messenger's scripts/release.ts (LKM-439), for one app and an Exact build:
//   scripts/beta-ios                  # a clean tree of HEAD
//   scripts/beta-ios <commit>         # any commit-ish
//   scripts/beta-ios <commit> --force-new   # another build of a commit that is already ready
//   scripts/beta-ios --doctor         # checks the key, the signing identity, the profile and Apple; changes nothing
// One job at a time (a lock in the release home). Each build gets a receipt, logs and dSYMs there.
// A retry of the same commit asks Apple about the existing artifact before it reserves a new build
// number, so a re-run keeps the build number and the .ipa whenever Apple allows it.
//
// The build: `git archive` of the commit, then in its exact-app/ `bun exact.mjs ios --device --archive`
// with the Apple Distribution identity and the App Store profile (Exact signs the .ipa itself; it has no
// upload), the reserved build number (EXACT_BUILD_NUMBER) and release.json's marketing version
// (EXACT_VERSION). fastlane uploads it to internal TestFlight (never review, never external testers),
// then the job polls Apple until the build is processed (VALID) and IN_BETA_TESTING for the internal
// group. "Uploaded" is not "ready to install".
//
// Environment:
//   GT_RELEASE_HOME     release state, outside the repository (default ~/.good-time/release)
//   GT_RELEASE_CONFIG   App Store Connect key config (default ~/.appstoreconnect/good-time.json)
//   GT_RELEASE_TARGET   the release build's Cargo target, kept between builds (default ~/.cache/good-time/exact-release-target)
//   EXACT_DIR           the Exact checkout (default ~/dev/exact); it must be at the commit's exact.pin
//   GT_PROCESSING_POLL_SECONDS (default 60), GT_PROCESSING_TIMEOUT_MINUTES (default 90)
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir, hostname, constants as osConstants } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

export const TEAM_ID = "ZMVK3ALPSD";
export const BUNDLE_ID = "com.alikimovich.good-time-to-sleep";
export const IPA_NAME = "GoodTime.ipa";
/** The SwiftUI app shipped builds up to 3 (Apple's highest is 4). Every Exact build is above this. */
export const MIN_BUILD_NUMBER = 3;
export const LOCALE = { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
export const BUN_VERSION = "1.4.2";

type Env = Record<string, string | undefined>;
const expandHome = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

export function releaseHome(env: Env) {
  return resolve(expandHome(env.GT_RELEASE_HOME || join(homedir(), ".good-time", "release")));
}

export function configPath(env: Env) {
  return resolve(expandHome(env.GT_RELEASE_CONFIG || join(homedir(), ".appstoreconnect", "good-time.json")));
}

export function releaseTarget(env: Env) {
  return resolve(expandHome(env.GT_RELEASE_TARGET || join(homedir(), ".cache", "good-time", "exact-release-target")));
}

export function exactDir(env: Env) {
  return resolve(expandHome(env.EXACT_DIR || join(homedir(), "dev", "exact")));
}

function isInside(path: string, root: string) {
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p));
  const rel = relative(real(root), real(path));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

/** Throws if state or secrets would land inside the repository. */
export function assertOutsideRepo(path: string, root: string, what: string) {
  if (isInside(path, root)) throw Error(`${what} (${path}) is inside the repository. Put it outside ${root}.`);
}

// ---- App Store Connect key config ----------------------------------------------------------------

/** Only identifiers and paths. The key itself stays in its .p8 file and is never read here. */
export type ReleaseConfig = {
  keyId: string;
  issuerId: string;
  keyPath: string;
  /** The installed App Store provisioning profile for BUNDLE_ID: a .mobileprovision path. */
  profilePath: string;
  /** The Apple Distribution identity's SHA-1. Default: the keychain's one Apple Distribution identity of TEAM_ID. */
  identity?: string;
  group?: string;
};
export type ConfigResult = { path: string; config?: ReleaseConfig; problems: string[]; warnings: string[] };

export const CONFIG_EXAMPLE = `{"key_id": "<key ID>", "issuer_id": "<issuer ID>", "key_path": "~/.appstoreconnect/private_keys/AuthKey_<key ID>.p8", "provisioning_profile": "~/.good-time/release/profiles/GoodTime_AppStore.mobileprovision", "signing_identity": "<SHA-1, optional>", "testflight_group": "<internal group name, optional>"}`;

export function loadConfig(path: string, repoRoot: string): ConfigResult {
  const result: ConfigResult = { path, problems: [], warnings: [] };
  if (!existsSync(path)) {
    result.problems.push(`The release config ${path} does not exist. Write one like ${CONFIG_EXAMPLE}`);
    return result;
  }
  if (isInside(path, repoRoot)) {
    result.problems.push(`The release config ${path} is inside the repository. Move it outside.`);
    return result;
  }
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    result.problems.push(`The release config ${path} is not valid JSON.`);
    return result;
  }
  const str = (key: string) => (typeof raw?.[key] === "string" ? raw[key].trim() : "");
  const keyId = str("key_id");
  const issuerId = str("issuer_id");
  if (!/^[A-Z0-9]{8,12}$/.test(keyId)) result.problems.push(`key_id in ${path} is missing or not a key ID.`);
  if (!/^[0-9a-f-]{36}$/i.test(issuerId)) result.problems.push(`issuer_id in ${path} is missing or not an issuer UUID.`);
  const keyPath = resolve(expandHome(str("key_path") || `~/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`));
  if (!existsSync(keyPath)) result.problems.push(`The API key file ${keyPath} does not exist.`);
  else if (isInside(keyPath, repoRoot)) result.problems.push(`The API key file ${keyPath} is inside the repository. Move it outside.`);
  else if ((statSync(keyPath).mode & 0o077) !== 0) result.warnings.push(`The API key file ${keyPath} is readable by other users.`);
  const profile = str("provisioning_profile");
  const profilePath = profile ? resolve(expandHome(profile)) : "";
  if (!profilePath)
    result.problems.push(
      `provisioning_profile in ${path} is missing: the path of the App Store profile for ${BUNDLE_ID}. ` +
        `Create and install one with: fastlane ios profile output_directory:$HOME/.good-time/release/profiles output:/dev/stdout (see docs/release.md).`,
    );
  else if (!existsSync(profilePath)) result.problems.push(`The provisioning profile ${profilePath} does not exist.`);
  else if (isInside(profilePath, repoRoot)) result.problems.push(`The provisioning profile ${profilePath} is inside the repository. Move it outside.`);
  const identity = str("signing_identity") || undefined;
  if (identity && !/^[0-9A-F]{40}$/i.test(identity)) result.problems.push(`signing_identity in ${path} is not a SHA-1.`);
  if (result.problems.length === 0) result.config = { keyId, issuerId, keyPath, profilePath, identity, group: str("testflight_group") || undefined };
  return result;
}

/** The environment the fastlane lanes read. Identifiers and a path only, never key material. */
export function fastlaneEnv(config: ReleaseConfig): Record<string, string> {
  return {
    ...LOCALE,
    FASTLANE_SKIP_UPDATE_CHECK: "1",
    FASTLANE_HIDE_CHANGELOG: "1",
    GT_ASC_KEY_ID: config.keyId,
    GT_ASC_ISSUER_ID: config.issuerId,
    GT_ASC_KEY_PATH: config.keyPath,
  };
}

// ---- Signing material ------------------------------------------------------------------------------

/** The Apple Distribution identities of TEAM_ID in `security find-identity -v -p codesigning` output. */
export function distributionIdentities(findIdentityOutput: string) {
  return [...findIdentityOutput.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(Apple Distribution: [^"]*\(([A-Z0-9]+)\))"/gm)]
    .filter((m) => m[3] === TEAM_ID)
    .map((m) => ({ sha1: m[1], name: m[2] }));
}

/** The identity to sign with: the configured SHA-1 if it is valid in the keychain, else the only Apple Distribution one. */
export function pickIdentity(findIdentityOutput: string, configured?: string) {
  const found = distributionIdentities(findIdentityOutput);
  if (configured) {
    const match = found.find((i) => i.sha1.toUpperCase() === configured.toUpperCase());
    if (!match) throw Error(`signing_identity ${configured} is not a valid Apple Distribution identity of team ${TEAM_ID} in the keychain.`);
    return match;
  }
  if (found.length === 1) return found[0];
  if (found.length === 0) throw Error(`The keychain has no valid Apple Distribution identity of team ${TEAM_ID}. Install the certificate and its private key.`);
  throw Error(`The keychain has ${found.length} Apple Distribution identities of team ${TEAM_ID}. Name one with signing_identity (its SHA-1) in the release config.`);
}

export type ProfileFacts = {
  name: string;
  uuid: string;
  team: string;
  appId: string;
  getTaskAllow: boolean;
  hasDevices: boolean;
  provisionsAllDevices: boolean;
  expires: Date;
  /** SHA-1s of the certificates the profile allows, upper case. */
  certificates: string[];
};

/** Problems that keep the profile from signing an App Store build of BUNDLE_ID with `identitySha1`. */
export function profileProblems(p: ProfileFacts, identitySha1: string, now: Date) {
  const problems: string[] = [];
  if (p.team !== TEAM_ID) problems.push(`it is for team ${p.team}, not ${TEAM_ID}`);
  if (p.appId !== `${TEAM_ID}.${BUNDLE_ID}`) problems.push(`its App ID is ${p.appId}, not ${TEAM_ID}.${BUNDLE_ID}`);
  if (p.getTaskAllow || p.hasDevices || p.provisionsAllDevices) problems.push("it is not an App Store profile (it allows debugging or lists devices)");
  if (p.expires.getTime() <= now.getTime()) problems.push(`it expired on ${p.expires.toISOString()}`);
  if (!p.certificates.includes(identitySha1.toUpperCase())) problems.push(`it does not include the signing certificate ${identitySha1}`);
  return problems;
}

// ---- Lock -------------------------------------------------------------------------------------------

export function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

type LockOwner = { pid: number; host: string; started_at: string; command: string };

/**
 * Takes the release lock (an atomic mkdir) or throws with the holder. A lock whose process is gone
 * is stale and is taken over. Returns the release function.
 */
export function acquireLock(home: string, command: string, now = new Date(), alive = isAlive, pid = process.pid) {
  mkdirSync(home, { recursive: true });
  const dir = join(home, "lock");
  const ownerFile = join(dir, "owner.json");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dir);
      const owner: LockOwner = { pid, host: hostname(), started_at: now.toISOString(), command };
      writeFileSync(ownerFile, JSON.stringify(owner, null, 2));
      return () => {
        try {
          if (JSON.parse(readFileSync(ownerFile, "utf8")).pid === pid) rmSync(dir, { recursive: true, force: true });
        } catch {}
      };
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
    }
    let owner: LockOwner | undefined;
    try {
      owner = JSON.parse(readFileSync(ownerFile, "utf8"));
    } catch {}
    // An owner file that is still missing a minute after mkdir belongs to a job that died in between.
    const stale = owner ? !alive(owner.pid) : now.getTime() - statSync(dir).mtimeMs > 60_000;
    if (!stale)
      throw Error(
        owner
          ? `Another release job holds the lock: pid ${owner.pid} since ${owner.started_at} (${owner.command}). Wait for it to finish.`
          : `Another release job is starting (lock ${dir}). Try again in a minute.`,
      );
    rmSync(dir, { recursive: true, force: true });
  }
  throw Error(`Could not take the release lock ${dir}. Another job took it first; try again.`);
}

// ---- Build numbers and receipts -----------------------------------------------------------------

function writeAtomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Reserves the next build number: above the local counter, the highest one Apple knows and MIN_BUILD_NUMBER. Hold the lock. */
export function reserveBuildNumber(home: string, appleMax: number) {
  const file = join(home, "build-number");
  const text = existsSync(file) ? readFileSync(file, "utf8").trim() : "0";
  if (!/^\d+$/.test(text)) throw Error(`${file} holds '${text}', not a build number. Fix it by hand.`);
  if (!Number.isInteger(appleMax) || appleMax < 0) throw Error(`Apple reported an invalid build number: ${appleMax}`);
  const next = Math.max(Number(text), appleMax, MIN_BUILD_NUMBER) + 1;
  writeAtomic(file, `${next}\n`);
  return next;
}

export type Status = "reserved" | "archiving" | "archived" | "uploading" | "uploaded" | "processing" | "ready" | "failed";

export type Receipt = {
  schema: 1;
  bundle_id: string;
  marketing_version: string;
  build_number: number;
  commit_sha: string;
  short_sha: string;
  exact_commit: string | null;
  status: Status;
  upload_status: "not_started" | "uploading" | "uploaded" | "failed";
  /** Apple's processingState: PROCESSING, VALID, FAILED or INVALID. */
  processing_status: string | null;
  /** Apple's internal TestFlight state. IN_BETA_TESTING means internal testers can install it. */
  internal_build_state: string | null;
  testflight_group: string | null;
  ready_to_install: boolean;
  failure: { stage: string; message: string } | null;
  timestamps: Record<string, string>;
  attempts: { at: string; action: string }[];
  paths: {
    receipt: string;
    build_dir: string;
    source: string;
    artifacts: string;
    ipa: string | null;
    dsyms: string | null;
    logs: Record<string, string>;
  };
};

export function newReceipt(home: string, sha: string, buildNumber: number, now: Date): Receipt {
  const buildDir = join(home, "builds", `${buildNumber}`);
  const logs = join(buildDir, "logs");
  return {
    schema: 1,
    bundle_id: BUNDLE_ID,
    marketing_version: "",
    build_number: buildNumber,
    commit_sha: sha,
    short_sha: sha.slice(0, 7),
    exact_commit: null,
    status: "reserved",
    upload_status: "not_started",
    processing_status: null,
    internal_build_state: null,
    testflight_group: null,
    ready_to_install: false,
    failure: null,
    timestamps: { reserved_at: now.toISOString(), updated_at: now.toISOString() },
    attempts: [],
    paths: {
      receipt: join(home, "receipts", `${buildNumber}.json`),
      build_dir: buildDir,
      source: join(buildDir, "src"),
      artifacts: join(buildDir, "artifacts"),
      ipa: null,
      dsyms: null,
      logs: {
        export: join(logs, "export.log"),
        archive: join(logs, "archive.log"),
        upload: join(logs, "upload.log"),
        status: join(logs, "status.log"),
      },
    },
  };
}

export function saveReceipt(receipt: Receipt, now: Date) {
  receipt.timestamps.updated_at = now.toISOString();
  writeAtomic(receipt.paths.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
}

/** The newest receipt for this commit, if any. */
export function latestReceipt(home: string, sha: string): Receipt | undefined {
  const dir = join(home, "receipts");
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(dir, f), "utf8")) as Receipt];
      } catch {
        return [];
      }
    })
    .filter((r) => r.commit_sha === sha)
    .sort((a, b) => b.build_number - a.build_number)[0];
}

// ---- Apple status and the retry plan -----------------------------------------------------------

/** What the fastlane `status` lane writes. */
export type AppleStatus = {
  app_record: boolean;
  found: boolean;
  processing_state?: string;
  internal_build_state?: string;
  group?: string;
  group_has_all_builds?: boolean;
  group_added?: boolean;
};

export type RetryPlan = "archive" | "upload" | "wait" | "new_number";

/**
 * How to continue an unfinished receipt, given what Apple has for its build number.
 * Apple has it: wait, unless Apple rejected it (then the number is used up).
 * Apple does not have it: wait if our upload finished (Apple can be slow to list it), re-upload the
 * same .ipa if we have one, otherwise archive again under the same number.
 */
export function planRetry(receipt: Receipt, apple: AppleStatus, ipaExists: boolean): RetryPlan {
  if (apple.found) return apple.processing_state === "FAILED" || apple.processing_state === "INVALID" ? "new_number" : "wait";
  if (receipt.upload_status === "uploaded") return "wait";
  return ipaExists ? "upload" : "archive";
}

export type Readiness = { state: "ready" | "waiting" | "failed"; message: string };

/** "Uploaded" is not "ready to install": ready means processed, in an internal group, IN_BETA_TESTING. */
export function readiness(s: AppleStatus): Readiness {
  if (!s.app_record) return { state: "failed", message: "App Store Connect has no app record for this bundle ID. Run scripts/beta-ios --doctor." };
  if (!s.found) return { state: "waiting", message: "Apple does not list the build yet." };
  if (s.processing_state === "FAILED" || s.processing_state === "INVALID")
    return { state: "failed", message: `Apple processing ended in ${s.processing_state}. See App Store Connect, TestFlight.` };
  if (s.processing_state !== "VALID") return { state: "waiting", message: `Apple processing: ${s.processing_state ?? "unknown"}.` };
  if (!s.group) return { state: "failed", message: "The app has no internal TestFlight group (or not the configured one). Run scripts/beta-ios --doctor." };
  switch (s.internal_build_state) {
    case "IN_BETA_TESTING":
      return { state: "ready", message: `Ready to install for internal group '${s.group}'.` };
    case "MISSING_EXPORT_COMPLIANCE":
      return { state: "failed", message: "Apple wants export compliance information. Answer it in App Store Connect, TestFlight." };
    case "EXPIRED":
      return { state: "failed", message: "The build expired in TestFlight." };
    default:
      return { state: "waiting", message: `Processed; internal TestFlight state ${s.internal_build_state ?? "unknown"}.` };
  }
}

/** The committed release settings (release.json at the repository root). */
export type ReleaseSettings = { marketingVersion: string; nonExemptEncryption: boolean };

export function releaseSettings(text: string): ReleaseSettings {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error("release.json is not valid JSON");
  }
  const v = raw?.marketing_version;
  if (typeof v !== "string" || !/^\d+(\.\d+){0,2}$/.test(v)) throw Error(`release.json marketing_version must be like 1.1.0, got ${JSON.stringify(v)}`);
  if (typeof raw?.uses_non_exempt_encryption !== "boolean") throw Error("release.json uses_non_exempt_encryption must be true or false");
  return { marketingVersion: v, nonExemptEncryption: raw.uses_non_exempt_encryption };
}

/** The environment of the Exact archive build. Paths and identifiers only. */
export function archiveEnv(o: {
  exactDir: string;
  target: string;
  identity: string;
  profilePath: string;
  buildNumber: number;
  settings: ReleaseSettings;
  home?: string;
}): Record<string, string> {
  const home = o.home ?? homedir();
  return {
    ...LOCALE,
    EXACT2: o.exactDir,
    CARGO_TARGET_DIR: o.target,
    EXACT_IDENTITY: o.identity,
    EXACT_PROFILE: o.profilePath,
    EXACT_BUILD_NUMBER: String(o.buildNumber),
    EXACT_VERSION: o.settings.marketingVersion,
    EXACT_NON_EXEMPT_ENCRYPTION: String(o.settings.nonExemptEncryption),
    // Never send Exact's usage diary anywhere from automation.
    EXACT_FEEDBACK: "0",
    PATH: `${join(home, `.bun-${BUN_VERSION}`, "bin")}:${join(home, ".cargo", "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  };
}

// ---- The job ------------------------------------------------------------------------------------

export type Deps = {
  resolveCommit(ref: string): Promise<string>;
  exportTree(sha: string, dest: string, log: string): Promise<void>;
  /** Builds and signs the .ipa from the exported tree; returns the Exact commit it built with. */
  archive(receipt: Receipt, settings: ReleaseSettings, log: string): Promise<string>;
  /** Throws unless the .ipa holds BUNDLE_ID, the marketing version and the build number. */
  verifyIpa(receipt: Receipt, log: string): Promise<void>;
  upload(receipt: Receipt, log: string): Promise<void>;
  latestBuildNumber(log: string): Promise<number>;
  status(receipt: Receipt, ensureGroup: boolean, log: string): Promise<AppleStatus>;
  sleep(ms: number): Promise<void>;
  now(): Date;
  say(message: string): void;
};

export type Options = {
  home: string;
  ref: string;
  forceNew: boolean;
  pollMs: number;
  timeoutMs: number;
};

export class ProcessingTimeout extends Error {}

export function findArtifacts(receipt: Receipt) {
  const dir = receipt.paths.artifacts;
  const files = existsSync(dir) ? readdirSync(dir) : [];
  receipt.paths.ipa = files.includes(IPA_NAME) ? join(dir, IPA_NAME) : null;
  const dsyms = files.find((f) => f.endsWith(".dSYMs")) ?? files.find((f) => f.endsWith(".dSYM"));
  receipt.paths.dsyms = dsyms ? join(dir, dsyms) : null;
}

/** Runs one release. Hold the lock. Resolves with the final receipt; throws if it is not ready to install. */
export async function release(opts: Options, deps: Deps): Promise<Receipt> {
  const { home } = opts;
  const sha = await deps.resolveCommit(opts.ref);
  let receipt: Receipt | undefined;
  let next: RetryPlan = "archive";

  const prior = latestReceipt(home, sha);
  if (prior?.status === "ready" && !opts.forceNew) {
    deps.say(`Build ${prior.build_number} (${prior.short_sha}) is already ready to install. Use --force-new for another build.`);
    return prior;
  }
  if (prior && prior.status !== "ready") {
    deps.say(`Found build ${prior.build_number} for ${prior.short_sha} (${prior.status}). Asking Apple about it first.`);
    const apple = prior.marketing_version ? await deps.status(prior, false, prior.paths.logs.status) : { app_record: true, found: false };
    next = planRetry(prior, apple, !!prior.paths.ipa && existsSync(prior.paths.ipa));
    prior.attempts.push({ at: deps.now().toISOString(), action: `retry: ${next}` });
    if (next === "new_number") {
      prior.status = "failed";
      prior.processing_status = apple.processing_state ?? null;
      prior.failure = { stage: "processing", message: `Apple rejected build ${prior.build_number} (${apple.processing_state}).` };
      saveReceipt(prior, deps.now());
      deps.say(`Apple rejected build ${prior.build_number}; reserving a new build number.`);
      next = "archive";
    } else {
      receipt = prior;
      receipt.failure = null;
      saveReceipt(receipt, deps.now());
    }
  }

  if (!receipt) {
    const appleMax = await deps.latestBuildNumber(join(home, "latest-build-number.log"));
    receipt = newReceipt(home, sha, reserveBuildNumber(home, appleMax), deps.now());
    receipt.attempts.push({ at: deps.now().toISOString(), action: "reserve" });
    saveReceipt(receipt, deps.now());
    deps.say(`Reserved build ${receipt.build_number} for ${receipt.short_sha}. Receipt: ${receipt.paths.receipt}`);
  }
  const r = receipt;
  mkdirSync(dirname(r.paths.logs.archive), { recursive: true });
  let stage = next as string;

  try {
    if (next === "archive") {
      stage = "export";
      rmSync(r.paths.source, { recursive: true, force: true });
      rmSync(r.paths.artifacts, { recursive: true, force: true });
      await deps.exportTree(sha, r.paths.source, r.paths.logs.export);
      const settings = releaseSettings(readFileSync(join(r.paths.source, "release.json"), "utf8"));
      r.marketing_version = settings.marketingVersion;
      stage = "archive";
      r.status = "archiving";
      r.timestamps.archive_started_at = deps.now().toISOString();
      saveReceipt(r, deps.now());
      deps.say(`Building Good Time ${r.marketing_version} (${r.build_number}) from a clean tree of ${r.short_sha}. Log: ${r.paths.logs.archive}`);
      r.exact_commit = await deps.archive(r, settings, r.paths.logs.archive);
      findArtifacts(r);
      if (!r.paths.ipa) throw Error(`The archive finished but ${r.paths.artifacts} has no ${IPA_NAME}.`);
      await deps.verifyIpa(r, r.paths.logs.archive);
      r.status = "archived";
      r.timestamps.archived_at = deps.now().toISOString();
      saveReceipt(r, deps.now());
      // The artifacts, dSYMs and logs stay; the source tree is only a build input.
      rmSync(r.paths.source, { recursive: true, force: true });
      next = "upload";
    }

    if (next === "upload") {
      stage = "upload";
      r.status = "uploading";
      r.upload_status = "uploading";
      r.timestamps.upload_started_at = deps.now().toISOString();
      saveReceipt(r, deps.now());
      deps.say(`Uploading build ${r.build_number} to App Store Connect (internal TestFlight only).`);
      await deps.upload(r, r.paths.logs.upload);
      r.status = "uploaded";
      r.upload_status = "uploaded";
      r.timestamps.uploaded_at = deps.now().toISOString();
      saveReceipt(r, deps.now());
      deps.say(`Uploaded build ${r.build_number}. Uploaded is not ready to install; waiting for Apple processing.`);
    }

    stage = "processing";
    const deadline = deps.now().getTime() + opts.timeoutMs;
    for (;;) {
      const apple = await deps.status(r, true, r.paths.logs.status);
      const verdict = readiness(apple);
      r.processing_status = apple.processing_state ?? null;
      r.internal_build_state = apple.internal_build_state ?? null;
      r.testflight_group = apple.group ?? null;
      if (apple.found && r.upload_status !== "uploaded") r.upload_status = "uploaded";
      if (apple.processing_state === "VALID" && !r.timestamps.processed_at) r.timestamps.processed_at = deps.now().toISOString();
      if (verdict.state === "ready") {
        r.status = "ready";
        r.ready_to_install = true;
        r.timestamps.ready_at = deps.now().toISOString();
        saveReceipt(r, deps.now());
        deps.say(`Ready to install: Good Time ${r.marketing_version} (${r.build_number}), commit ${r.short_sha}. ${verdict.message}`);
        return r;
      }
      if (verdict.state === "failed") throw Error(verdict.message);
      r.status = "processing";
      saveReceipt(r, deps.now());
      if (deps.now().getTime() >= deadline) {
        throw new ProcessingTimeout(
          `Apple has not made build ${r.build_number} ready after ${Math.round(opts.timeoutMs / 60000)} minutes (${verdict.message}) ` +
            `Run scripts/beta-ios ${r.short_sha} again to resume; it keeps build ${r.build_number}.`,
        );
      }
      deps.say(`${verdict.message} Checking again in ${Math.round(opts.pollMs / 1000)} s.`);
      await deps.sleep(opts.pollMs);
    }
  } catch (e: any) {
    if (stage === "upload") r.upload_status = "failed";
    // A processing timeout is not a failure of the artifact; the next run resumes waiting.
    if (!(e instanceof ProcessingTimeout)) r.status = "failed";
    r.failure = { stage, message: e?.message ?? String(e) };
    saveReceipt(r, deps.now());
    throw e;
  }
}

// ---- Process runners -----------------------------------------------------------------------------

/** A running command. `exited` resolves once the process is gone. */
export type Child = { kill(signal: NodeJS.Signals): void; exited: Promise<unknown>; done(): boolean };

/** The commands the job is running, so a signal can stop them before the lock is released. */
export type Runner = { children: Set<Child>; stopping: boolean };
export const runner: Runner = { children: new Set(), stopping: false };

/** SIGTERM to each running child, SIGKILL after `graceMs`; resolves only when every child has exited. */
export async function stopChildren(children: Iterable<Child>, graceMs: number) {
  await Promise.all(
    [...children].map(async (child) => {
      if (child.done()) return;
      child.kill("SIGTERM");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const graceOver = new Promise<boolean>((done) => {
        timer = setTimeout(() => done(true), graceMs);
      });
      const killed = await Promise.race([child.exited.then(() => false), graceOver]);
      clearTimeout(timer);
      if (killed) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }),
  );
}

/**
 * The SIGINT/SIGTERM handler: stops new commands, stops the running ones and waits for them to exit,
 * and only then releases the lock and exits. A second signal while stopping does nothing.
 */
export function makeShutdown(opts: { runner: Runner; unlock(): void; exit(code: number): void; graceMs: number }) {
  return async (code: number) => {
    if (opts.runner.stopping) return;
    opts.runner.stopping = true;
    await stopChildren(opts.runner.children, opts.graceMs);
    opts.unlock();
    opts.exit(code);
  };
}

/** Runs a command, appending its output to `log`. Resolves with stdout; throws on a non-zero exit. */
export async function run(cmd: string[], opts: { cwd: string; env?: Record<string, string>; log: string }, r: Runner = runner) {
  if (r.stopping) throw Error(`Not starting '${cmd.slice(0, 2).join(" ")}': the release job is stopping.`);
  mkdirSync(dirname(opts.log), { recursive: true });
  appendFileSync(opts.log, `\n$ ${cmd.join(" ")}\n`);
  // Its own process group, so a stop reaches cargo, xcodebuild and the other processes they start.
  const proc = spawn(cmd[0], cmd.slice(1), {
    cwd: opts.cwd,
    env: { ...process.env, ...LOCALE, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let out = "";
  // Streamed to the log as it comes: an Exact build runs for minutes and the log shows where it is.
  proc.stdout!.on("data", (d) => {
    out += d;
    appendFileSync(opts.log, d);
  });
  proc.stderr!.on("data", (d) => appendFileSync(opts.log, d));
  const result = new Promise<number>((done) => {
    proc.on("error", (e) => {
      appendFileSync(opts.log, `${e.message}\n`);
      done(127);
    });
    proc.on("close", (code, signal) => done(code ?? (signal ? 128 + (osConstants.signals[signal] ?? 0) : 1)));
  });
  const child: Child = {
    kill(signal) {
      try {
        process.kill(-proc.pid!, signal);
      } catch {
        proc.kill(signal);
      }
    },
    exited: new Promise<void>((done) => {
      proc.on("exit", () => done());
      proc.on("error", () => done());
    }),
    done: () => proc.exitCode !== null || proc.signalCode !== null || proc.pid === undefined,
  };
  r.children.add(child);
  try {
    const code = await result;
    if (code !== 0) throw Error(`'${cmd.slice(0, 2).join(" ")}' failed with exit code ${code}. Log: ${opts.log}`);
    return out;
  } finally {
    r.children.delete(child);
  }
}

export function fastlaneArgs(options: Record<string, string | number | boolean>) {
  return Object.entries(options).map(([k, v]) => `${k}:${v}`);
}

/** Reads a provisioning profile's facts with `security cms` and `plutil`. */
export async function readProfile(path: string, log: string): Promise<ProfileFacts> {
  const xml = await run(["security", "cms", "-D", "-i", path], { cwd: dirname(path), log });
  const tmp = join(dirname(log), `profile-${process.pid}.plist`);
  writeFileSync(tmp, xml);
  try {
    // `plutil -extract ... raw` prints a string, a bool, a date (ISO 8601) or base64 data; a missing key fails.
    const raw = async (key: string) => (await run(["plutil", "-extract", key, "raw", "-o", "-", tmp], { cwd: dirname(log), log }).catch(() => "")).trim();
    const certs: string[] = [];
    for (let i = 0; ; i++) {
      const b64 = await raw(`DeveloperCertificates.${i}`);
      if (!b64) break;
      certs.push(new Bun.CryptoHasher("sha1").update(Buffer.from(b64, "base64")).digest("hex").toUpperCase());
    }
    const ent = async (key: string) => raw(`Entitlements.${key}`);
    return {
      name: await raw("Name"),
      uuid: await raw("UUID"),
      team: await raw("TeamIdentifier.0"),
      appId: await ent("application-identifier"),
      getTaskAllow: (await ent("get-task-allow")) === "true",
      hasDevices: (await raw("ProvisionedDevices.0")) !== "",
      provisionsAllDevices: (await raw("ProvisionsAllDevices")) === "true",
      expires: new Date(await raw("ExpirationDate")),
      certificates: certs,
    };
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** The signing identity and the checked profile. Throws, naming the fix, when either is unusable. */
export async function signingMaterial(config: ReleaseConfig, log: string) {
  const identity = pickIdentity(await run(["security", "find-identity", "-v", "-p", "codesigning"], { cwd: dirname(log), log }), config.identity);
  const profile = await readProfile(config.profilePath, log);
  const problems = profileProblems(profile, identity.sha1, new Date());
  if (problems.length) throw Error(`The provisioning profile ${config.profilePath} cannot sign this app: ${problems.join("; ")}. See docs/release.md.`);
  return { identity, profile };
}

/** The real dependencies: git, Exact's build in the exported tree and the fastlane lanes in `root`/fastlane. */
export function liveDeps(root: string, config: ReleaseConfig, home: string, env: Env): Deps {
  const flEnv = fastlaneEnv(config);
  const lane = (name: string, options: Record<string, string | number | boolean>, log: string) =>
    run(["fastlane", "ios", name, ...fastlaneArgs(options)], { cwd: root, env: flEnv, log });
  const laneJson = async (name: string, options: Record<string, string | number | boolean>, log: string) => {
    const output = join(home, "tmp", `${name}-${process.pid}-${Date.now()}.json`);
    mkdirSync(dirname(output), { recursive: true });
    await lane(name, { ...options, output }, log);
    try {
      return JSON.parse(readFileSync(output, "utf8"));
    } finally {
      rmSync(output, { force: true });
    }
  };
  const exact = exactDir(env);
  return {
    async resolveCommit(ref) {
      const out = await run(["git", "-C", root, "rev-parse", "--verify", `${ref}^{commit}`], { cwd: root, log: join(home, "git.log") });
      return out.trim();
    },
    async exportTree(sha, dest, log) {
      // A clean tree of exactly this commit: no untracked files, no build products, no local edits.
      mkdirSync(dest, { recursive: true });
      const tar = join(dirname(dest), "source.tar");
      await run(["git", "-C", root, "archive", "--format=tar", `--output=${tar}`, sha], { cwd: root, log });
      await run(["tar", "-xf", tar, "-C", dest], { cwd: root, log });
      rmSync(tar, { force: true });
    },
    async archive(r, settings, log) {
      // The Exact checkout must be at the commit's own pin, so the build is of this commit and nothing else.
      const pin = readFileSync(join(r.paths.source, "exact.pin"), "utf8").trim();
      const head = (await run(["git", "-C", exact, "rev-parse", "HEAD"], { cwd: root, log })).trim();
      if (head !== pin) throw Error(`The Exact checkout ${exact} is at ${head.slice(0, 12)}, but ${r.short_sha}'s exact.pin is ${pin.slice(0, 12)}. Run scripts/setup from a checkout of ${r.short_sha}.`);
      const dirty = (await run(["git", "-C", exact, "status", "--porcelain", "--untracked-files=no"], { cwd: root, log })).trim();
      if (dirty) throw Error(`The Exact checkout ${exact} has local changes. Release builds use a clean pinned checkout.`);
      const { identity } = await signingMaterial(config, log);
      mkdirSync(r.paths.artifacts, { recursive: true });
      await run(["bun", "exact.mjs", "ios", "--device", "--archive", join(r.paths.artifacts, IPA_NAME)], {
        cwd: join(r.paths.source, "exact-app"),
        env: archiveEnv({ exactDir: exact, target: releaseTarget(env), identity: identity.sha1, profilePath: config.profilePath, buildNumber: r.build_number, settings }),
        log,
      });
      return head;
    },
    async verifyIpa(r, log) {
      const ipa = r.paths.ipa!;
      const list = await run(["unzip", "-Z1", ipa], { cwd: root, log: `${log}.unzip` });
      const plist = list.split("\n").find((l) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(l));
      if (!plist) throw Error(`${ipa} has no Payload/<app>.app/Info.plist.`);
      const tmp = join(r.paths.build_dir, "Info.plist");
      writeFileSync(tmp, Buffer.from(await new Response(Bun.spawn(["unzip", "-p", ipa, plist]).stdout).arrayBuffer()));
      const info = JSON.parse(await run(["plutil", "-convert", "json", "-o", "-", tmp], { cwd: root, log }));
      rmSync(tmp, { force: true });
      const want = { CFBundleIdentifier: BUNDLE_ID, CFBundleShortVersionString: r.marketing_version, CFBundleVersion: String(r.build_number) };
      for (const [k, v] of Object.entries(want)) if (info[k] !== v) throw Error(`${ipa}: ${k} is ${JSON.stringify(info[k])}, expected ${JSON.stringify(v)}.`);
      // The signature: an App Store distribution signature by our team, not a development or ad hoc one.
      const sign = join(r.paths.build_dir, "verify");
      rmSync(sign, { recursive: true, force: true });
      await run(["unzip", "-q", ipa, "-d", sign], { cwd: root, log: `${log}.unzip` });
      const app = join(sign, plist.replace(/\/Info\.plist$/, ""));
      await run(["codesign", "--verify", "--deep", "--strict", app], { cwd: root, log });
      const details = await run(["sh", "-c", 'codesign -dvv "$1" 2>&1', "sh", app], { cwd: root, log });
      rmSync(sign, { recursive: true, force: true });
      if (!/Authority=Apple Distribution: .*\(ZMVK3ALPSD\)/.test(details) || !/TeamIdentifier=ZMVK3ALPSD/.test(details))
        throw Error(`${ipa} is not signed with team ${TEAM_ID}'s Apple Distribution identity. Log: ${log}`);
    },
    async upload(r, log) {
      if (!r.paths.ipa) throw Error("No .ipa to upload.");
      await lane("upload", { ipa: r.paths.ipa }, log);
    },
    async latestBuildNumber(log) {
      return (await laneJson("latest_build_number", {}, log)).max;
    },
    async status(r, ensureGroup, log) {
      const options: Record<string, string | number | boolean> = { version: r.marketing_version, build_number: r.build_number, ensure_group: ensureGroup };
      if (config.group) options.group = config.group;
      return laneJson("status", options, log);
    },
    sleep: (ms) => Bun.sleep(ms),
    now: () => new Date(),
    say: (message) => console.log(`==> ${message}`),
  };
}

// ---- Doctor -----------------------------------------------------------------------------------------

/** Checks everything a release needs and changes nothing. Returns false if a release would fail. */
export async function doctor(root: string, env: Env) {
  let ok = true;
  const good = (m: string) => console.log(`ok    ${m}`);
  const bad = (m: string) => {
    ok = false;
    console.log(`FAIL  ${m}`);
  };
  const home = releaseHome(env);
  const log = join(home, "doctor.log");
  try {
    assertOutsideRepo(home, root, "GT_RELEASE_HOME");
    good(`release home ${home}`);
  } catch (e: any) {
    bad(e.message);
  }
  const loaded = loadConfig(configPath(env), root);
  for (const w of loaded.warnings) console.log(`warn  ${w}`);
  if (!loaded.config) {
    for (const p of loaded.problems) bad(p);
    return false;
  }
  const config = loaded.config;
  good(`release config ${loaded.path} (key ${config.keyId})`);
  mkdirSync(home, { recursive: true });
  try {
    const { identity, profile } = await signingMaterial(config, log);
    good(`signing identity ${identity.name} (${identity.sha1})`);
    good(`App Store profile '${profile.name}' ${profile.uuid}, expires ${profile.expires.toISOString().slice(0, 10)}`);
  } catch (e: any) {
    bad(e.message);
  }
  const exact = exactDir(env);
  try {
    const pin = readFileSync(join(root, "exact.pin"), "utf8").trim();
    const head = (await run(["git", "-C", exact, "rev-parse", "HEAD"], { cwd: root, log })).trim();
    if (head === pin) good(`Exact checkout ${exact} at the pin ${pin.slice(0, 12)}`);
    else bad(`Exact checkout ${exact} is at ${head.slice(0, 12)}, the pin is ${pin.slice(0, 12)}. Run scripts/setup.`);
  } catch (e: any) {
    bad(`Exact checkout ${exact}: ${e.message}. Run scripts/setup.`);
  }
  try {
    releaseSettings(readFileSync(join(root, "release.json"), "utf8"));
    good("release.json");
  } catch (e: any) {
    bad(e.message);
  }
  const out = join(home, "tmp", `doctor-${process.pid}.json`);
  mkdirSync(dirname(out), { recursive: true });
  try {
    await run(["fastlane", "ios", "doctor", `output:${out}`], { cwd: root, env: fastlaneEnv(config), log });
    const a = JSON.parse(readFileSync(out, "utf8"));
    if (!a.auth) bad(`App Store Connect: ${a.error ?? "authentication failed"}`);
    else {
      good(`App Store Connect key works`);
      a.bundle_id_registered && a.team_id === TEAM_ID ? good(`bundle ID ${BUNDLE_ID} registered to ${TEAM_ID}`) : bad(`bundle ID ${BUNDLE_ID} is not registered to ${TEAM_ID}`);
      a.app_record ? good(`app record '${a.app_name}'`) : bad(`App Store Connect has no app record for ${BUNDLE_ID}`);
      const groups: { name: string; testers: number; all_builds: boolean }[] = a.internal_groups ?? [];
      const group = config.group ? groups.find((g) => g.name === config.group) : groups[0];
      group ? good(`internal TestFlight group '${group.name}' (${group.testers} testers)`) : bad(`no internal TestFlight group${config.group ? ` named '${config.group}'` : ""}`);
      good(`Apple's highest build number: ${a.latest_build_number ?? 0}`);
      const live = (a.app_store_versions ?? []).map((v: any) => `${v.version} ${v.state}`).join(", ");
      if (live) console.log(`info  App Store versions: ${live}. release.json's marketing_version must be above any closed (released) version.`);
    }
  } catch (e: any) {
    bad(`App Store Connect: ${e.message}`);
  } finally {
    rmSync(out, { force: true });
  }
  return ok;
}

// ---- Command line -----------------------------------------------------------------------------------

export function parseArgs(argv: string[]) {
  const forceNew = argv.includes("--force-new");
  const isDoctor = argv.includes("--doctor");
  const rest = argv.filter((a) => a !== "--force-new" && a !== "--doctor");
  const [ref = "HEAD", extra] = rest;
  if (extra || rest.some((a) => a.startsWith("-")) || (isDoctor && (forceNew || rest.length)))
    throw Error("usage: scripts/beta-ios [<commit>] [--force-new] | scripts/beta-ios --doctor");
  return { ref, forceNew, doctor: isDoctor };
}

function positiveNumber(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw Error(`${name} must be a positive number`);
  return n;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.doctor) process.exit((await doctor(root, process.env)) ? 0 : 1);
    const home = releaseHome(process.env);
    assertOutsideRepo(home, root, "GT_RELEASE_HOME");
    assertOutsideRepo(releaseTarget(process.env), root, "GT_RELEASE_TARGET");
    const loaded = loadConfig(configPath(process.env), root);
    if (!loaded.config) throw Error(`${loaded.problems.join(" ")} Run scripts/beta-ios --doctor.`);
    const unlock = acquireLock(home, `scripts/beta-ios ${process.argv.slice(2).join(" ")}`);
    const shutdown = makeShutdown({ runner, unlock, exit: (code) => process.exit(code), graceMs: 15_000 });
    process.on("SIGINT", () => void shutdown(130));
    process.on("SIGTERM", () => void shutdown(143));
    try {
      // Fails before a build number is reserved when the identity or the profile cannot sign.
      await signingMaterial(loaded.config, join(home, "signing.log"));
      await release(
        {
          home,
          ref: args.ref,
          forceNew: args.forceNew,
          pollMs: positiveNumber(process.env.GT_PROCESSING_POLL_SECONDS, 60, "GT_PROCESSING_POLL_SECONDS") * 1000,
          timeoutMs: positiveNumber(process.env.GT_PROCESSING_TIMEOUT_MINUTES, 90, "GT_PROCESSING_TIMEOUT_MINUTES") * 60000,
        },
        liveDeps(root, loaded.config, home, process.env),
      );
    } finally {
      // While stopping, the signal handler releases the lock once the children have exited.
      if (!runner.stopping) unlock();
    }
  } catch (e: any) {
    console.error(`error: ${e?.message ?? e}`);
    if (!runner.stopping) process.exit(1);
  }
}
