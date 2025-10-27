# CodeGuardian — Sensitive Data Scanner

Lightweight CLI to scan repositories for accidentally committed secrets (API keys, tokens, private keys). This short guide starts with how to use CodeGuardian in your project, how to integrate it into CI, and then explains the feature set and configuration.

## How developers use CodeGuardian.

---

Installation (two quick ways):

- Run directly with npx (no install required):

```bash
npx @shivam-sharma/codeguardian
```

- Install as a dev dependency (recommended for team projects):

```bash
npm install --save-dev @shivam-sharma/codeguardian
```

Basic commands:

- Scan entire repository:

```bash
npx codeguardian
```

- Scan only staged files (fast; good for pre-commit hooks):

```bash
npx codeguardian --staged
```

- CI mode (exit non-zero on findings):

```bash
npx codeguardian --ci
```

Custom config (optional):

```bash
npx codeguardian --config .codeguardianrc.json
```

## How to integrate with CI (GitHub Actions).

---

Use the built-in workflow `.github/workflows/codeguardian.yml` or add a step to your pipeline to run the scanner in CI mode. Example snippet:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  scan:
    name: Run CodeGuardian
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v5

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: "npm"

      - name: Install dependencies
        run: npm install

      - name: Run CodeGuardian scanner (CI mode)
        run: npx codeguardian --ci
```

When run with `--ci` the CLI exits with a non-zero code if any findings are detected — this will fail the job and block merges until issues are resolved.

## What CodeGuardian offers

---

- Rule-based scanning: configure regex rules (name, pattern, flags) to detect secrets.
- `ignoreFiles`: glob list to skip noisy files (lockfiles, build artifacts).
- Staged-file scanning: run only what will be committed (fast pre-commit checks).
- Husky integration: optional pre-commit hooks to block commits locally.
- CI-ready: `--ci` mode for failing pipelines on findings.

## Developer guide & advanced configuration

---

## CLI options

- `-c, --config <path>` — path to JSON config file (default: `.codeguardianrc.json`)
- `-s, --staged` — only scan staged files
- `--ci` — CI mode: exit non-zero when findings exist
- `-v, --verbose` — verbose output

## Config file (`.codeguardianrc.json`)

Minimal shape:

```json
{
  "ignoreFiles": ["package-lock.json", "yarn.lock", "dist/**"],
  "rules": [{ "name": "AWS Access Key ID", "pattern": "AKIA[0-9A-Z]{16}", "flags": "g" }]
}
```

Rules are JavaScript regular expressions expressed as strings. `flags` is optional (for example `gi`). The scanner will try to compile each rule. invalid patterns are skipped.
