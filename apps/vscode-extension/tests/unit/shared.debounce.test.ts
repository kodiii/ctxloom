import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../../src/shared/debounce.js';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces multiple rapid calls into a single trailing invocation', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a'); d('b'); d('c');
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('schedules a fresh trailing invocation after the delay elapses', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('first'); vi.advanceTimersByTime(101);
    d('second'); vi.advanceTimersByTime(101);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'first');
    expect(fn).toHaveBeenNthCalledWith(2, 'second');
  });

  it('cancel() prevents the pending invocation', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('x');
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it('flush() invokes immediately with the latest args', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('x'); d('y');
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('y');
  });
});
