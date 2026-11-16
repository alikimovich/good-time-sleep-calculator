// Compiles tools/wake-alarm-tests.swift with modules/apple/WakeAlarmCore.swift for this Mac and runs it.
// Run from exact-app/: bun tools/wake-alarm-tests.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = resolve(import.meta.dir, '..');
const dir = mkdtempSync(join(tmpdir(), 'good-time-wake-alarm-'));
const out = join(dir, 'wake-alarm-tests');
try {
  // Top-level code compiles only as main.swift.
  copyFileSync(resolve(here, 'tools/wake-alarm-tests.swift'), join(dir, 'main.swift'));
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', join(dir, 'cache'),
    resolve(here, 'modules/apple/WakeAlarmCore.swift'), join(dir, 'main.swift'), '-o', out], { stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
  const run = spawnSync(out, [here], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
