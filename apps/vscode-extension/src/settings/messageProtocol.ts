import type { LicenseState } from '../license/LicenseGate.js';

export interface PanelState {
  license: LicenseState;
  settings: Record<string, unknown>;
  banner?: { kind: 'info' | 'warn' | 'error'; text: string };
  /**
   * Set when a universal opt-out env var (CTXLOOM_NO_TELEMETRY=1 or
   * DO_NOT_TRACK=1) is in effect on the host. The Settings panel uses
   * this to grey out the telemetry controls and explain why they have
   * no effect, instead of silently misleading the user.
   */
  telemetryDisabledByEnv?: { variable: 'CTXLOOM_NO_TELEMETRY' | 'DO_NOT_TRACK' };
}

export type HostToWebview =
  | { kind: 'state'; state: PanelState }
  | { kind: 'trialCheckoutOpened'; checkoutUrl: string }
  | { kind: 'activationResult'; ok: boolean; error?: string }
  | { kind: 'deactivationResult'; ok: boolean; error?: string };

export type WebviewToHost =
  | { kind: 'ready' }
  | { kind: 'setSetting'; key: string; value: unknown }
  | { kind: 'startTrial'; email: string }
  | { kind: 'activateLicense'; key: string }
  | { kind: 'deactivateLicense' }
  | { kind: 'openExternal'; url: string }
  | { kind: 'restartServer' }
  | { kind: 'showOutput' };

const HOST_KINDS = new Set(['state', 'trialCheckoutOpened', 'activationResult', 'deactivationResult']);
const WEBVIEW_KINDS = new Set(['ready', 'setSetting', 'startTrial', 'activateLicense', 'deactivateLicense', 'openExternal', 'restartServer', 'showOutput']);

function isString(v: unknown): v is string { return typeof v === 'string'; }
function hasKey(o: unknown, k: string): o is Record<string, unknown> { return typeof o === 'object' && o !== null && k in o; }

export function parseHostMessage(raw: unknown): HostToWebview | null {
  if (!hasKey(raw, 'kind') || !isString(raw.kind) || !HOST_KINDS.has(raw.kind)) return null;
  return raw as HostToWebview;
}

export function parseWebviewMessage(raw: unknown): WebviewToHost | null {
  if (!hasKey(raw, 'kind') || !isString(raw.kind) || !WEBVIEW_KINDS.has(raw.kind)) return null;
  switch (raw.kind) {
    case 'setSetting':
      if (!hasKey(raw, 'key') || !isString(raw.key) || !('value' in raw)) return null;
      return raw as WebviewToHost;
    case 'startTrial':
      if (!hasKey(raw, 'email') || !isString(raw.email)) return null;
      return raw as WebviewToHost;
    case 'activateLicense':
      if (!hasKey(raw, 'key') || !isString(raw.key)) return null;
      return raw as WebviewToHost;
    case 'openExternal':
      if (!hasKey(raw, 'url') || !isString(raw.url)) return null;
      return raw as WebviewToHost;
    case 'ready':
    case 'deactivateLicense':
    case 'restartServer':
    case 'showOutput':
      return raw as WebviewToHost;
    default:
      return null;
  }
}
