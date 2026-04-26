import type { LicenseState } from './LicenseGate.js';

export interface StatusBarInputs {
  licenseState: LicenseState;
  riskScore: number | null;
}

export interface StatusBarOutput {
  text: string;
  tooltip: string;
  color: string | undefined;
}

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderStatusBar(inputs: StatusBarInputs): StatusBarOutput {
  const { licenseState, riskScore } = inputs;
  const riskPart = riskScore !== null ? `⚠ ${riskScore.toFixed(2)}` : '';

  if (licenseState.kind === 'EXPIRED') {
    return { text: 'ctxloom expired', tooltip: 'License expired — click to reactivate.', color: 'statusBarItem.errorForeground' };
  }

  if (licenseState.kind === 'NO_LICENSE') {
    return { text: 'ctxloom', tooltip: 'Click to activate ctxloom.', color: undefined };
  }

  if (licenseState.kind === 'TRIALING') {
    if (licenseState.daysLeft <= 2) {
      const day = SHORT_DAY[new Date(licenseState.expiresAt).getDay()];
      const text = riskPart ? `${riskPart} · trial ends ${day}` : `trial ends ${day}`;
      return { text, tooltip: 'Trial ends soon — activate to continue.', color: 'statusBarItem.warningForeground' };
    }
    const text = riskPart ? `${riskPart} · trial ${licenseState.daysLeft}d` : `trial ${licenseState.daysLeft}d`;
    return { text, tooltip: 'ctxloom trial active.', color: undefined };
  }

  // LICENSED
  const text = riskPart ? `${riskPart} · ctxloom` : 'ctxloom';
  return { text, tooltip: 'Risk score for this file. Click to open dashboard.', color: undefined };
}

export interface StatusBarHandle { dispose(): void; update(inputs: StatusBarInputs): void }

export function createStatusBarItem(commandId: string): StatusBarHandle {
  // Lazy import to avoid loading vscode during unit tests
  const vscode = require('vscode');
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = commandId;
  item.show();
  return {
    update(inputs) {
      const r = renderStatusBar(inputs);
      item.text = r.text;
      item.tooltip = r.tooltip;
      item.color = r.color !== undefined ? new vscode.ThemeColor(r.color) : undefined;
    },
    dispose() { item.dispose(); },
  };
}
