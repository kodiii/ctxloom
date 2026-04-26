export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel(): void;
  flush(): void;
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, waitMs: number): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  const debounced = ((...args: Args) => {
    pendingArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = pendingArgs;
      pendingArgs = null;
      if (a !== null) fn(...a);
    }, waitMs);
  }) as Debounced<Args>;

  debounced.cancel = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    pendingArgs = null;
  };

  debounced.flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const a = pendingArgs;
    pendingArgs = null;
    if (a !== null) fn(...a);
  };

  return debounced;
}
