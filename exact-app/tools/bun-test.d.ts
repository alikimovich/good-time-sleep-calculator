// The part of bun:test the unit tests use, declared so tools/typecheck.mjs can check them without @types/bun
// (which would also declare Node's globals, which Exact's executors do not have).
declare module 'bun:test' {
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toMatch(expected: string | RegExp): void;
    toThrow(expected?: string | RegExp): void;
    readonly not: Matchers;
  }
  export function describe(name: string, body: () => void): void;
  export function test(name: string, body: () => void | Promise<void>): void;
  export function expect(actual: unknown): Matchers;
}
