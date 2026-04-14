#!/usr/bin/env node

/**
 * postinstall.ts — Runs after npm install / npm install -g ctxloom.
 *
 * Detects installed MCP clients and offers to configure ContextMesh.
 *
 * This script is intentionally non-invasive:
 *   - It only DETECTS tools, never silently modifies configs
 *   - In CI/CD (detected via env vars), it skips entirely
 *   - It respects the --ignore-scripts flag (npm handles that)
 *   - The user can always re-run with `ctxloom setup`
 */
import { detectInstalledClients } from './clients.js';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

// Skip in CI/CD environments
const CI_ENV_VARS = ['CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'JENKINS_URL', 'TF_BUILD'];
const isCI = CI_ENV_VARS.some(v => process.env[v]);

if (isCI) {
  // Silent exit in CI — no banner, no detection
  process.exit(0);
}

// Skip if stdin is not a TTY (piped install, scripts, etc.)
const isInteractive = process.stdin.isTTY;

console.log('');
console.log(`  ${C.cyan}${C.bold}ContextMesh${C.reset} ${C.dim}installed successfully!${C.reset}`);

const detected = detectInstalledClients();
const unconfigured = detected.filter(d => !d.alreadyConfigured);

if (unconfigured.length > 0) {
  console.log('');
  console.log(`  ${C.green}✓${C.reset} Detected ${C.bold}${unconfigured.length}${C.reset} MCP-compatible tool${unconfigured.length > 1 ? 's' : ''} that ${unconfigured.length > 1 ? 'need' : 'needs'} configuration:`);
  for (const d of unconfigured) {
    console.log(`    ${C.green}•${C.reset} ${d.client.name}`);
  }
  console.log('');
  console.log(`  Run ${C.cyan}ctxloom setup${C.reset} to configure ${unconfigured.length > 1 ? 'them' : 'it'} now.`);
} else if (detected.length > 0) {
  console.log(`  ${C.green}✓${C.reset} All detected MCP tools are already configured.`);
} else {
  console.log(`  ${C.dim}No MCP-compatible AI tools detected.${C.reset}`);
}

console.log('');
console.log(`  Quick start: ${C.cyan}ctxloom index${C.reset} ${C.dim}# Index your project${C.reset}`);
console.log(`  Setup:       ${C.cyan}ctxloom setup${C.reset} ${C.dim}# Configure AI tools${C.reset}`);
console.log('');
