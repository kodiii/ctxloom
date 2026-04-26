import { EventEmitter } from 'node:events';

export interface ServerLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface ServerClient extends EventEmitter {
  callTool(args: { name: string; arguments: Record<string, unknown> }): Promise<{ content: unknown }>;
  close(): Promise<void>;
}

export interface ServerManagerOptions {
  spawner: () => Promise<ServerClient>;
  logger: ServerLogger;
  /** Override the 60s window for test purposes. */
  restartWindowMs?: number;
  /** Override the max restart attempts within the window. */
  maxRestartsPerWindow?: number;
  /** Override the 10s tool-call timeout. */
  toolCallTimeoutMs?: number;
  /** Override the 30s stable-uptime threshold for resetting restart counter. */
  stableResetMs?: number;
}

export class ServerManager {
  private client: ServerClient | null = null;
  private restartTimes: number[] = [];
  private disposed = false;
  private available = false;
  private lastSpawnAt = 0;

  private readonly restartWindowMs: number;
  private readonly maxRestarts: number;
  private readonly toolCallTimeoutMs: number;
  private readonly stableResetMs: number;

  constructor(private readonly opts: ServerManagerOptions) {
    this.restartWindowMs = opts.restartWindowMs ?? 60_000;
    this.maxRestarts = opts.maxRestartsPerWindow ?? 3;
    this.toolCallTimeoutMs = opts.toolCallTimeoutMs ?? 10_000;
    this.stableResetMs = opts.stableResetMs ?? 30_000;
  }

  isAvailable(): boolean { return this.available && !this.disposed; }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('ServerManager disposed');
    await this.spawnAndAttach();
  }

  private async spawnAndAttach(): Promise<void> {
    this.client = await this.opts.spawner();
    this.lastSpawnAt = Date.now();
    this.available = true;
    this.client.on('error', (err: Error) => this.handleCrash(err));
    this.client.on('close', () => this.handleCrash(new Error('client closed unexpectedly')));
    this.opts.logger.info('ctxloom server spawned');
  }

  private handleCrash(err: Error): void {
    if (this.disposed) return;
    this.available = false;
    const stableFor = Date.now() - this.lastSpawnAt;
    if (stableFor >= this.stableResetMs) {
      // Stable run before this crash — counter resets so we don't punish past flakes.
      this.restartTimes = [];
    }
    this.opts.logger.warn(`server crashed: ${err.message}`);
    this.attemptRestart();
  }

  private attemptRestart(): void {
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter(t => now - t < this.restartWindowMs);
    if (this.restartTimes.length >= this.maxRestarts) {
      this.opts.logger.error(`ctxloom unavailable — ${this.restartTimes.length} restarts in ${this.restartWindowMs / 1000}s`);
      return;
    }
    this.restartTimes.push(now);
    this.opts.logger.info(`restarting ctxloom (attempt ${this.restartTimes.length} / ${this.maxRestarts})`);
    this.spawnAndAttach().catch(err => this.opts.logger.error(`spawn failed: ${String(err)}`));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown }> {
    if (this.disposed) throw new Error('ServerManager disposed');
    if (!this.client || !this.available) throw new Error('ctxloom server unavailable');
    const promise = this.client.callTool({ name, arguments: args });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`tool call timeout: ${name}`)), this.toolCallTimeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.available = false;
    if (this.client) {
      try { await this.client.close(); }
      catch (err) { this.opts.logger.warn(`close failed: ${String(err)}`); }
      this.client = null;
    }
  }
}
