# Internal TestFlight release (LKM-650)

`scripts/beta-ios` puts one exact commit of the Exact app (`exact-app/`) into **internal** TestFlight. It follows
the design of Pantheon's (agent-messenger's) `scripts/beta-ios` and `scripts/release.ts`. It never submits for
review, never publishes to the App Store and never adds external testers.

## The release command

```sh
scripts/beta-ios                 # a clean tree of HEAD
scripts/beta-ios <commit>        # any commit-ish
scripts/beta-ios <commit> --force-new   # another build of a commit that already has a ready build
scripts/beta-ios --doctor        # checks everything below; changes nothing (~3 s)
```

Forge (project `good-time`) runs it after each merge, from the task worktree's root, on the merged commit:

```yaml
release: scripts/beta-ios
release_timeout_minutes: 120
```

It exits 0 only when the build is **ready to install** for the internal group, and non-zero otherwise.

## What one run does

1. Takes the release lock (`~/.good-time/release/lock`): one job at a time. A lock whose process is gone is taken over.
2. Resolves the commit. If this commit already has a ready build, it says so and stops (`--force-new` builds again).
   If it has an unfinished one, it asks Apple about that build first and resumes it under the same build number:
   waits if Apple has it, uploads the same `.ipa` again if Apple never got it, builds again if there is no `.ipa`.
   Only a build Apple rejected (`INVALID`/`FAILED`) gets a new number.
3. Reserves a build number: one above the largest of the local counter (`~/.good-time/release/build-number`),
   the highest build Apple has for the app (every page of builds), and 3, the SwiftUI app's last build.
   Numbers are unique and only increase.
4. Exports a clean tree of exactly that commit (`git archive`, no untracked files or local edits).
5. Checks that the Exact checkout (`~/dev/exact`, `EXACT_DIR`) is clean and at the commit's own `exact.pin`, and
   that the signing identity and profile are usable; then in the tree's `exact-app/` runs

   ```sh
   bun exact.mjs ios --device --archive <artifacts>/GoodTime.ipa
   ```

   with `EXACT_IDENTITY` (the Apple Distribution identity's SHA-1), `EXACT_PROFILE` (the App Store profile),
   `EXACT_BUILD_NUMBER` (the reserved number), `EXACT_VERSION` and `EXACT_NON_EXEMPT_ENCRYPTION` (from
   [`release.json`](../release.json)), and `CARGO_TARGET_DIR=~/.cache/good-time/exact-release-target`.
   Exact builds the shipping (production-trust, LTO) app, signs it and writes the `.ipa` and its dSYMs.
6. Verifies the `.ipa`: bundle ID, version and build number in `Info.plist`, `codesign --verify --deep --strict`,
   and an Apple Distribution signature of team `ZMVK3ALPSD`. A wrong `.ipa` is never uploaded.
7. Uploads it with fastlane `upload_to_testflight` (`skip_submission`, `distribute_external: false`).
8. Polls Apple every minute (`GT_PROCESSING_POLL_SECONDS`) for up to 90 minutes (`GT_PROCESSING_TIMEOUT_MINUTES`).
   **Uploaded is not ready.** Ready means Apple lists the build, its processing state is `VALID`, the internal
   group exists (it has access to all builds; otherwise the job adds the build to it) and the build's internal
   TestFlight state is `IN_BETA_TESTING`. A timeout leaves the receipt resumable: run the same command again.

Each build has a receipt, `~/.good-time/release/receipts/<build>.json` (commit, Exact commit, version, build number,
upload/processing/internal state, timestamps, paths), and its logs, `.ipa` and dSYMs under
`~/.good-time/release/builds/<build>/`.

## Configuration (outside the repository)

| What | Where |
| --- | --- |
| Release config | `~/.appstoreconnect/good-time.json` (`GT_RELEASE_CONFIG`), mode 600 |
| App Store Connect API key | the `.p8` its `key_path` names: the same key, key ID and issuer as `agent-messenger.json` (team `ZMVK3ALPSD`) |
| App Store provisioning profile | `~/.good-time/release/profiles/GoodTime_AppStore.mobileprovision`, "com.alikimovich.good-time-to-sleep AppStore", expires 2027-11-03 |
| Signing identity | "Apple Distribution: Andrei Alikimovich (ZMVK3ALPSD)" in the login keychain |
| Release state | `~/.good-time/release` (`GT_RELEASE_HOME`) |

The config holds identifiers and paths only:

```json
{"key_id": "<key ID>", "issuer_id": "<issuer ID>", "key_path": "~/.appstoreconnect/private_keys/AuthKey_<key ID>.p8",
 "provisioning_profile": "~/.good-time/release/profiles/GoodTime_AppStore.mobileprovision",
 "signing_identity": "<SHA-1, optional>", "testflight_group": "<internal group, optional: default the first>"}
```

The release refuses a config, key, profile or state directory inside the repository.

To make or renew the App Store profile (it uses the API key; creates one only if no valid one exists):

```sh
eval "$(jq -r '"export GT_ASC_KEY_ID=\(.key_id) GT_ASC_ISSUER_ID=\(.issuer_id) GT_ASC_KEY_PATH=\(.key_path)"' ~/.appstoreconnect/good-time.json)"
fastlane ios profile output_directory:$HOME/.good-time/release/profiles output:/dev/stdout
```

## Version

[`release.json`](../release.json) holds the marketing version and the export-compliance answer. The SwiftUI app's
1.0.4 is live on the App Store, so its version train is closed: the Exact app ships as **1.1.0**. Raise
`marketing_version` before the next App Store release closes 1.1.0. `uses_non_exempt_encryption: false` is true for
this app (no encryption beyond what iOS provides); without it Apple holds every build at `MISSING_EXPORT_COMPLIANCE`.

## Apple's side (checked 2026-11-11)

- App record "Good Time — Sleep Calculator", bundle ID `com.alikimovich.good-time-to-sleep`, team `ZMVK3ALPSD`.
- Internal group "App Store Connect Users" (6 testers) with access to all builds.
- Highest build number before this pipeline: 4.

## Tests

```sh
~/.bun-1.4.2/bin/bun test scripts/release.test.ts
```

They run the job with fake git, Exact, fastlane and Apple: build numbers, the lock, retries, readiness, the
`.ipa` check, the signing checks, and that the lanes cannot submit for review or distribute externally.
