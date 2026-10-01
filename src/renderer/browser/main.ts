import '../editor/editor.css';
import './style.css';
import { DelayedOperationProgress, type OperationHandle } from '../editor/operationProgress.js';
import type { WebsiteState } from '../../shared/website.js';
const api = (window as unknown as { website: {
  command(command: string, value?: string): Promise<WebsiteState | undefined>;
  onState(callback: (state: WebsiteState) => void): void;
} }).website;
const address = document.querySelector<HTMLInputElement>('#address')!;
const status = document.querySelector<HTMLElement>('#status')!;
const back = document.querySelector<HTMLButtonElement>('#back')!;
const forward = document.querySelector<HTMLButtonElement>('#forward')!;
const reload = document.querySelector<HTMLButtonElement>('#reload')!;
let loading = false;
let operation: OperationHandle | undefined;
const progress = new DelayedOperationProgress(({ message, busy }) => {
  status.textContent = message;
  status.dataset.busy = String(busy);
});
function update(state: WebsiteState): void {
  back.disabled = !state.back;
  forward.disabled = !state.forward;
  if (document.activeElement !== address && state.url) address.value = state.url;
  reload.textContent = state.loading ? 'Stop' : 'Reload';
  if (state.loading) {
    const message = `Loading ${state.url || address.value}…`;
    if (!operation) operation = progress.begin(message);
    else operation.update(message);
  } else {
    operation?.finish();
    operation = undefined;
    status.dataset.busy = 'false';
    status.textContent = state.error || (state.url ? `Loaded ${state.url}` : 'Enter a website address to start browsing.');
  }
  loading = state.loading;
}
async function command(action: string, value?: string): Promise<void> {
  try { const state = await api.command(action, value); if (state) update(state); }
  catch (error) { status.textContent = String(error); }
}
api.onState(update);
back.onclick = () => void command('back');
forward.onclick = () => void command('forward');
reload.onclick = () => void command(loading ? 'stop' : 'reload');
document.querySelector('form')!.onsubmit = event => {
  event.preventDefault(); address.blur(); void command('navigate', address.value);
};
address.focus();
