import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { youtubeUrl } from '../shared/youtube.js';
import { importAsset } from './deckStore.js';
import { getFfmpegPath } from './ffmpeg.js';

export function youtubeDownloader(): string {
  if (process.env.DECKWERK_YTDLP_PATH) return process.env.DECKWERK_YTDLP_PATH;
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const candidates = [
    resolve(import.meta.dirname, '../../.venv-youtube', process.platform === 'win32' ? 'Scripts' : 'bin', name),
    ...((process.env.PATH ?? '').split(delimiter)).map(dir => join(dir, name)),
    join('/opt/homebrew/bin', name), join('/usr/local/bin', name),
  ];
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new Error('YouTube downloader is not installed. Run npm run setup:youtube in the checkout, or install yt-dlp and Node.js 22+ on this computer.');
  return found;
}

export async function importYoutube(
  deckDir: string, input: string, signal: AbortSignal,
  progress: (message: string, ratio: number | null) => void,
) {
  const url = youtubeUrl(input);
  const command = youtubeDownloader();
  signal.throwIfAborted();
  const work = await mkdtemp(join(tmpdir(), 'deckwerk-youtube-'));
  try {
    progress('Reading YouTube video…', null);
    await new Promise<void>((resolveDownload, reject) => {
      let title = 'YouTube video';
      const args = [
        '--ignore-config', '--no-playlist', '--no-cache-dir', '--no-simulate', '--newline',
        '--no-colors', '--progress', '--progress-delta', '0.5', '--socket-timeout', '20',
        '--retries', '3', '--fragment-retries', '3', '--max-filesize', '2G',
        '--match-filter', '!is_live', '--js-runtimes', 'node',
        '--ffmpeg-location', getFfmpegPath(),
        '-f', 'bv*[height<=1080]+ba/b[height<=1080]', '--merge-output-format', 'mp4',
        '-S', 'vcodec:h264,acodec:aac',
        '--print', 'before_dl:DW_TITLE %(title)j',
        '--progress-template', 'download:DW_PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
        '--progress-template', 'postprocess:DW_PROCESS',
        '-o', join(work, '%(title).100B [%(id)s].%(ext)s'), '--', url,
      ];
      const child = spawn(command, args, { windowsHide: true, detached: process.platform !== 'win32',
        env: { ...process.env, PATH: [process.env.PATH, '/opt/homebrew/bin', '/opt/homebrew/opt/node@22/bin', '/usr/local/bin'].filter(Boolean).join(delimiter) },
        stdio: ['ignore', 'pipe', 'pipe'] });
      let errors = '';
      let timedOut = false;
      const stop = () => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill('SIGKILL'));
          else child.kill('SIGKILL');
        } catch { /* Already exited. */ }
      };
      const timeout = setTimeout(() => { timedOut = true; stop(); }, 30 * 60_000);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        if (line.startsWith('DW_TITLE ')) {
          try { title = String(JSON.parse(line.slice(9))).slice(0, 200); } catch { /* Keep the fallback title. */ }
          progress(`Downloading ${title}`, null);
          return;
        }
        const match = /^DW_PROGRESS (\d+) (\d+)$/.exec(line);
        if (match) {
          const ratio = Number(match[2]) > 0 ? Math.min(1, Number(match[1]) / Number(match[2])) : null;
          progress(`Downloading ${title}`, ratio);
        } else if (line.startsWith('DW_PROCESS')) progress(`Preparing ${title}`, null);
      });
      child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-4000); });
      child.once('error', error => { errors = error.message; });
      child.once('close', code => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', stop);
        lines.close();
        if (signal.aborted) reject(new Error('YouTube import cancelled.'));
        else if (timedOut) reject(new Error('YouTube download timed out. Try again.'));
        else if (code !== 0) reject(new Error(errors.trim() || 'YouTube download failed.'));
        else resolveDownload();
      });
    });
    signal.throwIfAborted();
    const files = (await readdir(work)).filter(name => /\.(mp4|mkv|webm|mov)$/i.test(name));
    if (files.length !== 1) throw new Error('YouTube did not return a downloadable video. Live, private, or restricted videos may be unavailable.');
    progress(`Saving ${files[0]}`, null);
    const asset = await importAsset(deckDir, join(work, files[0]), ratio => progress(`Saving ${files[0]}`, ratio));
    signal.throwIfAborted();
    if (asset.kind !== 'video' || !asset.width || !asset.height) throw new Error('The downloaded video could not be read.');
    return asset;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
