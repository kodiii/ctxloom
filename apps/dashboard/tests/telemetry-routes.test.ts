import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildTelemetryRouter } from '../server/routes/telemetry.js';

vi.mock('@ctxloom/core', () => ({
  track: vi.fn(),
  captureError: vi.fn(),
}));

import { track, captureError } from '@ctxloom/core';

describe('telemetry routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use('/api/telemetry', buildTelemetryRouter());
  });

  describe('GET /identity', () => {
    afterEach(() => {
      delete process.env.CTXLOOM_NO_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
    });

    it('returns enabled: true by default', async () => {
      delete process.env.CTXLOOM_NO_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      const res = await request(app).get('/api/telemetry/identity');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: true });
    });

    it('returns enabled: false when CTXLOOM_NO_TELEMETRY=1', async () => {
      process.env.CTXLOOM_NO_TELEMETRY = '1';
      const res = await request(app).get('/api/telemetry/identity');
      expect(res.body).toEqual({ enabled: false });
    });

    it('returns enabled: false when DO_NOT_TRACK=1', async () => {
      process.env.DO_NOT_TRACK = '1';
      const res = await request(app).get('/api/telemetry/identity');
      expect(res.body).toEqual({ enabled: false });
    });
  });

  describe('POST /event', () => {
    it('accepts dashboard_loaded and forwards to core.track with surface=dashboard', async () => {
      const res = await request(app)
        .post('/api/telemetry/event')
        .send({ event: 'dashboard_loaded', props: {} });
      expect(res.status).toBe(204);
      expect(track).toHaveBeenCalledWith('dashboard_loaded', { surface: 'dashboard' });
    });

    it('accepts dashboard_page_viewed with path prop', async () => {
      await request(app)
        .post('/api/telemetry/event')
        .send({ event: 'dashboard_page_viewed', props: { path: '/graph' } });
      expect(track).toHaveBeenCalledWith('dashboard_page_viewed', {
        path: '/graph',
        surface: 'dashboard',
      });
    });

    it('rejects unknown event names with 400', async () => {
      const res = await request(app)
        .post('/api/telemetry/event')
        .send({ event: 'license_revoked' });
      expect(res.status).toBe(400);
      expect(track).not.toHaveBeenCalled();
    });

    it('rejects missing event field with 400', async () => {
      const res = await request(app).post('/api/telemetry/event').send({});
      expect(res.status).toBe(400);
    });

    it('discards array props and substitutes {}', async () => {
      await request(app)
        .post('/api/telemetry/event')
        .send({ event: 'dashboard_loaded', props: [] });
      expect(track).toHaveBeenCalledWith('dashboard_loaded', { surface: 'dashboard' });
    });
  });

  describe('POST /error', () => {
    it('forwards a valid message + stack to core.captureError with surface=dashboard', async () => {
      const res = await request(app)
        .post('/api/telemetry/error')
        .send({ message: 'render failure', stack: 'Error: render failure\n    at Foo', context: { route: '/graph' } });
      expect(res.status).toBe(204);
      expect(captureError).toHaveBeenCalledTimes(1);
      const [err, ctx] = (captureError as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('render failure');
      expect(ctx).toEqual({ route: '/graph', surface: 'dashboard' });
    });

    it('rejects empty message with 400', async () => {
      const res = await request(app).post('/api/telemetry/error').send({ message: '' });
      expect(res.status).toBe(400);
      expect(captureError).not.toHaveBeenCalled();
    });

    it('rejects message over 2000 chars with 400', async () => {
      const res = await request(app)
        .post('/api/telemetry/error')
        .send({ message: 'x'.repeat(2001) });
      expect(res.status).toBe(400);
    });

    it('drops stack over 10000 chars but still forwards the error', async () => {
      const res = await request(app)
        .post('/api/telemetry/error')
        .send({ message: 'ok', stack: 'x'.repeat(10001) });
      expect(res.status).toBe(204);
      const [err] = (captureError as ReturnType<typeof vi.fn>).mock.calls[0];
      // Stack should NOT be the oversize one — default Node stack remains.
      expect((err as Error).stack).not.toBe('x'.repeat(10001));
    });
  });
});
