import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { findUnusedModules } from './unusedModuleDetector.js';

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
  const startTime = process.hrtime.bigint();
  const startMem = process.memoryUsage().heapUsed;

  const config = loadConfig(configPath);
  const rules = config.rules || [];
  const files = listFiles({ staged, ignoreFiles: config.ignoreFiles });

  const findings = [];
  let filesScanned = 0;
  // For unused module detection
  const jsTsFiles = [];
  const importMap = new Map(); // file -> [imported files]
  const allFilesSet = new Set();

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
    filesScanned++;
    const fileFindings = findMatchesInFile(content, rules);
    if (fileFindings.length > 0) {
      findings.push({ file, matches: fileFindings });
    }

    // Collect JS/TS files for unused module detection and unused import detection
    if ([".js", ".ts"].includes(ext) && !file.includes(".test") && !file.includes("spec") && !file.includes("config") && !file.includes("setup")) {
      jsTsFiles.push(file);
      allFilesSet.add(path.resolve(file));
      // Parse imports/requires
      const imports = [];
      // ES imports (capture imported identifiers)
      const esImportRegex = /import\s+((?:[\w*{},\s]+)?)\s*from\s*["']([^"']+)["']/g;
      let match;
      const importDetails = [];
      while ((match = esImportRegex.exec(content))) {
        const imported = match[1].trim();
        const source = match[2];
        // Parse imported identifiers
        let identifiers = [];
        if (imported.startsWith("* as ")) {
          identifiers.push(imported.replace("* as ", "").trim());
        } else if (imported.startsWith("{")) {
          // Named imports
          identifiers = imported.replace(/[{}]/g, "").split(",").map(s => s.trim().split(" as ")[0]).filter(Boolean);
        } else if (imported) {
          identifiers.push(imported.split(",")[0].trim());
        }
        importDetails.push({ source, identifiers });
        imports.push(source);
      }
      // CommonJS requires (variable assignment)
      const requireVarRegex = /(?:const|let|var)\s+([\w{}*,\s]+)\s*=\s*require\(["']([^"']+)["']\)/g;
      while ((match = requireVarRegex.exec(content))) {
        const imported = match[1].trim();
        const source = match[2];
        let identifiers = [];
        if (imported.startsWith("{")) {
          identifiers = imported.replace(/[{}]/g, "").split(",").map(s => s.trim());
        } else if (imported) {
          identifiers.push(imported.split(",")[0].trim());
        }
        importDetails.push({ source, identifiers });
        imports.push(source);
      }
      // Bare require (no variable assignment)
      const requireRegex = /require\(["']([^"']+)["']\)/g;
      while ((match = requireRegex.exec(content))) {
        imports.push(match[1]);
      }
      importMap.set(path.resolve(file), imports);
      // Unused import detection
      // For each imported identifier, check if it's used in the file
      const unusedImports = [];
      for (const imp of importDetails) {
        for (const id of imp.identifiers) {
          // Simple usage check: look for identifier in code (excluding import line)
          const usageRegex = new RegExp(`\\b${id.replace(/[$()*+.?^{}|\\]/g, "\\$&")}\\b`, "g");
          // Remove import lines
          const codeWithoutImports = content.replace(esImportRegex, "").replace(requireVarRegex, "");
          const usageCount = (codeWithoutImports.match(usageRegex) || []).length;
          if (usageCount === 0) {
            unusedImports.push(id);
          }
        }
      }
      if (unusedImports.length > 0) {
        console.log(chalk.yellowBright(`\nWarning: Unused imports in ${file}:`));
        for (const id of unusedImports) {
          console.log(chalk.yellow(`  ${id}`));
        }
        console.log(chalk.gray('These imports are present but never used in this file.'));
      }
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

  // Unused JS/TS module detection (warn only)
  const unused = findUnusedModules(jsTsFiles, importMap);
  if (unused.length > 0) {
    console.log(chalk.yellowBright(`\nWarning: Unused modules detected (not imported by any other file):`));
    for (const f of unused) {
      console.log(chalk.yellow(`  ${f}`));
    }
    console.log(chalk.gray('These files are not blocking CI, but consider cleaning up unused modules.'));
  }

  const endTime = process.hrtime.bigint();
  const endMem = process.memoryUsage().heapUsed;
  const durationMs = Number(endTime - startTime) / 1e6;
  const memMB = (endMem - startMem) / 1024 / 1024;
  console.log(chalk.cyanBright(`\nScan stats:`));
  console.log(chalk.cyan(`  Files scanned: ${filesScanned}`));
  console.log(chalk.cyan(`  Time taken: ${durationMs.toFixed(1)} ms`));
  console.log(chalk.cyan(`  Memory used: ${memMB.toFixed(2)} MB`));

  return { findings };
}

export default { run, loadConfig };
