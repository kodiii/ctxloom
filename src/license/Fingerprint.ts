import crypto from 'node:crypto';
import os from 'node:os';
import { readFileSync } from 'node:fs';

function machineId(): string {
  // Try Linux machine-id first for strongest stability
  try {
    return readFileSync('/etc/machine-id', 'utf8').trim();
  } catch {
    // fallback: not available on macOS/Windows
  }
  try {
    return readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
  } catch {
    // fallback
  }
  // macOS / Windows: compose from hostname + username (stable enough for seat tracking)
  return `${os.hostname()}:${os.userInfo().username}:${os.platform()}`;
}

export const Fingerprint = {
  async compute(): Promise<string> {
    const raw = [os.hostname(), os.userInfo().username, os.platform(), machineId()].join('|');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return `sha256:${hash}`;
  },
};
