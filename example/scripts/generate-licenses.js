#!/usr/bin/env node
/* eslint-disable */
/**
 * generate-licenses.js — walk node_modules and emit assets/licenses.json
 *
 * Collects metadata + full license text for every direct dependency declared
 * in package.json and every transitive PRODUCTION dependency. devDependencies
 * are skipped (they don't ship in the consumer's app).
 *
 * Re-run whenever you add/remove/upgrade a dependency:
 *
 *   node scripts/generate-licenses.js
 *
 * The output (assets/licenses.json) is checked into source control and
 * imported by the Acknowledgments screen.
 */

const fs = require('fs');
const path = require('path');

const EXAMPLE_ROOT = path.resolve(__dirname, '..');
const NODE_MODULES = path.join(EXAMPLE_ROOT, 'node_modules');
const OUTPUT = path.join(EXAMPLE_ROOT, 'assets', 'licenses.json');

const LICENSE_FILENAMES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'License',
  'License.md',
  'License.txt',
  'license',
  'license.md',
  'license.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
  'COPYING.txt',
];

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readLicenseText(dir) {
  for (const name of LICENSE_FILENAMES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, 'utf8').trim();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function findPackageDir(pkgName, startDir) {
  // Walk up directories looking for node_modules/<pkgName>. Handles yarn
  // workspaces / pnpm-style hoisting where deps may live one level up.
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, 'node_modules', pkgName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function collectDeps(pkgDir, visited) {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  const pkg = readJSON(pkgJsonPath);
  if (!pkg) return;

  const key = `${pkg.name}@${pkg.version}`;
  if (visited.has(key)) return;
  visited.set(key, {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description || null,
    license:
      typeof pkg.license === 'string'
        ? pkg.license
        : pkg.license && pkg.license.type
          ? pkg.license.type
          : pkg.licenses && Array.isArray(pkg.licenses)
            ? pkg.licenses.map((l) => l.type).join(' OR ')
            : 'UNKNOWN',
    author:
      typeof pkg.author === 'string'
        ? pkg.author
        : pkg.author && pkg.author.name
          ? pkg.author.name + (pkg.author.email ? ` <${pkg.author.email}>` : '')
          : null,
    homepage: pkg.homepage || null,
    repository:
      typeof pkg.repository === 'string'
        ? pkg.repository
        : pkg.repository && pkg.repository.url
          ? pkg.repository.url
          : null,
    licenseText: readLicenseText(pkgDir),
  });

  // Recurse into production deps only.
  const deps = pkg.dependencies || {};
  for (const depName of Object.keys(deps)) {
    const depDir = findPackageDir(depName, pkgDir);
    if (depDir) collectDeps(depDir, visited);
  }
}

function main() {
  const rootPkg = readJSON(path.join(EXAMPLE_ROOT, 'package.json'));
  if (!rootPkg) {
    console.error('Could not read example/package.json');
    process.exit(1);
  }

  const visited = new Map();

  // Walk direct dependencies. devDependencies are excluded — those are
  // tooling that doesn't ship in the consumer's app, so they don't need
  // attribution. peerDependencies are skipped because the consumer provides
  // them, not us.
  const directDeps = rootPkg.dependencies || {};
  for (const depName of Object.keys(directDeps)) {
    const depDir = findPackageDir(depName, EXAMPLE_ROOT);
    if (depDir) {
      collectDeps(depDir, visited);
    } else {
      console.warn(`[warn] could not find ${depName} in node_modules`);
    }
  }

  const entries = Array.from(visited.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Stats by license type
  const stats = {};
  for (const e of entries) {
    stats[e.license] = (stats[e.license] || 0) + 1;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: entries.length,
        licenseBreakdown: stats,
        packages: entries,
      },
      null,
      2
    )
  );

  console.log(
    `[generate-licenses] wrote ${entries.length} entries → ${path.relative(EXAMPLE_ROOT, OUTPUT)}`
  );
  console.log('[generate-licenses] license breakdown:');
  for (const [lic, n] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} × ${lic}`);
  }
}

main();
