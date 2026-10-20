'use strict';
// stage-gsk.cjs — stage code-only family members into workbench/ for
// electron-builder: gsk -> gsk-pkg, cpl -> cpl-pkg, scribe -> scribe-pkg.
//
// Why staging: electron-builder resolves build.files patterns relative to
// the workbench/ project dir — "../cpl" siblings are unreachable and used to
// silently ship NOTHING for cpl/scribe (the broken-customer-exe bug). Each
// staged member is copied into workbench/ so build.files object entries
// ({"from": "x-pkg", "to": "x"}) pack it as resources/app/<member>/.
//
// Skip lists: gsk/cpl are dependency-free (node_modules, dev data excluded).
// scribe NEEDS its node_modules (uuid+ws) — only dev data/logs excluded.
//
// Usage: node scripts/stage-gsk.cjs  (also runs via `npm run dist`)
const fs = require('fs');
const path = require('path');

const MEMBERS = [
  {
    name: 'gsk',
    root: path.resolve(__dirname, '..', '..', 'gsk'),
    dest: path.resolve(__dirname, '..', 'gsk-pkg'),
    skip: new Set(['data', 'logs', 'node_modules', '.git']),
  },
  {
    name: 'cpl',
    root: path.resolve(__dirname, '..', '..', 'cpl'),
    dest: path.resolve(__dirname, '..', 'cpl-pkg'),
    skip: new Set(['.git']),
  },
  {
    name: 'scribe',
    root: path.resolve(__dirname, '..', '..', 'scribe'),
    dest: path.resolve(__dirname, '..', 'scribe-pkg'),
    skip: new Set(['data', 'logs', '.git']),
  },
];

function countFiles(d) {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(d, e.name)) : 1;
  }
  return n;
}

for (const member of MEMBERS) {
  if (!fs.existsSync(member.root)) {
    console.log(`[stage-gsk] WARN: ${member.name} missing at ${member.root} — skipping`);
    continue;
  }
  fs.rmSync(member.dest, { recursive: true, force: true });
  fs.mkdirSync(member.dest, { recursive: true });
  for (const entry of fs.readdirSync(member.root, { withFileTypes: true })) {
    if (member.skip.has(entry.name)) continue;
    fs.cpSync(path.join(member.root, entry.name), path.join(member.dest, entry.name), { recursive: true });
  }
  console.log(`[stage-gsk] staged ${member.name}: ${countFiles(member.dest)} files -> ${member.dest}`);
}