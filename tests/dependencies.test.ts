import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const FORBIDDEN = ['mlfw', 'quantc', 'tera'];

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function sourceFiles(...dirs: string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) walk(resolve(ROOT, d), out);
  return out;
}

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text)) !== null) {
    const spec = m[1] ?? m[2];
    if (spec !== undefined) out.push(spec);
  }
  return out;
}

function packageJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as Record<string, unknown>;
}

describe('dependency discipline', () => {
  const allSources = sourceFiles('packages', 'apps', 'bench');

  it('no source file imports mlfw, quantc, or tera', () => {
    for (const file of allSources) {
      for (const spec of importsOf(file)) {
        for (const bad of FORBIDDEN) {
          expect(spec === bad || spec.startsWith(`${bad}/`), `${file} imports "${spec}"`).toBe(false);
        }
      }
    }
  });

  it('contracts and numeric import nothing at all', () => {
    for (const dir of ['packages/contracts/src', 'packages/numeric/src']) {
      for (const file of sourceFiles(dir)) {
        for (const spec of importsOf(file)) {
          expect(spec.startsWith('./') || spec.startsWith('../'), `${file} imports external "${spec}"`).toBe(true);
        }
      }
    }
  });

  it('live does not import the lobster adapter', () => {
    for (const file of sourceFiles('packages/live/src')) {
      for (const spec of importsOf(file)) {
        expect(spec.indexOf('lobster'), `${file} imports "${spec}"`).toBe(-1);
      }
    }
  });

  it('every workspace package declares only @hft/* runtime dependencies', () => {
    const root = packageJson('package.json');
    const workspaces = root.workspaces as string[];
    expect(Object.keys(root.dependencies as object)).toEqual([]);
    expect(Object.keys(root.devDependencies as object).sort()).toEqual(['typescript', 'vitest']);

    for (const ws of workspaces) {
      const pkg = packageJson(join(ws, 'package.json'));
      const deps = (pkg.dependencies ?? {}) as Record<string, string>;
      for (const name of Object.keys(deps)) {
        expect(name.startsWith('@hft/'), `${ws} depends on external package "${name}"`).toBe(true);
      }
      expect(pkg.devDependencies, `${ws} must not declare devDependencies`).toBeUndefined();
    }
  });

  it('no external runtime imports beyond node stdlib and @hft/*', () => {
    for (const file of allSources) {
      if (file.endsWith('.test.ts')) continue;
      for (const spec of importsOf(file)) {
        const ok =
          spec.startsWith('./') ||
          spec.startsWith('../') ||
          spec.startsWith('@hft/') ||
          spec.startsWith('node:');
        expect(ok, `${file} imports "${spec}"`).toBe(true);
      }
    }
  });

  it('the package dependency graph is acyclic and contracts is a sink', () => {
    const edges = new Map<string, string[]>();
    const packages = [
      'packages/contracts',
      'packages/events',
      'packages/book',
      'packages/metrics',
      'packages/numeric',
      'packages/sim',
      'packages/strategy',
      'packages/live',
      'packages/adapters/lobster',
      'packages/adapters/binance',
    ];
    for (const p of packages) {
      const pkg = packageJson(join(p, 'package.json'));
      edges.set(pkg.name as string, Object.keys((pkg.dependencies ?? {}) as object));
    }
    expect(edges.get('@hft/contracts')).toEqual([]);
    expect(edges.get('@hft/numeric')).toEqual([]);

    const state = new Map<string, number>();
    const visit = (node: string): void => {
      const s = state.get(node) ?? 0;
      if (s === 1) throw new Error(`cycle through ${node}`);
      if (s === 2) return;
      state.set(node, 1);
      for (const next of edges.get(node) ?? []) visit(next);
      state.set(node, 2);
    };
    for (const name of edges.keys()) visit(name);
  });
});
