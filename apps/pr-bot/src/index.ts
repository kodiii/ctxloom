import type { Probot } from 'probot';

export default (app: Probot) => {
  app.on(
    ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
    async (context) => {
      // placeholder — Task 9 will fill this in
      context.log.info('PR event received', { pr: context.payload.pull_request.number });
    }
  );
  app.on('issue_comment.created', async (context) => {
    // placeholder — Task 10 will fill this in
    context.log.info('Issue comment received');
  });
};
