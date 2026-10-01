import { BrowserWindow, WebContentsView, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { websiteUrl, type WebsiteState } from '../shared/website.js';

/** Remote content has no preload and never shares the editor's session or IPC. */
export function openWebsiteBrowser(parent: BrowserWindow): void {
  const win = new BrowserWindow({
    parent, width: 1200, height: 850, show: false, title: 'Website — DeckWerk',
    backgroundColor: '#16161e',
    webPreferences: { preload: join(import.meta.dirname, '../preload/browser.mjs'), sandbox: false, contextIsolation: true, nodeIntegration: false },
  });
  const browsingSession = session.fromPartition(`website-${randomUUID()}`);
  browsingSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browsingSession.setPermissionCheckHandler(() => false);
  const view = new WebContentsView({ webPreferences: {
    session: browsingSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  win.contentView.addChildView(view);
  const resize = (): void => {
    const [width, height] = win.getContentSize();
    view.setBounds({ x: 0, y: 96, width, height: Math.max(0, height - 96) });
  };
  resize();
  win.on('resize', resize);
  let error = '';
  const state = (): WebsiteState => ({
    url: view.webContents.getURL(), back: view.webContents.canGoBack(),
    forward: view.webContents.canGoForward(), loading: view.webContents.isLoading(), error,
  });
  const publish = (): void => {
    if (!win.isDestroyed()) win.webContents.send('website:state', state());
  };
  const navigate = (input: string): void => {
    try {
      const url = websiteUrl(input);
      error = '';
      void view.webContents.loadURL(url).catch((err: Error) => { error = err.message; publish(); });
    } catch (err) { error = err instanceof Error ? err.message : String(err); publish(); }
  };
  view.webContents.on('will-navigate', (event, url) => {
    try { websiteUrl(url); } catch { event.preventDefault(); }
  });
  view.webContents.on('will-redirect', (event, url) => {
    try { websiteUrl(url); } catch { event.preventDefault(); }
  });
  view.webContents.setWindowOpenHandler(({ url }) => { navigate(url); return { action: 'deny' }; });
  view.webContents.on('did-start-loading', () => { error = ''; publish(); });
  view.webContents.on('did-stop-loading', publish);
  view.webContents.on('did-navigate', publish);
  view.webContents.on('did-navigate-in-page', publish);
  view.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) { error = description; publish(); }
  });
  const channel = `website:command:${win.webContents.id}`;
  ipcMain.handle(channel, (event, command: string, value?: string) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
    switch (command) {
      case 'navigate': if (typeof value === 'string') navigate(value); break;
      case 'back': if (view.webContents.canGoBack()) view.webContents.goBack(); break;
      case 'forward': if (view.webContents.canGoForward()) view.webContents.goForward(); break;
      case 'reload': view.webContents.reload(); break;
      case 'stop': view.webContents.stop(); break;
    }
    return state();
  });
  win.webContents.on('did-finish-load', () => win.webContents.send('website:init', channel));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('closed', () => { ipcMain.removeHandler(channel); view.webContents.close(); });
  win.once('ready-to-show', () => { if (process.env['DECKWERK_HEADLESS_TEST'] !== '1') win.show(); });
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (dev) void win.loadURL(`${dev}/browser/index.html`);
  else void win.loadFile(join(import.meta.dirname, '../renderer/browser/index.html'));
}
