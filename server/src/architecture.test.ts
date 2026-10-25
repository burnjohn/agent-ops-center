// Architecture tests: a dependency-free import scan enforcing the ADR-0010 layer allow-list,
// ADR-0009 (drizzle/pg only in infrastructure, no UPDATE/DELETE on events), ADR-0008
// (simulation determinism) and ADR-0002 (shared imports only zod). Violations report file:line.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SERVER_SRC, '..', '..');
const SHARED_SRC = join(REPO_ROOT, 'shared', 'src');

interface SourceFile {
  /** Repo-relative POSIX path, e.g. `server/src/domain/ticket.ts`. */
  path: string;
  text: string;
}

interface ImportRef {
  specifier: string;
  line: number;
  typeOnly: boolean;
}

interface Violation {
  path: string;
  line: number;
  message: string;
}

const posix = (p: string): string => p.split(sep).join('/');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

function loadSources(dir: string): SourceFile[] {
  return walk(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !isTestFile(f))
    .map((f) => ({ path: posix(relative(REPO_ROOT, f)), text: readFileSync(f, 'utf8') }));
}

/** Blank out comments (keeping newlines) so commented-out code is not scanned. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function extractImports(rawText: string): ImportRef[] {
  const text = stripComments(rawText);
  const refs: ImportRef[] = [];
  const patterns: { re: RegExp; typeGroup: boolean }[] = [
    // import x from 'a' / import type {…} from 'a' / export … from 'a' (possibly multi-line)
    {
      re: /\b(import|export)(\s+type)?\b(?:[^'"`;]*?)\bfrom\s*(['"])([^'"\n]+)\3/g,
      typeGroup: true,
    },
    // side-effect import 'a'
    { re: /\bimport\s*(['"])([^'"\n]+)\1/g, typeGroup: false },
    // dynamic import('a')
    { re: /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, typeGroup: false },
  ];
  for (const { re, typeGroup } of patterns) {
    for (const m of text.matchAll(re)) {
      const specifier = typeGroup ? m[4]! : m[2]!;
      refs.push({ specifier, line: lineOf(text, m.index ?? 0), typeOnly: typeGroup && !!m[2] });
    }
  }
  return refs;
}

/** Layer of a repo-relative path inside server/src, or the root file name. */
function layerOf(path: string): string {
  const rel = path.replace(/^server\/src\//, '');
  const top = rel.split('/')[0]!;
  return ['domain', 'application', 'infrastructure', 'presentation'].includes(top)
    ? top
    : `root:${rel}`;
}

/** Resolve a relative specifier to a repo-relative path without extension. */
function resolveRelative(fromPath: string, specifier: string): string {
  const target = posix(join(dirname(fromPath), specifier)).replace(/\.(js|ts)$/, '');
  return target;
}

const isShared = (s: string): boolean =>
  s === '@agent-ops/shared' || s.startsWith('@agent-ops/shared/');

interface LayerRule {
  layer: string;
  /** Returns a reason when the import is not allowed. */
  check: (file: SourceFile, ref: ImportRef) => string | undefined;
}

function insideDir(target: string, dir: string): boolean {
  return target === dir || target.startsWith(`${dir}/`);
}

const layerRules: LayerRule[] = [
  {
    layer: 'domain',
    check: (file, ref) => {
      if (ref.specifier.startsWith('.')) {
        const target = resolveRelative(file.path, ref.specifier);
        return insideDir(target, 'server/src/domain')
          ? undefined
          : `domain imports outside domain/: ${ref.specifier}`;
      }
      if (isShared(ref.specifier))
        return ref.typeOnly ? undefined : 'domain must use `import type` from @agent-ops/shared';
      return `domain may not import "${ref.specifier}"`;
    },
  },
  {
    layer: 'application',
    check: (file, ref) => {
      if (ref.specifier.startsWith('.')) {
        const target = resolveRelative(file.path, ref.specifier);
        return insideDir(target, 'server/src/domain') || insideDir(target, 'server/src/application')
          ? undefined
          : `application imports outside domain/ and application/: ${ref.specifier}`;
      }
      if (isShared(ref.specifier)) return undefined;
      return `application may not import "${ref.specifier}"`;
    },
  },
  {
    layer: 'presentation',
    check: (file, ref) => {
      if (ref.specifier.startsWith('.')) {
        const target = resolveRelative(file.path, ref.specifier);
        const ok =
          insideDir(target, 'server/src/application') ||
          insideDir(target, 'server/src/presentation') ||
          target === 'server/src/domain/errors';
        return ok
          ? undefined
          : `presentation imports outside application/, presentation/ and domain/errors: ${ref.specifier}`;
      }
      if (isShared(ref.specifier)) return undefined;
      // `import type` from zod is a compile-time-only type reference (no schema is built); ADR-0010 forbids
      // only infrastructure/ and drizzle-orm in presentation, so type-only zod is tolerated.
      if (ref.typeOnly && ref.specifier === 'zod') return undefined;
      if (
        ref.specifier === 'fastify' ||
        ref.specifier.startsWith('@fastify/') ||
        ref.specifier.startsWith('node:')
      ) {
        return undefined;
      }
      return `presentation may not import "${ref.specifier}"`;
    },
  },
  {
    layer: 'infrastructure',
    check: (file, ref) => {
      if (!ref.specifier.startsWith('.')) return undefined;
      const target = resolveRelative(file.path, ref.specifier);
      return insideDir(target, 'server/src/presentation')
        ? `infrastructure may not import presentation: ${ref.specifier}`
        : undefined;
    },
  },
];

function checkLayer(layer: string, files: SourceFile[]): Violation[] {
  const rule = layerRules.find((r) => r.layer === layer)!;
  const out: Violation[] = [];
  for (const file of files.filter((f) => layerOf(f.path) === layer)) {
    for (const ref of extractImports(file.text)) {
      const message = rule.check(file, ref);
      if (message) out.push({ path: file.path, line: ref.line, message });
    }
  }
  return out;
}

const COMPOSITION_ROOT_FILES = new Set(['server/src/container.ts', 'server/src/main.ts']);

/** ADR-0009: drizzle-orm / pg / postgres / db/schema only under infrastructure. */
function checkPersistenceImports(files: SourceFile[]): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    if (layerOf(file.path) === 'infrastructure') continue;
    for (const ref of extractImports(file.text)) {
      const s = ref.specifier;
      const bad =
        /^(drizzle-orm|pg|postgres)(\/|$)/.test(s) || /(^|\/)db\/schema(\.js|\.ts)?$/.test(s);
      if (bad)
        out.push({
          path: file.path,
          line: ref.line,
          message: `persistence import "${s}" outside infrastructure/`,
        });
    }
  }
  return out;
}

/** Adapters (`new …Repository(` / `new …Clock(`) are built only in container.ts. */
function checkAdapterInstantiation(files: SourceFile[]): Violation[] {
  const out: Violation[] = [];
  const re = /\bnew\s+[A-Za-z0-9_]*(Repository|Clock)\s*\(/g;
  for (const file of files) {
    if (file.path === 'server/src/container.ts') continue;
    // Factories (create*Repository) live in infrastructure; fakes implementing ports live in application/testing.
    if (layerOf(file.path) === 'infrastructure') continue;
    if (file.path.startsWith('server/src/application/testing/')) continue;
    const text = stripComments(file.text);
    for (const m of text.matchAll(re)) {
      out.push({
        path: file.path,
        line: lineOf(text, m.index ?? 0),
        message: `adapter instantiated outside container.ts: ${m[0]}`,
      });
    }
  }
  return out;
}

function checkPatterns(files: SourceFile[], re: RegExp, message: string): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    const text = stripComments(file.text);
    for (const m of text.matchAll(re)) {
      out.push({
        path: file.path,
        line: lineOf(text, m.index ?? 0),
        message: `${message}: ${m[0]}`,
      });
    }
  }
  return out;
}

function checkSharedImports(files: SourceFile[]): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    for (const ref of extractImports(file.text)) {
      const s = ref.specifier;
      const ok = s.startsWith('.') || s === 'zod' || s.startsWith('zod/');
      if (!ok)
        out.push({
          path: file.path,
          line: ref.line,
          message: `shared may import only zod and relative files, found "${s}"`,
        });
    }
  }
  return out;
}

const fmt = (vs: Violation[]): string[] => vs.map((v) => `${v.path}:${v.line} ${v.message}`);

const serverFiles = loadSources(SERVER_SRC);
const sharedFiles = loadSources(SHARED_SRC);
const inLayer = (layer: string): SourceFile[] =>
  serverFiles.filter((f) => layerOf(f.path) === layer);

describe('architecture: import scan sanity', () => {
  it('finds sources in every layer so the rules are not vacuous', () => {
    // contract: an empty scan would make every rule pass trivially
    for (const layer of ['domain', 'application', 'infrastructure', 'presentation']) {
      expect(inLayer(layer).length, `no files found in ${layer}/`).toBeGreaterThan(0);
    }
    expect(sharedFiles.length).toBeGreaterThan(0);
  });

  it('extracts static, multi-line, re-export, side-effect and dynamic imports but ignores comments', () => {
    // contract: the scanner must see every import form and not commented-out code
    const refs = extractImports(
      [
        "import type { A } from '@agent-ops/shared';",
        'import {',
        '  b,',
        "} from './b.js';",
        "export * from './c';",
        "import './side';",
        "const m = await import('./lazy');",
        "// import x from 'commented'",
        "/* import y from 'block' */",
      ].join('\n'),
    );
    expect(refs).toEqual([
      { specifier: '@agent-ops/shared', line: 1, typeOnly: true },
      { specifier: './b.js', line: 2, typeOnly: false },
      { specifier: './c', line: 5, typeOnly: false },
      { specifier: './side', line: 6, typeOnly: false },
      { specifier: './lazy', line: 7, typeOnly: false },
    ]);
  });

  it('flags an infrastructure import added to a domain file (synthetic sample)', () => {
    // contract: a domain file importing infrastructure/ must be reported with file:line
    const sample: SourceFile = {
      path: 'server/src/domain/sample.ts',
      text: "import type { T } from '@agent-ops/shared';\nimport { db } from '../infrastructure/db/client.js';\n",
    };
    const violations = checkLayer('domain', [sample]);
    expect(fmt(violations)).toEqual([expect.stringMatching(/^server\/src\/domain\/sample\.ts:2 /)]);
    // contract: application importing drizzle-orm / infrastructure is reported too
    const app: SourceFile = {
      path: 'server/src/application/s.ts',
      text: "import { eq } from 'drizzle-orm';\nimport x from '../infrastructure/x';\n",
    };
    expect(checkLayer('application', [app])).toHaveLength(2);
  });
});

describe('architecture: ADR-0010 layers', () => {
  it('domain imports only domain files and `import type` from @agent-ops/shared', () => {
    expect(fmt(checkLayer('domain', serverFiles))).toEqual([]);
  });

  it('application imports only domain, shared and application (no drizzle-orm, pg, fastify, infrastructure, presentation)', () => {
    expect(fmt(checkLayer('application', serverFiles))).toEqual([]);
  });

  it('presentation imports only application, domain/errors, shared and fastify (no infrastructure, no drizzle-orm)', () => {
    expect(fmt(checkLayer('presentation', serverFiles))).toEqual([]);
  });

  it('presentation defines no schemas with z.object (schemas live in shared)', () => {
    expect(
      fmt(checkPatterns(inLayer('presentation'), /\bz\.object\b/g, 'z.object in presentation')),
    ).toEqual([]);
  });

  it('infrastructure does not import presentation', () => {
    expect(fmt(checkLayer('infrastructure', serverFiles))).toEqual([]);
  });

  it('only server/src/container.ts (and main.ts, cli/**) import across all layers', () => {
    // contract: a non-layer root file other than the composition root must not reach into 3+ layers
    const offenders: Violation[] = [];
    for (const file of serverFiles) {
      const layer = layerOf(file.path);
      if (!layer.startsWith('root:')) continue;
      if (COMPOSITION_ROOT_FILES.has(file.path) || file.path.startsWith('server/src/cli/'))
        continue;
      const touched = new Set<string>();
      for (const ref of extractImports(file.text)) {
        if (!ref.specifier.startsWith('.')) continue;
        const l = layerOf(resolveRelative(file.path, ref.specifier));
        if (!l.startsWith('root:')) touched.add(l);
      }
      if (touched.size > 1)
        offenders.push({
          path: file.path,
          line: 1,
          message: `imports across layers: ${[...touched].join(', ')}`,
        });
    }
    expect(fmt(offenders)).toEqual([]);
  });

  it('concrete adapters (new …Repository( / new …Clock() are instantiated only in container.ts', () => {
    expect(fmt(checkAdapterInstantiation(serverFiles))).toEqual([]);
  });
});

describe('architecture: ADR-0009 persistence', () => {
  it('drizzle-orm, pg, postgres and db/schema are imported only under infrastructure/', () => {
    expect(fmt(checkPersistenceImports(serverFiles))).toEqual([]);
  });

  it('no code issues UPDATE or DELETE on events', () => {
    expect(
      fmt(
        checkPatterns(
          serverFiles,
          /update\(\s*events\s*\)|delete\(\s*events\s*\)|UPDATE\s+events\b|DELETE\s+FROM\s+events\b/gi,
          'mutates events',
        ),
      ),
    ).toEqual([]);
  });
});

describe('architecture: ADR-0008 simulation determinism', () => {
  const simulation = serverFiles.filter((f) =>
    f.path.startsWith('server/src/application/simulation/'),
  );

  it('finds simulation sources', () => {
    expect(simulation.length).toBeGreaterThan(0);
  });

  it('application/simulation reads no wall clock (Date.now, new Date()) and no Math.random', () => {
    expect(
      fmt(
        checkPatterns(
          simulation,
          /\bDate\.now\b|\bnew\s+Date\s*\(|\bMath\.random\b/g,
          'non-deterministic source',
        ),
      ),
    ).toEqual([]);
  });
});

describe('architecture: ADR-0002 shared package', () => {
  it('shared/src non-test files import only zod and relative files', () => {
    expect(fmt(checkSharedImports(sharedFiles))).toEqual([]);
  });

  it('server/src never imports the web package', () => {
    const offenders: Violation[] = [];
    for (const file of serverFiles) {
      for (const ref of extractImports(file.text)) {
        if (
          /^@agent-ops\/web(\/|$)/.test(ref.specifier) ||
          /(^|\/)web\/src\//.test(ref.specifier)
        ) {
          offenders.push({
            path: file.path,
            line: ref.line,
            message: `imports web: ${ref.specifier}`,
          });
        }
      }
    }
    expect(fmt(offenders)).toEqual([]);
  });
});
