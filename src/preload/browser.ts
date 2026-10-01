import { contextBridge, ipcRenderer } from 'electron';
import type { WebsiteState } from '../shared/website.js';
const ready = new Promise<string>(resolve => {
  ipcRenderer.once('website:init', (_event, value: string) => resolve(value));
});
contextBridge.exposeInMainWorld('website', {
  command: async (command: string, value?: string): Promise<WebsiteState> =>
    ipcRenderer.invoke(await ready, command, value),
  onState: (callback: (state: WebsiteState) => void): void => {
    ipcRenderer.on('website:state', (_event, state: WebsiteState) => callback(state));
  },
});
