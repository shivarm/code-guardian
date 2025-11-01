import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import ignore from 'ignore';
import { execSync } from 'child_process';
import chalk from 'chalk';
 

const DEFAULT_CONFIG_FILES = ['.codeguardianrc.json', 'codeguardian.config.json'];

function loadDefaultConfig() {
  const defaultConfigUrl = new URL('../default-config.json', import.meta.url);
  const content = fs.readFileSync(defaultConfigUrl, 'utf8');
  return JSON.parse(content);
}

function loadConfig(configPath) {
  if (configPath) {
    if (!fs.existsSync(configPath)) throw new Error('Config file not found: ' + configPath);
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  // try default files
  for (const f of DEFAULT_CONFIG_FILES) {
    const p = path.resolve(process.cwd(), f);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  // fallback to embedded defaults
  return loadDefaultConfig();
}

function readGitignore() {
  const gitignorePath = path.resolve(process.cwd(), '.gitignore');
  const ig = ignore();
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    ig.add(content);
  }
  // always these file by default
  ig.add('node_modules');
  ig.add('.git');
  ig.add('package-lock.json');
  ig.add('yarn.lock');
  ig.add('pnpm-lock.yaml');
  return ig;
}

function listFiles({ staged, ignoreFiles } = {}) {
  const ig = readGitignore();
  if (Array.isArray(ignoreFiles) && ignoreFiles.length > 0) {
    ig.add(ignoreFiles);
  }

  if (staged) {
    // Use git to list staged files
    try {
      const out = execSync('git diff --name-only --staged', { encoding: 'utf8' });
      const files = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      return files.filter(f => fs.existsSync(f) && !ig.ignores(f));
    } catch (err) {
      throw new Error('Failed to get staged files. Are you in a git repo?');
    }
  }

  // otherwise use fast-glob across repo files (text files)
  const entries = fg.sync(['**/*.*', '**/*'], { dot: true, onlyFiles: true, ignore: ['**/node_modules/**', '**/.git/**'] });
  return entries.filter(e => !ig.ignores(e));
}

function findMatchesInFile(content, rules) {
  const lines = content.split(/\r?\n/);
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of rules) {
      let flags = 'g';
      if (rule.flags) flags = rule.flags;
      let regex;
      try {
        regex = new RegExp(rule.pattern, flags);
      } catch (err) {
        // invalid regex, skip
        continue;
      }
      if (regex.test(line)) {
        findings.push({ rule: rule.name || 'unnamed', lineNumber: i + 1, line: line.trim(), pattern: rule.pattern });
      }
    }
  }
  return findings;
}

async function run({ configPath = null, staged = false, verbose = false } = {}) {
  const config = loadConfig(configPath);
  const rules = config.rules || [];
  const files = listFiles({ staged, ignoreFiles: config.ignoreFiles });

  const findings = [];
  for (const file of files) {
    // small optimization: skip binary-ish files by extension
    const ext = path.extname(file).toLowerCase();
    const skipExt = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.exe', '.dll', '.so'];
    if (skipExt.includes(ext)) continue;
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (verbose) console.warn('skip file', file, err.message);
      continue;
    }
    const fileFindings = findMatchesInFile(content, rules);
    if (fileFindings.length > 0) {
      findings.push({ file, matches: fileFindings });
    }
  }

  // Print nice output
  if (findings.length === 0) {
    console.log(chalk.green('Scan successful but no secrets found in.', process.cwd()));
  } else {
    console.log(chalk.red(`Found ${findings.length} file(s) with potential secrets:`));
    for (const f of findings) {
      console.log(chalk.yellow(`\nFile: ${f.file}`));
      for (const m of f.matches) {
        console.log(`  ${chalk.magenta('Rule:')} ${m.rule} ${chalk.gray(`(line ${m.lineNumber})`)}\n    ${chalk.red(m.line)}`);
      }
    }
  }

  return { findings };
}

export default { run, loadConfig };
