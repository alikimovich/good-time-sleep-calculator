// Type-checks app.ts on its own, and the unit tests against it, with Exact's pinned TypeScript (its native `tsc`)
// and the compiler options Exact's builds use (js/bake/src/typescript.mjs: strict, ES2023 + WebWorker, no ambient
// types). Needs app.contract.d.ts (bun exact.mjs contract types app.contract -o app.contract.d.ts) and EXACT2 or
// ../../exact naming the pinned Exact checkout. Run from anywhere: bun tools/typecheck.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exact = resolve(app, process.env.EXACT2 || '../../exact');
const bake = join(exact, 'js/bake/src/typescript.mjs');
const tsc = join(exact, 'node_modules/.bin/tsc');
if (!existsSync(bake) || !existsSync(tsc)) throw new Error(`no built Exact checkout at ${exact} (set EXACT2; run scripts/setup)`);
if (!existsSync(join(app, 'app.contract.d.ts'))) throw new Error('app.contract.d.ts is missing; generate it first');
const { compilerOptions } = await import(pathToFileURL(bake).href);
const version = execFileSync(tsc, ['--version'], { encoding: 'utf8' }).trim();

const groups = [
  // What ships: app.ts and its imports, with the options Exact's web build and native bake check them with.
  { name: 'app.ts', files: ['app.ts'] },
  // The unit tests, so their calls into app.ts are checked too. bun:test is declared in tools/bun-test.d.ts.
  { name: 'unit tests', files: ['tools/bun-test.d.ts', 'tools/sleep.test.ts'] },
];

const scratch = mkdtempSync(join(tmpdir(), 'good-time-tsc-'));
let failed = false;
try {
  for (const [i, { name, files }] of groups.entries()) {
    const project = join(scratch, `tsconfig.${i}.json`);
    writeFileSync(project, JSON.stringify({ compilerOptions, files: files.map((f) => join(app, f)) }));
    try {
      execFileSync(tsc, ['--project', project, '--pretty', 'false'], { cwd: app, encoding: 'utf8', stdio: 'pipe' });
      console.log(`${name}: no errors (${version})`);
    } catch (error) {
      failed = true;
      process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''));
      console.log(`${name}: type errors (${version})`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
