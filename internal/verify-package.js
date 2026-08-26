#!/usr/bin/env node

const { spawnSync } = require('child_process');

const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const [manifest] = JSON.parse(result.stdout);
const paths = manifest.files.map((file) => file.path);
const required = [
  'LICENSE',
  'README.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'app.plugin.js',
];
const missing = required.filter((path) => !paths.includes(path));
const forbidden = paths.filter(
  (path) => path.startsWith('example/') || path.includes('/build/') || path.includes('__tests__')
);

if (missing.length || forbidden.length) {
  if (missing.length) {
    console.error(`Missing package files: ${missing.join(', ')}`);
  }
  if (forbidden.length) {
    console.error(`Unexpected package files: ${forbidden.join(', ')}`);
  }
  process.exit(1);
}

console.log(`Package verified: ${manifest.entryCount} files, ${manifest.size} bytes compressed.`);
