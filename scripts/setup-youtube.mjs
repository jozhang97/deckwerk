import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython } from './importer-python.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = findPython();
if (!python) throw new Error('Install Python 3.10+ to set up YouTube imports.');
const venv = resolve(root, '.venv-youtube');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`Setup failed (${result.status})`);
}
run(python.command, [...python.prefix, '-m', 'venv', venv]);
run(join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  ['-m', 'pip', 'install', '--upgrade', 'yt-dlp[default]']);
console.log('YouTube downloader ready. Keep Node.js 22+ or Deno on PATH for YouTube playback challenges.');
