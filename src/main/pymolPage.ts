import { patchPymolReader, patchPymolOpaqueRendering } from './pymolRuntime.js';
import runtime from './vendor/jsmol/runtime.json';
import { injectWebBridgeRuntime, WEB_BRIDGE_FORWARDED_KEYS, WEB_BRIDGE_SOURCE } from '../shared/webBridge.js';

/** Everything the sandbox needs travels in one document, including the PSE. */
export function pymolPage(session: Uint8Array, title: string, license: string): string {
  const files: Record<string, string> = { ...runtime };
  files['j2s/core/corepymol.z.js'] = patchPymolReader(files['j2s/core/corepymol.z.js']);
  files['j2s/core/corejmol.z.js'] = patchPymolOpaqueRendering(files['j2s/core/corejmol.z.js']);
  const entry = files['JSmol.min.js'];
  delete files['JSmol.min.js'];
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]!);
  return injectWebBridgeRuntime(`<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'">
<style>html,body,#viewer{margin:0;width:100%;height:100%;overflow:hidden}#viewer{position:absolute;inset:0}canvas{display:block}#status{position:absolute;inset:0;display:grid;place-items:center;font:16px system-ui;background:#fff;color:#222}#status{overflow-wrap:anywhere;padding:24px;box-sizing:border-box}#status[hidden]{display:none}</style>
</head><body><div id="viewer" aria-label="${escape(title)}"></div><div id="status" role="status" hidden>Loading molecule…</div>
<script type="application/json" id="jsmol-license">${json(license)}</script>
<script>${entry.replace(/<\/script/gi, '<\\/script')}</script>
<script>
(function () {
  var files = ${json(files)};
  var sessionBase64 = ${json(Buffer.from(session).toString('base64'))};
  var bytes = atob(sessionBase64);
  var status = document.getElementById('status');
  setTimeout(function() { if (!document.body.dataset.pymolReady) status.hidden = false; }, 500);
  function fail(message) {
    // Reader diagnostics can echo the entire session data URI. Keep errors
    // bounded before crossing Electron IPC or putting them into the layout.
    message = String(message || 'The molecular viewer could not read this session')
      .replace(/data:application[^\\s"']*/g, '[embedded session]').slice(0, 600);
    if (document.body.dataset.pymolError) return;
    console.error(message);
    document.body.dataset.pymolError = message;
    status.hidden = false;
    status.textContent = 'Could not load PyMOL session: ' + message;
  }
  window.alert = fail;
  // Embedded presentations never contact JSmol's optional usage tracker.
  Jmol._tracker = false;
  window.addEventListener('error', function(e) { fail(e.message); });
  // JSmol consumes navigation keys on its canvas. Reserve the deck's keys
  // before they reach it, including Escape when interacting in the editor.
  window.addEventListener('keydown', function(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || ${json(WEB_BRIDGE_FORWARDED_KEYS)}.indexOf(event.key) < 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    window.parent.postMessage({source:${json(WEB_BRIDGE_SOURCE)}, action:'key', key:event.key}, '*');
  }, true);
  Jmol._getFileData = function(url, callback) {
    var value;
    if (url.startsWith('data:application/octet-stream;base64,')) value = Jmol._strToBytes(bytes);
    else {
      var key = url.slice(url.indexOf('j2s/'));
      if (!Object.prototype.hasOwnProperty.call(files, key)) {
        var message = 'Unsupported session resource: ' + url.slice(0, 180);
        fail(message);
        throw new Error(message);
      }
      value = files[key];
    }
    if (callback) callback(value);
    return value;
  };
  Jmol.$ajax = function(options) {
    var text = Jmol._getFileData(options.url);
    if (options.dataType === 'script') (0, eval)(text);
    if (options.success) options.success(text);
    return { responseText: text };
  };
  var wrapper = Jmol._getWrapper;
  // JSmol's normal wrapper references external spinner images. The host owns
  // progress; strip those images and explicitly start the applet below.
  Jmol._getWrapper = function() { return wrapper.apply(this, arguments).replace(/<image[^>]*>/g, ''); };
  Jmol._isAsync = false;
  Jmol.setDocument(0);
  try {
    document.getElementById('viewer').innerHTML = Jmol.getAppletHtml('molecule', {
      width:'100%', height:'100%', use:'HTML5', j2sPath:'j2s',
      disableJ2SLoadMonitor:true, disableInitialConsole:true, allowJavaScript:false,
      appletLoadingImage:'none',
      readyFunction:function(applet) {
        try {
          // Use the standard wheel event (including trackpads). JSmol's
          // legacy mousewheel listener drops some Chromium wheel gestures.
          var viewer = document.getElementById('viewer');
          var restingQuality = null, dragging = false, restoreTimer;
          var zoomFrame = 0, zoomDelta = 0;
          function restoreQuality() {
            if (!restingQuality || dragging) return;
            var v = applet._applet.viewer;
            v.setBooleanProperty('antialiasDisplay', restingQuality.antialias);
            v.setBooleanProperty('cartoonsFancy', restingQuality.fancy);
            v.setIntProperty('hermiteLevel', restingQuality.hermite);
            restingQuality = null;
            delete document.body.dataset.pymolMoving;
          }
          function moving() {
            clearTimeout(restoreTimer);
            if (!restingQuality && document.body.dataset.pymolReady) {
              var v = applet._applet.viewer;
              restingQuality = {antialias:v.g.antialiasDisplay, fancy:v.g.cartoonFancy, hermite:v.g.hermiteLevel};
              // Keep the canvas and input coordinates unchanged. Only the
              // expensive sampling/mesh detail is reduced during movement.
              v.setBooleanProperty('antialiasDisplay', false);
              v.setBooleanProperty('cartoonsFancy', false);
              v.setIntProperty('hermiteLevel', -1);
              document.body.dataset.pymolMoving = 'true';
            }
            restoreTimer = setTimeout(restoreQuality, 250);
          }
          function released() {
            dragging = false;
            clearTimeout(restoreTimer);
            restoreTimer = setTimeout(restoreQuality, 250);
          }
          function stopInteraction() {
            dragging = false;
            clearTimeout(restoreTimer);
            cancelAnimationFrame(zoomFrame);
            zoomFrame = 0; zoomDelta = 0;
            restoreQuality();
          }
          viewer.addEventListener('pointerdown', function() { dragging = true; moving(); }, true);
          window.addEventListener('pointerup', released, true);
          window.addEventListener('pointercancel', released, true);
          window.addEventListener('blur', stopInteraction);
          window.deckwerk.onInactive(stopInteraction);
          viewer.addEventListener('mousewheel', function(event) {
            event.preventDefault(); event.stopImmediatePropagation();
          }, {capture:true, passive:false});
          viewer.addEventListener('wheel', function(event) {
            event.preventDefault(); event.stopImmediatePropagation();
            var delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
            if (!delta || !document.body.dataset.pymolReady) return;
            moving();
            zoomDelta += Math.max(-200, Math.min(200, delta));
            // Apply a wheel burst once per frame through the normal viewer
            // transform API instead of queuing one Jmol script per event.
            if (!zoomFrame) zoomFrame = requestAnimationFrame(function() {
              var factor = Math.exp(-Math.max(-2000, Math.min(2000, zoomDelta)) * 0.001);
              zoomFrame = 0; zoomDelta = 0;
              applet._applet.viewer.zoomByFactor(factor, 2147483647, 2147483647);
            });
          }, {capture:true, passive:false});
          window.pymolLoaded = function() {
            if (!(Number(Jmol.evaluateVar(applet, '{*}.count')) > 0)) { fail('No readable atoms in this session'); return; }
            if (document.body.dataset.pymolError) return;
            status.hidden = true;
            document.body.dataset.pymolReady = 'true';
          };
          Jmol.setCallback(applet, 'loadStructCallback', 'pymolLoaded');
          window.pymolFailed = function(_applet, type, message) { fail(message || type); };
          Jmol.setCallback(applet, 'errorCallback', 'pymolFailed');
          Jmol.script(applet, 'set disablePopupMenu true; load "data:application/octet-stream;base64,' + sessionBase64 + '"; animation off; spin off;');
          var started = Date.now();
          var check = setInterval(function() {
            if (document.body.dataset.pymolError) { clearInterval(check); return; }
            if (Number(Jmol.evaluateVar(applet, '{*}.count')) > 0) { clearInterval(check); window.pymolLoaded(); }
            else if (Date.now() - started > 25000) { clearInterval(check); fail('No readable atoms. This session may be unsupported or damaged.'); }
          }, 100);
        } catch(e) { fail(e.message || String(e)); }
      }
    }).replace(/<img[^>]*>/g, '');
    molecule._cover(false);
    window.deckwerk.onInactive(function() { Jmol.script(molecule, 'animation off; spin off'); });
  } catch(e) { fail(e.message || String(e)); }
})();
</script></body></html>`);
}
