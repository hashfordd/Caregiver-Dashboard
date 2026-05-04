import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Mirrors the CI step "Service-role guard". The two excluded test files (this
// one + rls.test.ts) are the only legitimate places to mention the guarded
// string. Implemented in plain Node so the test is portable across grep
// flavours (BSD grep, GNU grep, ugrep) and CI runners.

const FORBIDDEN = ['SERVICE', 'ROLE'].join('_');
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.vite']);
const EXCLUDED_FILES = new Set(['rls.test.ts', 'ci-grep.test.ts']);
const ALLOWED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.html'];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry) || EXCLUDED_FILES.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (ALLOWED_EXTS.some((ext) => entry.endsWith(ext))) yield full;
  }
}

describe('Service-role guard', () => {
  it('does not appear in apps/web source', () => {
    // npm sets cwd to the workspace dir (apps/web) when running its scripts.
    const root = process.cwd();
    const hits: string[] = [];
    for (const file of walk(root)) {
      if (readFileSync(file, 'utf8').includes(FORBIDDEN)) {
        hits.push(relative(root, file));
      }
    }
    expect(hits).toEqual([]);
  });
});
