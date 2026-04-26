// Webview entry — vanilla TS, no React. Renders all six sections, posts changes back to host.

/// <reference lib="dom" />

declare global {
  interface Window {
    acquireVsCodeApi(): { postMessage(msg: unknown): void };
  }
}

const vscode = window.acquireVsCodeApi();
const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

interface PanelState {
  license: { kind: string; tier?: string; daysLeft?: number; expiresAt?: string };
  settings: Record<string, unknown>;
  banner?: { kind: 'info' | 'warn' | 'error'; text: string };
}

let state: PanelState | null = null;

window.addEventListener('message', e => {
  const msg = e.data as { kind: string };
  if (msg.kind === 'state') { state = (e.data as { state: PanelState }).state; render(); }
  else if (msg.kind === 'activationResult') { /* re-render on next state push */ }
  else if (msg.kind === 'trialCheckoutOpened') {
    // Show waiting overlay in license section.
    const li = root.querySelector('[data-section="license"]');
    if (li !== null) {
      li.querySelector<HTMLDivElement>('.license-waiting')?.removeAttribute('hidden');
    }
  }
});

vscode.postMessage({ kind: 'ready' });

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setSetting(key: string, value: unknown): void {
  vscode.postMessage({ kind: 'setSetting', key, value });
}

function render(): void {
  if (state === null || root === null) return;
  const s = state;
  const licensed = s.license.kind === 'LICENSED' || s.license.kind === 'TRIALING';
  const disabled = !licensed ? ' disabled' : '';
  root.innerHTML = `
    ${s.banner ? `<div class="banner ${s.banner.kind}">${escapeHtml(s.banner.text)}</div>` : ''}
    <section class="section" data-section="license">
      <h2>License</h2>
      ${renderLicense(s)}
    </section>
    <section class="section${disabled}" data-section="features">
      <h2>Features</h2>
      ${renderToggle('Hover cards', 'features.hover', s.settings)}
      ${renderToggle('Rules diagnostics', 'features.diagnostics', s.settings)}
      ${renderToggle('Gutter decorations', 'features.gutterDecorations', s.settings)}
      ${renderToggle('Code lens', 'features.codeLens', s.settings)}
      ${renderToggle('Rules quick-fixes', 'features.quickFixes', s.settings)}
      ${renderToggle('MCP bridge for AI assistants', 'features.mcpBridge', s.settings)}
    </section>
    <section class="section${disabled}" data-section="performance">
      <h2>Performance</h2>
      ${renderNumber('Debounce (ms)', 'debounceMs', s.settings)}
      ${renderNumber('Cache TTL (s)', 'cacheTtlSeconds', s.settings)}
    </section>
    <section class="section${disabled}" data-section="display">
      <h2>Display</h2>
      ${renderNumber('Gutter churn threshold (high)', 'gutter.churnThresholdHigh', s.settings)}
      ${renderNumber('Gutter churn threshold (medium)', 'gutter.churnThresholdMedium', s.settings)}
      ${renderToggle('Show dead-code marker', 'gutter.showDeadCodeMarker', s.settings)}
      ${renderText('Dashboard URL', 'dashboardUrl', s.settings)}
    </section>
    <section class="section${disabled}" data-section="telemetry">
      <h2>Telemetry</h2>
      ${renderToggle('Send anonymous usage data', 'telemetry.enabled', s.settings)}
      <div class="hint">Off by default. Never sends code or file paths.</div>
    </section>
    <section class="section${disabled}" data-section="advanced">
      <h2>Advanced</h2>
      ${renderText('Custom CLI path', 'cliPath', s.settings, 'bundled')}
      ${renderText('Server args (JSON array)', 'serverArgs', s.settings, '[]')}
    </section>
    <div class="footer">
      <a data-action="open-settings">Open in VS Code Settings →</a>
      <a data-action="restart-server">Restart server</a>
      <a data-action="show-output">Open Output</a>
    </div>
  `;
  attachHandlers();
}

function renderLicense(s: PanelState): string {
  if (s.license.kind === 'NO_LICENSE' || s.license.kind === 'EXPIRED') {
    return `
      <div class="row"><span><span class="dot bad"></span>${s.license.kind === 'EXPIRED' ? 'Expired' : 'Not activated'}</span></div>
      <div class="row" style="gap:8px">
        <button class="btn" data-action="start-trial">Start free trial…</button>
        <button class="btn" data-action="enter-key">I have a license key</button>
      </div>
      <div class="license-trial-form" hidden>
        <div class="row"><input class="input" data-input="trial-email" type="email" placeholder="email@company.com" /><button class="btn" data-action="submit-trial">Start trial</button></div>
      </div>
      <div class="license-waiting" hidden>
        <div class="hint">Check your email — your license key is on its way. Paste it here when it arrives.</div>
        <div class="row"><input class="input" data-input="key" placeholder="ctxloom-XXXX-XXXX-XXXX" /><button class="btn" data-action="submit-key">Activate</button></div>
      </div>
      <div class="license-key-form" hidden>
        <div class="row"><input class="input" data-input="key2" placeholder="ctxloom-XXXX-XXXX-XXXX" /><button class="btn" data-action="submit-key2">Activate</button></div>
      </div>
    `;
  }
  const tone = s.license.kind === 'TRIALING' && (s.license.daysLeft ?? 0) <= 2 ? 'warn' : 'good';
  const stateLabel = s.license.kind === 'TRIALING' ? `Trialing · ${s.license.daysLeft ?? 0} days left` : 'Active';
  return `
    <div class="row"><span><span class="dot ${tone}"></span>Tier: ${escapeHtml(s.license.tier ?? 'pro')} · ${stateLabel}</span></div>
    <div class="row"><button class="btn-secondary btn" data-action="deactivate">Deactivate this seat</button></div>
  `;
}

function renderToggle(label: string, key: string, settings: Record<string, unknown>): string {
  const on = Boolean(settings[key]) ? 'on' : '';
  return `<div class="row"><label>${escapeHtml(label)}</label><div class="toggle ${on}" data-toggle="${key}"></div></div>`;
}

function renderNumber(label: string, key: string, settings: Record<string, unknown>): string {
  const v = String(settings[key] ?? '');
  return `<div class="row"><label>${escapeHtml(label)}</label><input class="input" type="number" data-number="${key}" value="${escapeHtml(v)}" /></div>`;
}

function renderText(label: string, key: string, settings: Record<string, unknown>, placeholder = ''): string {
  const v = settings[key];
  const display = v === null || v === undefined ? '' : String(v);
  return `<div class="row"><label>${escapeHtml(label)}</label><input class="input" type="text" data-text="${key}" value="${escapeHtml(display)}" placeholder="${escapeHtml(placeholder)}" /></div>`;
}

function attachHandlers(): void {
  if (root === null) return;
  root.querySelectorAll<HTMLDivElement>('[data-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.toggle!;
      const next = !el.classList.contains('on');
      el.classList.toggle('on', next);
      setSetting(key, next);
    });
  });
  root.querySelectorAll<HTMLInputElement>('[data-number]').forEach(el => {
    el.addEventListener('change', () => setSetting(el.dataset.number!, Number(el.value)));
  });
  root.querySelectorAll<HTMLInputElement>('[data-text]').forEach(el => {
    el.addEventListener('change', () => {
      const key = el.dataset.text!;
      const v = el.value.trim();
      if (key === 'serverArgs') {
        try { setSetting(key, JSON.parse(v || '[]')); } catch { /* ignore invalid */ }
      } else {
        setSetting(key, v === '' ? null : v);
      }
    });
  });
  bindAction('start-trial', () => root.querySelector<HTMLDivElement>('.license-trial-form')?.removeAttribute('hidden'));
  bindAction('enter-key', () => root.querySelector<HTMLDivElement>('.license-key-form')?.removeAttribute('hidden'));
  bindAction('submit-trial', () => {
    const email = root.querySelector<HTMLInputElement>('[data-input="trial-email"]')?.value ?? '';
    if (email) vscode.postMessage({ kind: 'startTrial', email });
  });
  bindAction('submit-key', () => {
    const key = root.querySelector<HTMLInputElement>('[data-input="key"]')?.value ?? '';
    if (key) vscode.postMessage({ kind: 'activateLicense', key });
  });
  bindAction('submit-key2', () => {
    const key = root.querySelector<HTMLInputElement>('[data-input="key2"]')?.value ?? '';
    if (key) vscode.postMessage({ kind: 'activateLicense', key });
  });
  bindAction('deactivate', () => vscode.postMessage({ kind: 'deactivateLicense' }));
  bindAction('restart-server', () => vscode.postMessage({ kind: 'restartServer' }));
  bindAction('show-output', () => vscode.postMessage({ kind: 'showOutput' }));
  bindAction('open-settings', () => vscode.postMessage({ kind: 'openExternal', url: 'command:workbench.action.openSettings?%22ctxloom%22' }));
}

function bindAction(name: string, handler: () => void): void {
  if (root === null) return;
  root.querySelectorAll<HTMLElement>(`[data-action="${name}"]`).forEach(el => el.addEventListener('click', handler));
}
