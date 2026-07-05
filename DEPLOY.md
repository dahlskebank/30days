# Deploy

One-click sync from local `_site/` to a webhotel via lftp + SFTP key auth.
The current setup targets Domeneshop's shared webhotel layout but works against
any SFTP host — only the values in `.env` change.

## Deploy

From any terminal in the project root:

```bash
npm run deploy
```

Runs `npm run build` (Eleventy → html-validate → minify) and then `./deploy.sh _site`,
which `lftp mirror`s the build output to the remote folder, **deleting any remote
files that no longer exist locally**.

### Skip the build

```bash
./deploy.sh _site
```

Useful when you've already built and don't want to regenerate timestamps.

### Preview what would happen (no changes)

```bash
DRY_RUN=1 ./deploy.sh _site
```

Shows every upload + remove that would happen, without touching the server. Use
this whenever you're nervous, especially on a new project before the very first
real deploy.

### From VS Code

`Ctrl+Shift+P` → `Tasks: Run Task` → `Deploy`. Runs `npm run deploy` via Git Bash.

## Files involved

| File | Purpose |
|------|---------|
| `deploy.sh` | The lftp wrapper. Reads `.env`, runs `mirror --reverse --delete --no-perms`. |
| `.env` | Holds `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_REMOTE`, optional `DEPLOY_KEY`. **Gitignored.** |
| `.env.example` | Template, committed. |
| `.npmrc` | `script-shell=...bash.exe` so `npm run deploy` works from cmd/PowerShell on Windows. |
| `.vscode/tasks.json` | VS Code task `Deploy` running via Git Bash. |
| `package.json` | The `deploy` npm script. |
| `~/.ssh/config` | (Optional, this machine only) Per-host `IdentityFile` so direct `ssh user@host` from a terminal also works without `-i`. |

## SSH key (one-time, applies to all projects)

The deploy uses an SSH key. Generate one in Git Bash:

```bash
ssh-keygen -t ed25519 -C "your@email"
# Press Enter through all three prompts (default path, empty passphrase x2)
```

Default location: `~/.ssh/id_ed25519`. If you save it somewhere else (e.g.
`/e/www/your_key`), set `DEPLOY_KEY` in `.env` to that path. **Avoid spaces in
the path** — they break the embedded ssh command in `deploy.sh`.

Copy the public key:

```bash
clip < ~/.ssh/id_ed25519.pub      # adjust path if you saved elsewhere
```

Add it to your hosting account. **For Domeneshop**, the cleanest method is to SSH
in with password once and append manually:

```bash
ssh DEPLOY_USER@DEPLOY_HOST
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "PASTE_THE_PUBLIC_KEY_LINE_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
exit
```

Substitute the actual public key contents on the `echo` line — pasting a
placeholder literally is the most common copy-paste failure.

Test:

```bash
ssh DEPLOY_USER@DEPLOY_HOST 'echo ok'
```

Should print `ok` without prompting for a password.

## Setup checklist for a new project derived from this boilerplate

1. `chmod +x deploy.sh` (Git Bash usually preserves it through copies; redo if needed).
2. Copy `.env.example` to `.env` and fill in per-project values.
3. **Always run a dry-run first** to confirm the path is right:
   ```bash
   DRY_RUN=1 ./deploy.sh _site
   ```
4. Look for any "Removing extra file" / "Removing extra subdirectory" lines that
   surprise you. If there are none, or only files you expect to be removed, the
   real deploy is safe.

## Safety notes

- **`mirror --delete` is destructive.** Sanity-check `DEPLOY_REMOTE` before the
  first deploy on a new project. A typo pointing at the wrong domain folder will
  wipe the wrong site.
- **`deploy.sh` refuses to run if `_site/index.html` is missing.** This catches
  the "build failed silently and `_site/` is empty" disaster, which would
  otherwise wipe the entire live site via `--delete`.
- **Always dry-run before a deploy you're nervous about.** Watch for
  "Removing extra file" / "Removing extra subdirectory" lines that don't match
  what you expect.
- **Never commit `.env`.** It's gitignored, but verify before any first commit
  involving deploy changes.
- **If the SSH key file leaks**, anyone with it gets your SFTP account. Don't
  sync `~/.ssh/` (or wherever your key lives) to cloud storage.
- **Subdomains live in separate folders** on Domeneshop, so deploying the main
  site won't touch e.g. `media.example.com`. (This may differ on other hosts.)

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `lftp: command not found` | Install with `choco install lftp -y` from an admin PowerShell. |
| Asks for password | SSH key not registered server-side, OR `DEPLOY_KEY` points at the wrong file, OR the public key on the server is corrupted (line breaks, placeholder pasted literally). |
| Connection hangs, then works on retry | Some hosts briefly throttle repeated SFTP connections. Just retry. |
| `chmod -f 750` lines in output | `--no-perms` got dropped from `deploy.sh` somehow — files would be served as 750 and Apache may 403 them. |
| `DEPLOY_HOST contains invalid characters` | Quotes or unexpected chars in `.env`. The script's allowlist rejects values that could break out of the lftp heredoc. |
| `index.html missing — refusing to deploy` | The build did not produce `_site/index.html`. Inspect the build output before retrying. |
| `another deploy is already running` | A `flock` on `.deploy.lock` is held by another shell. If nothing is actually running, `rm .deploy.lock`. |
| `DEPLOY_HOST not set in .env` | Running outside the project root, or `.env` is missing. |
| Files uploaded but missing on the live site | `DEPLOY_REMOTE` pointing at a non-public subfolder. |
