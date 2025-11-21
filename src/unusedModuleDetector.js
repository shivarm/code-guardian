// Unused module detection logic for CodeGuardian
// Scans for JS/TS files not imported by any other file

import { access } from 'node:fs/promises';
import path from 'node:path';


export async function findUnusedModules (jsTsFiles, importMap) {
  // Build set of all imported files (resolved to absolute)
  const importedSet = new Set();
  for (const [file, imports] of importMap.entries()) {
    for (const imp of imports) {
      if (imp.startsWith("./") || imp.startsWith("../")) {
        let resolved;
        const candidates = [
          path.resolve(path.dirname(file), imp),
          path.resolve(path.dirname(file), imp + ".js"),
          path.resolve(path.dirname(file), imp + ".ts")
        ];
        for (const candidate of candidates) {
          try {
            await access(candidate);
            resolved = candidate;
            break;
          } catch {}
        }
        if (resolved) importedSet.add(resolved);
      }
    }
  }
  // Entry points: index.js/ts, cli.js/ts, main.js/ts
  const entryRegex = /\b(index|cli|main)\.(js|ts)\b/i;
  const unused = [];
  for (const file of jsTsFiles) {
    const abs = path.resolve(file);
    if (!importedSet.has(abs) && !entryRegex.test(path.basename(file))) {
      unused.push(file);
    }
  }
  return unused;
}
