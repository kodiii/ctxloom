import type { Probot } from 'probot';
import { onPullRequest } from './handlers/pullRequest.js';
import { onIssueComment } from './handlers/issueComment.js';
import { onInstallationDeleted } from './handlers/installationDeleted.js';

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

export default (app: Probot) => {
  app.on(
    ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
    onPullRequest,
  );
  app.on('issue_comment.created', onIssueComment);
  app.on('installation.deleted', onInstallationDeleted);
};
