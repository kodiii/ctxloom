import { Router, json } from 'express';
import { track, captureError } from '@ctxloom/core';

// Allowlist for events that the browser is permitted to fire via /event.
// Intentionally smaller than the full TelemetryEvent union — the browser
// must NOT be able to forge license_* or project_* events.
const DASHBOARD_EVENT_ALLOWLIST = new Set<'dashboard_loaded' | 'dashboard_page_viewed'>([
  'dashboard_loaded',
  'dashboard_page_viewed',
]);

const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 10000;

export function buildTelemetryRouter(): Router {
  const router = Router();

  router.get('/identity', (_req, res) => {
    const disabled =
      process.env.CTXLOOM_NO_TELEMETRY === '1' ||
      process.env.DO_NOT_TRACK === '1';
    res.json({ enabled: !disabled });
  });

  router.post('/event', json(), (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const event = body?.event;
    if (typeof event !== 'string' || !DASHBOARD_EVENT_ALLOWLIST.has(event as 'dashboard_loaded' | 'dashboard_page_viewed')) {
      res.status(400).json({ error: 'invalid event' });
      return;
    }
    const rawProps = body?.props;
    const sanitizedProps =
      rawProps && typeof rawProps === 'object' && !Array.isArray(rawProps)
        ? (rawProps as Record<string, unknown>)
        : {};
    track(event as 'dashboard_loaded' | 'dashboard_page_viewed', {
      ...sanitizedProps,
      surface: 'dashboard',
    });
    res.status(204).end();
  });

  router.post('/error', json(), (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const message = body?.message;
    if (typeof message !== 'string' || message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: 'invalid message' });
      return;
    }
    const stack = body?.stack;
    const err = new Error(message);
    if (typeof stack === 'string' && stack.length > 0 && stack.length <= MAX_STACK_LENGTH) {
      err.stack = stack;
    }
    const rawContext = body?.context;
    const sanitizedContext =
      rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)
        ? (rawContext as Record<string, unknown>)
        : {};
    captureError(err, { ...sanitizedContext, surface: 'dashboard' });
    res.status(204).end();
  });

  return router;
}
