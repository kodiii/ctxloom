import { execSync } from 'node:child_process';
import { defineConfig } from '@vscode/test-cli';

execSync('node tests/fixtures/build-fake-cli.mjs', { stdio: 'inherit' });

export default defineConfig([
  {
    label: 'integration',
    files: 'out/tests/integration/**/*.test.js',
    workspaceFolder: 'tests/fixtures/workspace-a',
    mocha: { ui: 'tdd', timeout: 20_000 },
  },
  {
    label: 'smoke',
    files: 'out/tests/smoke/**/*.test.js',
    workspaceFolder: 'tests/fixtures/workspace-a',
    mocha: { ui: 'tdd', timeout: 60_000 },
  },
]);
