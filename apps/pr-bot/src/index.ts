import type { Probot } from 'probot';
import { onPullRequest } from './handlers/pullRequest.js';
import { onIssueComment } from './handlers/issueComment.js';

export default (app: Probot) => {
  app.on(
    ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
    onPullRequest,
  );
  app.on('issue_comment.created', onIssueComment);
};
