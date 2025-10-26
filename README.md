# CodeGuardian — Sensitive Data Scanner

A small Node.js CLI that scans your repository for commonly leaked secrets before you push.

Features
- CLI scanner using configurable regex rules
- Sample Husky pre-commit hook
- Optional CI mode (exit non-zero when findings are present)

Quick start
1. Install dependencies:

```bash
npm install
```

2. (Optional) Install husky hooks (manual steps)

Note: this project no longer runs `husky install` automatically during `npm install` — the `prepare` script was removed to avoid install-time failures on machines that don't have Husky installed. If you want local pre-commit hooks, install and enable Husky manually:

```bash
# install husky as a dev dependency
npm install --save-dev husky

# install husky hooks into .husky/
npx husky install

# add a pre-commit hook that runs CodeGuardian on staged files and fails the commit
npx husky add .husky/pre-commit "npx codeguardian --staged --ci"
```

3. Run the scanner on the repo:

```bash
npx codeguardian
```

Config
Drop a `.codeguardianrc.json` in the repo with the following shape:

```json
{
  "rules": [
    { "name": "Example", "pattern": "AKIA[0-9A-Z]{16}", "flags": "g" }
  ]
}
```

You can also add an `ignoreFiles` array of globs or paths to skip scanning noisy files (for example lockfiles or build outputs). Example `.codeguardianrc.json`:

```json
{
  "ignoreFiles": [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "dist/**",
    "node_modules/**"
  ],
  "rules": [
    { "name": "AWS Access Key ID", "pattern": "AKIA[0-9A-Z]{16}", "flags": "g" },
    { "name": "Simple API key assignment", "pattern": "api_key\\s*[=:\\s]\\s*([A-Za-z0-9_\\-]{8,})", "flags": "gi" }
  ]
}
```

To run the scanner with a custom config file use `--config`:

```bash
npx codeguardian --config .codeguardianrc.json
```

CI Integration
Run `npx codeguardian --ci` in your CI pipeline and fail the build if any findings are present.

Notes
Notes
- The default ruleset (in `default-config.json`) is a starting point — tune it for your project to reduce false positives.
- The scanner respects `.gitignore` and ignores `node_modules` and `.git` by default. Additionally, CodeGuardian now ignores common lockfiles by default (e.g. `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) to reduce noisy matches from integrity/hash lines.

If you want to ignore additional files from scanning (beyond `.gitignore` and the default lockfiles), add them to your `.codeguardianrc.json`.
