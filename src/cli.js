#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import scanner from './scanner.js';
import chalk from 'chalk';

const program = new Command();
program
  .name('codeguardian')
  .description('Scan project files for sensitive secrets before you push')
  .option('-c, --config <path>', 'path to config file (JSON). Default: .codeguardianrc.json')
  .option('-s, --staged', 'only scan staged files (git staged)')
  .option('-v, --verbose', 'verbose output')
  .option('--ci', 'CI mode: exit non-zero on findings and produce machine-friendly output')
  .parse(process.argv);

const logo = `

█▀▀ █▀█ █▀▄ █▀▀ █▀▀ █░█ ▄▀█ █▀█ █▀▄ █ ▄▀█ █▄░█
█▄▄ █▄█ █▄▀ ██▄ █▄█ █▄█ █▀█ █▀▄ █▄▀ █ █▀█ █░▀█

`;

console.log(chalk.magenta(logo));

(async () => {
  const opts = program.opts();
  const configPath = opts.config ? path.resolve(process.cwd(), opts.config) : null;
  try {
    const result = await scanner.run({ configPath, staged: !!opts.staged, verbose: !!opts.verbose });
    if (opts.ci) {
      // In CI mode exit with non-zero if any findings
      if (result.findings && result.findings.length > 0) {
        process.exit(2);
      }
    }
    // Normal mode: exit 0 but scanner already wrote to stdout/stderr
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
})();
