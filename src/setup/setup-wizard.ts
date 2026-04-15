/**
 * setup-wizard.ts — Interactive setup wizard for ctxloom.
 *
 * Detects installed MCP clients and guides the user through
 * configuring ctxloom for each one.
 *
 * Can be run via:
 *   - `ctxloom setup` (CLI command)
 *   - `npm postinstall` hook (first-time install)
 *
 * The wizard will:
 *   1. Scan for installed MCP clients
 *   2. Show which ones were detected
 *   3. Ask which ones to configure
 *   4. Write MCP config entries for each selected client
 *   5. Report results
 */
import { detectInstalledClients, addCtxloomToConfig, type DetectedClient } from './clients.js';
import { createInterface } from 'node:readline';

// ─── ANSI Colors ───────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

// ─── Readline helper ──────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Banner ───────────────────────────────────────────────────

function printBanner(): void {
  console.log('');
  console.log(`${C.cyan}${C.bold}  ╔══════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ║        ctxloom — Setup Wizard               ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ║     The Universal Code Context Engine       ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ╚══════════════════════════════════════════════╝${C.reset}`);
  console.log('');
  console.log(`  ${C.dim}Scanning your system for MCP-compatible AI tools...${C.reset}`);
  console.log('');
}

// ─── Status icons ─────────────────────────────────────────────

const ICON_DETECTED = `${C.green}✓${C.reset}`;
const ICON_ALREADY = `${C.yellow}●${C.reset}`;
const ICON_NOT_FOUND = `${C.dim}○${C.reset}`;
const ICON_SUCCESS = `${C.green}✓${C.reset}`;
const ICON_FAIL = `${C.red}✗${C.reset}`;
const ICON_SKIP = `${C.dim}—${C.reset}`;

// ─── Main wizard ──────────────────────────────────────────────

export async function runSetupWizard(options?: { nonInteractive?: boolean }): Promise<void> {
  printBanner();

  const detected = detectInstalledClients();

  if (detected.length === 0) {
    console.log(`  ${ICON_NOT_FOUND} ${C.dim}No MCP-compatible AI tools detected on your system.${C.reset}`);
    console.log('');
    console.log(`  You can manually add ctxloom to any MCP client using this config:`);
    console.log('');
    console.log(`  ${C.cyan}{${C.reset}`);
    console.log(`  ${C.cyan}  "mcpServers": {${C.reset}`);
    console.log(`  ${C.cyan}    "ctxloom": {${C.reset}`);
    console.log(`  ${C.cyan}      "command": "npx",${C.reset}`);
    console.log(`  ${C.cyan}      "args": ["-y", "ctxloom"]${C.reset}`);
    console.log(`  ${C.cyan}    }${C.reset}`);
    console.log(`  ${C.cyan}  }${C.reset}`);
    console.log(`  ${C.cyan}}${C.reset}`);
    console.log('');
    return;
  }

  // Display detected clients
  console.log(`  ${C.bold}Detected MCP-compatible tools:${C.reset}`);
  console.log('');

  const alreadyConfigured: DetectedClient[] = [];
  const needsConfig: DetectedClient[] = [];

  for (const d of detected) {
    if (d.alreadyConfigured) {
      alreadyConfigured.push(d);
      console.log(`  ${ICON_ALREADY} ${C.yellow}${d.client.name}${C.reset} ${C.dim}— already configured${C.reset}`);
      console.log(`    ${C.dim}${d.configPath}${C.reset}`);
    } else {
      needsConfig.push(d);
      console.log(`  ${ICON_DETECTED} ${C.green}${d.client.name}${C.reset} ${C.dim}— ${d.client.description}${C.reset}`);
      console.log(`    ${C.dim}Config: ${d.configPath}${d.configExists ? '' : ' (will be created)'}${C.reset}`);
    }
  }

  console.log('');

  if (needsConfig.length === 0) {
    console.log(`  ${C.green}${C.bold}All detected tools are already configured!${C.reset}`);
    console.log('');
    console.log(`  Run ${C.cyan}ctxloom index${C.reset} to index your project, then start coding.`);
    console.log('');
    return;
  }

  // Non-interactive mode: auto-configure all unconfigured tools
  if (options?.nonInteractive) {
    console.log(`  ${C.bold}Auto-configuring all detected tools...${C.reset}`);
    console.log('');
    for (const d of needsConfig) {
      const result = addCtxloomToConfig(d);
      if (result.success) {
        console.log(`  ${ICON_SUCCESS} ${result.message}`);
      } else {
        console.log(`  ${ICON_FAIL} ${result.message}`);
      }
    }
    console.log('');
    printNextSteps();
    return;
  }

  // Interactive mode: ask which tools to configure
  console.log(`  ${C.bold}Which tools would you like to configure?${C.reset}`);
  console.log('');
  for (let i = 0; i < needsConfig.length; i++) {
    console.log(`    ${C.cyan}${i + 1}.${C.reset} ${needsConfig[i].client.name}`);
  }
  console.log(`    ${C.cyan}a.${C.reset} All of the above`);
  console.log(`    ${C.cyan}s.${C.reset} Skip setup`);
  console.log('');

  const answer = await ask(`  Enter choices (comma-separated, e.g. "1,3" or "a"): `);

  if (answer.toLowerCase() === 's' || answer === '') {
    console.log('');
    console.log(`  ${ICON_SKIP} Setup skipped. Run ${C.cyan}ctxloom setup${C.reset} anytime to configure later.`);
    console.log('');
    return;
  }

  const toConfigure: DetectedClient[] = [];

  if (answer.toLowerCase() === 'a') {
    toConfigure.push(...needsConfig);
  } else {
    const indices = answer
      .split(',')
      .map(s => parseInt(s.trim(), 10) - 1)
      .filter(i => i >= 0 && i < needsConfig.length);
    for (const i of indices) {
      toConfigure.push(needsConfig[i]);
    }
  }

  if (toConfigure.length === 0) {
    console.log('');
    console.log(`  ${ICON_SKIP} No tools selected. Run ${C.cyan}ctxloom setup${C.reset} anytime to configure later.`);
    console.log('');
    return;
  }

  console.log('');
  console.log(`  ${C.bold}Configuring ctxloom...${C.reset}`);
  console.log('');

  let successCount = 0;
  let failCount = 0;

  for (const d of toConfigure) {
    const result = addCtxloomToConfig(d);
    if (result.success) {
      successCount++;
      console.log(`  ${ICON_SUCCESS} ${result.message}`);
    } else {
      failCount++;
      console.log(`  ${ICON_FAIL} ${result.message}`);
    }
  }

  console.log('');

  if (successCount > 0) {
    console.log(`  ${C.green}${C.bold}ctxloom configured successfully!${C.reset} (${successCount} tool${successCount > 1 ? 's' : ''})`);
  }
  if (failCount > 0) {
    console.log(`  ${C.red}${failCount} tool${failCount > 1 ? 's' : ''} failed — see errors above.${C.reset}`);
  }

  console.log('');
  printNextSteps();
}

function printNextSteps(): void {
  console.log(`  ${C.bold}Next steps:${C.reset}`);
  console.log('');
  console.log(`  1. ${C.cyan}cd /path/to/your/project${C.reset}`);
  console.log(`  2. ${C.cyan}ctxloom index${C.reset}    ${C.dim}# Index your codebase${C.reset}`);
  console.log(`  3. ${C.dim}Open your AI tool and start coding — ctxloom provides context automatically${C.reset}`);
  console.log('');
  console.log(`  ${C.dim}Documentation: https://ctxloom.dev/docs${C.reset}`);
  console.log('');
}
