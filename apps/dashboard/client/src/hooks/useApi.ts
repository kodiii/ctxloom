import { useState, useEffect } from 'react';

export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

export function useApi<T>(fetcher: () => Promise<T>): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetcher()
      .then(data => { if (!cancelled) setState({ status: 'success', data }); })
      .catch(err => { if (!cancelled) setState({ status: 'error', message: String(err) }); });
    return () => { cancelled = true; };
  }, []);

  return state;
}
