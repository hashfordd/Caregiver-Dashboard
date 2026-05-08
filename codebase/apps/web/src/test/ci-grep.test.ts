import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Mirrors the CI step "Service-role guard". The two excluded test files (this
// one + rls.test.ts) are the only legitimate places to mention the guarded
// string. Implemented in plain Node so the test is portable across grep
// flavours (BSD grep, GNU grep, ugrep) and CI runners.
//
// Item 106: extended to scan the post-build dist/ directory for both the
// SERVICE_ROLE name-shape AND the actual key prefixes (sb_secret_, eyJ
// legacy JWT). The basename-only grep this replaced missed concatenated
// identifiers, base64-encoded keys, and any rename of the SERVICE_ROLE
// constant. The dist scan only runs when apps/web/dist exists (i.e. CI
// has done `npm run build`); local dev skips it cleanly.

const FORBIDDEN = ['SERVICE', 'ROLE'].join('_');
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.vite']);
const EXCLUDED_FILES = new Set(['rls.test.ts', 'ci-grep.test.ts']);
const ALLOWED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.html'];

// Patterns the bundle must never contain. Each entry is a literal that
// would only appear in a leaked secret.
const BUNDLE_FORBIDDEN_PATTERNS = [
  FORBIDDEN, // 'SERVICE_ROLE' — guards a renamed/aliased constant
  'sb_secret_', // current Supabase service-role key prefix
  'sbp_', // historical service-role prefix
];
// JWT prefix is too generic on its own (legitimate config can carry
// 'eyJ' for non-secret JWTs), so we only flag it inside a long base64
// run that's plausibly a real key — gated by length.
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{40,}\.eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry) || EXCLUDED_FILES.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (ALLOWED_EXTS.some((ext) => entry.endsWith(ext))) yield full;
  }
}

function* walkAll(dir: string): Generator<string> {
  // Bundle scan walks every file regardless of extension — minified JS,
  // sourcemaps, and inlined env files all need scanning.
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walkAll(full);
    else yield full;
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

  it('does not leak into the post-build bundle (when dist/ exists)', () => {
    const distDir = join(process.cwd(), 'dist');
    if (!existsSync(distDir)) {
      // Local dev: no bundle. CI runs `npm run build` first.
      return;
    }
    const hits: { file: string; pattern: string }[] = [];
    for (const file of walkAll(distDir)) {
      const text = readFileSync(file, 'utf8');
      for (const p of BUNDLE_FORBIDDEN_PATTERNS) {
        if (text.includes(p)) hits.push({ file: relative(distDir, file), pattern: p });
      }
      if (JWT_PATTERN.test(text)) {
        hits.push({ file: relative(distDir, file), pattern: 'jwt-shaped-token' });
      }
    }
    expect(hits).toEqual([]);
  });
});
