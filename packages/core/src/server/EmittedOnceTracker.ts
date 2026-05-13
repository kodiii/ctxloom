export class EmittedOnceTracker {
  private readonly seen = new Set<string>();

  /** Returns true the first time `key` is seen, false thereafter. */
  markAndCheck(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  /** Clear all keys. Used by tests. */
  reset(): void {
    this.seen.clear();
  }
}
