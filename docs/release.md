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
   The release target belongs to release jobs only. Exact records which app directory owns each crate name in
   `<target>/.exact-crates/<crate>` and refuses to build while another existing directory holds it, so before
   the archive (under the release lock) the job rewrites every record there to name this build's `exact-app/`.
   **Ad-hoc builds (manual `--archive` runs, experiments, screenshots) must not use the release target**: leave
   `CARGO_TARGET_DIR` unset or give them their own directory. Build 16 failed because a manual archive in
   `/tmp/lkm771-arch` had claimed it.
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
1.0.4 is live on the App Store and Apple has closed the 1.1.0 train. The next internal TestFlight build uses
**1.1.1**. Raise `marketing_version` when that train closes. `uses_non_exempt_encryption: false` is true for
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

## Timings and first run (2026-11-11, Exact `c582b3b`)

| Step | Time |
| --- | --- |
| `scripts/beta-ios --doctor` | 3 s |
| Exact `--archive`, release target cold (first on this Mac) | 5 min |
| Exact `--archive`, release target warm | 1 min 41 s |
| Upload | 64 s |
| Apple processing until `IN_BETA_TESTING` | 3 min 7 s |
| Whole run, warm | **~6 min** |

Forge's `release_timeout_minutes: 120` leaves room for a cold build (after an Exact pin move) and slow Apple
processing; the job's own processing timeout is 90 minutes and a timed-out run resumes.

First build: **Good Time 1.1.0 (5)**, commit `10a3e33` (LKM-650 branch, the app identical to `main`'s), Exact
`c582b3b`: upload accepted, processing `VALID`, internal state `IN_BETA_TESTING`, group "App Store Connect Users",
`ready_to_install: true` (receipt `~/.good-time/release/receipts/5.json`). A second `scripts/beta-ios` on that
commit stopped at once: "Build 5 (10a3e33) is already ready to install."

## App Store version draft (LKM-771)

`scripts/appstore-prepare` makes the App Store version ready for review and stops there. **Submitting it for
review is Andrei's action** in App Store Connect; no lane submits, releases, or sets an automatic release, and
`scripts/release.test.ts` fails if one could.

```sh
scripts/appstore-prepare           # draft release.json's version (1.1.1) and print the read-back
scripts/appstore-prepare --state   # only the read-back
```

It runs fastlane `ios appstore_prepare` (or `appstore_state`) with the release config's key, and:

1. Refuses when App Store Connect's editable version is another version string (it never renames one) or is past
   drafting (waiting for review, in review).
2. Finds the newest `VALID`, unexpired build of the version (`GoodTimeAppStoreBuilds.newest_valid`); none is an error.
3. `upload_to_app_store` with `submit_for_review: false`, `automatic_release: false` (release type **manual**) and
   `skip_binary_upload`: creates or reuses the version, uploads `fastlane/metadata/<locale>/` (name, subtitle,
   description, keywords, What's New, promotional text) for en-US, ru, es-ES and es-MX, and replaces that version's
   screenshots in those locales with `fastlane/screenshots/<locale>/` (other versions keep theirs).
4. Sets the privacy URL (`https://good-time-to-sleep.alikimovich.com/privacy-policy/`) and the support URL: the
   site's `/support/` when it answers 200 at that moment, else 1.0.4's `https://alikimovich.com/work/good`.
5. Attaches the build and writes the read-back: version state, release type, build, and per locale the name,
   URLs, and screenshot counts by display type.

The listing's sources are reviewable files in the repository: `fastlane/metadata/` (deliver's layout) and
`fastlane/screenshots/` (iPhone 6.9", 1320×2868, and iPad 13", 2064×2752, per locale; how they were taken is in
`fastlane/screenshots/README.md`).

Not in the API, so left to Andrei in App Store Connect: App Privacy ("Data Not Collected": the app collects
nothing; its privacy manifest declares no collected data and no tracking), and the submission itself.

## What the shipped bundle declares (LKM-771)

- **Privacy manifest.** Exact (from `40377f0`) writes `PrivacyInfo.xcprivacy` into the app and each Exact framework
  from the required-reason APIs linked into it, and merges the app's own `exact-app/PrivacyInfo.xcprivacy`
  (UserDefaults `CA92.1` for the alarm module's record, no tracking, no collected data).
- **Orientation.** `app.json` `"orientation": "portrait"`: the iPhone is portrait-only, as 1.0.4 was; the iPad keeps
  all four orientations, which its multitasking requires.
- **Launch screen.** `background_color` and `color_scheme_dark.background_color` are `gt.background`
  (`#f3f3f4` / `#14110f`), so the launch screen is the app's own ground in light and dark.
- **`ExactBuildHost`.** Exact stamps the build machine's host name into `Info.plist` and offers no switch to
  omit it; it stays (it names the Mac, nothing else).
