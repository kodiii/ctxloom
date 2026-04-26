export type Tier = 'pro' | 'team' | 'enterprise' | 'trial';
export type Status = 'active' | 'trialing' | 'expired';

export interface LicenseInfo {
  tier: Tier;
  status: Status;
  /** ISO-8601 string */
  expiresAt: string;
  fingerprint: string;
}

export type LicenseState =
  | { kind: 'NO_LICENSE' }
  | { kind: 'TRIALING'; tier: Tier; daysLeft: number; expiresAt: string }
  | { kind: 'LICENSED'; tier: Tier; expiresAt: string }
  | { kind: 'EXPIRED'; expiresAt: string };

export interface LicenseGateOptions {
  getInfo: () => Promise<LicenseInfo | null>;
  recheckMs: number;
}

type Listener = (state: LicenseState) => void;

export class LicenseGate {
  private state: LicenseState = { kind: 'NO_LICENSE' };
  private listeners: Listener[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly opts: LicenseGateOptions) {}

  current(): LicenseState { return this.state; }

  async evaluate(): Promise<LicenseState> {
    const info = await this.opts.getInfo();
    const next = this.derive(info);
    this.transition(next);
    return next;
  }

  private derive(info: LicenseInfo | null): LicenseState {
    if (info === null) return { kind: 'NO_LICENSE' };
    const expiresMs = new Date(info.expiresAt).getTime();
    if (Number.isNaN(expiresMs) || expiresMs <= Date.now()) return { kind: 'EXPIRED', expiresAt: info.expiresAt };
    if (info.tier === 'trial' || info.status === 'trialing') {
      const daysLeft = Math.max(0, Math.floor((expiresMs - Date.now()) / 86_400_000));
      return { kind: 'TRIALING', tier: info.tier, daysLeft, expiresAt: info.expiresAt };
    }
    return { kind: 'LICENSED', tier: info.tier, expiresAt: info.expiresAt };
  }

  private transition(next: LicenseState): void {
    if (sameState(this.state, next)) return;
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  onStateChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  startRechecking(): void {
    if (this.disposed || this.timer !== null) return;
    this.timer = setInterval(() => { this.evaluate().catch(() => { /* logged elsewhere */ }); }, this.opts.recheckMs);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.listeners = [];
  }
}

function sameState(a: LicenseState, b: LicenseState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'NO_LICENSE' || b.kind === 'NO_LICENSE') return true;
  if (a.kind === 'TRIALING' && b.kind === 'TRIALING') return a.daysLeft === b.daysLeft && a.expiresAt === b.expiresAt;
  if (a.kind === 'LICENSED' && b.kind === 'LICENSED') return a.tier === b.tier && a.expiresAt === b.expiresAt;
  if (a.kind === 'EXPIRED' && b.kind === 'EXPIRED') return a.expiresAt === b.expiresAt;
  return false;
}
