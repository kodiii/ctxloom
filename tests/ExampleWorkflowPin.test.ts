/**
 * Drift detection for `ctxloom-pro@<version>` install pins in the
 * user-facing example workflow and the top-level README's workflow
 * snippet.
 *
 * Closes ARCH-131-1 + TEST-131-1 from the PR #131 dogfood review:
 * https://github.com/kodiii/ctxloom/pull/131#issuecomment-4472601506
 *
 * Two pin sites today, both intended to track the released
 * `ctxloom-pro` package version exactly:
 *
 *   1. apps/pr-bot/examples/.github/workflows/claude-review.yml
 *      — the recommended CI workflow downstream users copy into their
 *      repos. Drifting silently means agent specs dispatch tools the
 *      pinned CLI version doesn't expose (false negatives) OR miss
 *      tools added since the spec was written (coverage gaps).
 *
 *   2. README.md (the workflow snippet around the rules-check
 *      example) — same risk surface as (1), copied by the same
 *      audience.
 *
 * This test fails LOUDLY when either pin drifts from
 * package.json#version. The PR description's "Bump this pin
 * deliberately on each ctxloom-pro release" comment is an unenforced
 * human-process gate; this test is the enforcement.
 *
 * Designed to follow the same shape as
 * tests/ReadmeBudgetDefaults.test.ts (the precedent shipped in
 * PR #129) so contributors can recognize the pattern.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

interface PinSite {
  /** Human-readable label used in failure messages. */
  label: string;
  /** Repo-relative path to the file containing the pin. */
  path: string;
  /**
   * Whether the pin is expected to be EXACT (no range specifier) —
   * applies to both sites today. The flag exists so future quickstart
   * snippets that are intentionally floating (e.g. trial-install
   * copy) can be added to PIN_SITES with `exact: false` and only
   * checked for "ctxloom-pro@<something>" parse-ability.
   */
  exact: boolean;
}

/**
 * Every pin site that must track the released package version.
 * Adding a new pin site? Append here and the per-site `it.each` below
 * picks it up automatically.
 */
export const PIN_SITES: PinSite[] = [
  {
    label: 'example workflow',
    path: 'apps/pr-bot/examples/.github/workflows/claude-review.yml',
    exact: true,
  },
  {
    label: 'README workflow snippet',
    path: 'README.md',
    exact: true,
  },
];

/**
 * Extract every `ctxloom-pro@<spec>` occurrence from a file's contents
 * as a list of `{ spec, line }` records. The regex is permissive on
 * what comes before the pin (whitespace, backticks, shell quoting)
 * and on the spec (range specifiers + plain semver) so the same
 * helper covers both YAML (`npm install -g ctxloom-pro@1.3.0`) and
 * Markdown (`` `ctxloom-pro@1.3.0` ``) shapes.
 *
 * @public Exported for unit testing.
 */
export function extractPins(content: string): Array<{ spec: string; line: number }> {
  const out: Array<{ spec: string; line: number }> = [];
  const lines = content.split('\n');
  // Match `ctxloom-pro@<spec>` where spec is non-empty and stops at
  // whitespace, backtick, or quote. Capturing only the spec keeps
  // assertions tight.
  const re = /ctxloom-pro@([^\s`"']+)/g;
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i])) !== null) {
      out.push({ spec: m[1], line: i + 1 });
    }
  }
  return out;
}

/**
 * Returns true if the spec is a plain semver MAJOR.MINOR.PATCH with
 * no range qualifier. Specs like `^1`, `~1.3`, `1.3.x`, `>=1.3.0`,
 * `latest`, `1.3.0-beta.1` all return false.
 *
 * @public Exported for unit testing.
 */
export function isExactSemver(spec: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(spec);
}

function readPackageVersion(): string {
  const raw = readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8');
  const pkg: unknown = JSON.parse(raw);
  if (
    typeof pkg !== 'object' || pkg === null ||
    !('version' in pkg) || typeof (pkg as { version?: unknown }).version !== 'string'
  ) {
    throw new Error('package.json#version is not a string — release script is broken');
  }
  return (pkg as { version: string }).version;
}

describe('ctxloom-pro pin drift detection', () => {
  const releasedVersion = readPackageVersion();

  describe.each(PIN_SITES)('$label ($path)', ({ path, exact }) => {
    const fullPath = resolve(REPO_ROOT, path);
    const content = readFileSync(fullPath, 'utf-8');
    const pins = extractPins(content);

    it('contains at least one ctxloom-pro@<spec> reference', () => {
      expect(
        pins.length,
        `Expected at least one \`ctxloom-pro@<spec>\` reference in ${path}. If this pin site is no longer relevant, remove it from PIN_SITES in tests/ExampleWorkflowPin.test.ts instead of leaving an empty file.`,
      ).toBeGreaterThan(0);
    });

    it.each(pins.map(p => [p.spec, p.line] as const))(
      'pin %s (line %d) tracks package.json version exactly',
      (spec, line) => {
        if (!exact) return;
        expect(
          isExactSemver(spec),
          `${path}:${line} pins to \`ctxloom-pro@${spec}\` — range/floating specifiers (e.g. ^${releasedVersion}, ~${releasedVersion}, latest) defeat the agent-spec/MCP-surface coupling guarantee documented in #107 / SEC-001. Use the exact version.`,
        ).toBe(true);
        expect(
          spec,
          `Drift detected: ${path}:${line} pins \`ctxloom-pro@${spec}\` but package.json#version is \`${releasedVersion}\`. Either bump the pin (preferred) or bump package.json. Both must move together on every release per docs/skeleton-first.md and the comment in apps/pr-bot/examples/.github/workflows/claude-review.yml.`,
        ).toBe(releasedVersion);
      },
    );
  });
});

// ─── helper self-tests ───────────────────────────────────────────────

describe('extractPins', () => {
  it('extracts pins from YAML run-block style', () => {
    const yaml = `
      - name: install
        run: |
          npm install -g ctxloom-pro@1.3.0
          ctxloom --version
    `;
    expect(extractPins(yaml)).toEqual([{ spec: '1.3.0', line: 4 }]);
  });

  it('extracts pins from Markdown inline-code style', () => {
    const md = "Run `ctxloom-pro@1.3.0` after install.";
    expect(extractPins(md)).toEqual([{ spec: '1.3.0', line: 1 }]);
  });

  it('extracts multiple pins from a single file', () => {
    const mixed = [
      'npm install -g ctxloom-pro@1.3.0',
      '',
      'Or: ctxloom-pro@^1 (NOT recommended — see SEC-001)',
    ].join('\n');
    expect(extractPins(mixed)).toEqual([
      { spec: '1.3.0', line: 1 },
      { spec: '^1', line: 3 },
    ]);
  });

  it('ignores unpinned bare `ctxloom-pro` package references', () => {
    // The bare quickstart copies (`npm install -g ctxloom-pro`) are
    // intentionally unpinned. They must NOT appear in extractPins
    // output, or the test would false-positive on them and force
    // pinning where it isn't wanted.
    expect(extractPins('npm install -g ctxloom-pro')).toEqual([]);
  });

  it('stops the spec at whitespace, backtick, and quote', () => {
    expect(extractPins('install ctxloom-pro@1.3.0 now')).toEqual([{ spec: '1.3.0', line: 1 }]);
    expect(extractPins('see `ctxloom-pro@1.3.0`')).toEqual([{ spec: '1.3.0', line: 1 }]);
    expect(extractPins('"ctxloom-pro@1.3.0"')).toEqual([{ spec: '1.3.0', line: 1 }]);
  });
});

describe('isExactSemver', () => {
  it.each(['1.0.0', '1.3.0', '10.20.30', '0.0.0'])('accepts %s', (v) => {
    expect(isExactSemver(v)).toBe(true);
  });

  it.each(['^1', '^1.3.0', '~1.3.0', '1.3', '1.3.x', '>=1.3.0', 'latest', '1.3.0-beta.1', '*'])(
    'rejects %s',
    (v) => {
      expect(isExactSemver(v)).toBe(false);
    },
  );
});
