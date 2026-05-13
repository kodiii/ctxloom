import type { Probot } from 'probot';
import { captureError } from '@ctxloom/core';
import { onPullRequest } from './handlers/pullRequest.js';
import { onIssueComment } from './handlers/issueComment.js';
import { onInstallationDeleted } from './handlers/installationDeleted.js';
import { requirePrivateKey } from './auth/installation.js';
import { startEvictionSchedule } from './graph/evictionSchedule.js';

// ---------------------------------------------------------------------------
// Startup security guard: WEBHOOK_SECRET must be set before the app boots.
// Probot will only verify webhook signatures when this env var is present.
// An empty or missing value means webhooks are unauthenticated, which is a
// critical security vulnerability — fail fast rather than run insecurely.
// ---------------------------------------------------------------------------
if (!process.env['WEBHOOK_SECRET'] || process.env['WEBHOOK_SECRET'].trim() === '') {
  // Use process.stderr.write so the message appears even if a logger is not yet initialised.
  process.stderr.write(
    '[pr-bot] FATAL: WEBHOOK_SECRET environment variable is not set. ' +
      'All incoming webhooks would be unauthenticated. Refusing to start.\n',
  );
  process.exit(1);
}

requirePrivateKey();

export default (app: Probot) => {
  // Webhook-level error handler. Probot's @octokit/webhooks emits errors
  // for two distinct failure modes:
  //   1. Signature mismatch (HMAC verification failed) — possible attack,
  //      or a rotated secret. Either way, oncall needs to see this.
  //   2. Handler exceptions — already captured per-handler above, but the
  //      umbrella catch ensures nothing escapes to crash the pod.
  app.webhooks.onError((error) => {
    const inner = (error as { event?: unknown; status?: number } & Error);
    const isSignatureFailure =
      typeof inner.message === 'string' &&
      /signature/i.test(inner.message);
    if (isSignatureFailure) {
      app.log.warn(
        { err: inner.message, status: inner.status },
        'Webhook signature verification failed — check WEBHOOK_SECRET',
      );
    } else {
      app.log.error({ err: inner }, 'Unhandled webhook error');
    }
    captureError(inner, {
      component: 'pr-bot',
      handler: 'webhook',
      signature_failure: isSignatureFailure,
    });
  });

  app.on(
    ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
    onPullRequest,
  );
  app.on('issue_comment.created', onIssueComment);
  app.on('installation.deleted', onInstallationDeleted);

  // Background sweep that removes cache entries older than 7 days
  // (configurable via CTXLOOM_CACHE_MAX_AGE_DAYS / CTXLOOM_CACHE_EVICT_HOURS).
  // Without this the 10 GB Fly volume slowly fills with graphs for PRs
  // whose base SHAs no longer exist.
  startEvictionSchedule(app.log as unknown as import('pino').Logger);
};
