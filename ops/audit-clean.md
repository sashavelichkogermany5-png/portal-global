# Audit Clean Script

Purpose
- Safe cleanup for empty files/dirs and known junk.
- Build artifacts are removed only if gitignored.
- Produces a report and manifest under logs/audit-clean.

Usage
- Dry-run (default):
  - `powershell -ExecutionPolicy Bypass -File ops/audit-clean.ps1`
- Apply deletions:
  - `powershell -ExecutionPolicy Bypass -File ops/audit-clean.ps1 -Apply`

Options
- `-RepoRoot` (default: current directory)
  - Example: `-RepoRoot C:\path\to\portal-global`
- `-Apply`
  - Perform deletions. If omitted, runs in dry-run mode.
- `-KeepLogs`
  - Skip log deletion (keeps `*.log`, `npm-debug.log*`, `yarn-error.log`, `pnpm-debug.log`).
- `-VerboseReport`
  - Print full lists in the report and console output.

What gets removed
- Empty files (0 bytes).
- Empty directories.
- Junk files:
  - `.DS_Store`, `Thumbs.db`
  - `*.tmp`, `*.bak`, `*.old`, `*.swp`, `*.swo`
  - `*.log`, `npm-debug.log*`, `yarn-error.log`, `pnpm-debug.log` (unless `-KeepLogs`)
- Build artifacts only when gitignored:
  - `.next`, `dist`, `build`, `out`, `coverage`, `.turbo`, `.cache`, `tmp`, `temp`
- Placeholder-only folders (folders containing only `.gitkeep`, `.keep`, `.placeholder`, `.empty`, `.emptydir`, `placeholder.txt`).

Safety guards
- Never touches `node_modules`.
- Never touches `data`, `database`, or `db` paths (any depth).
- Never deletes database file extensions: `.db`, `.sqlite`, `.sqlite3` (and wal/shm variants).
- Never deletes logs/audit-clean outputs.

Outputs
- `logs/audit-clean/manifest.json`
- `logs/audit-clean/report.md`

Post-apply checks
When `-Apply` is used, the script runs (if present in package.json):
- `npm run health`
- `npm run test`
- `npm run lint`
- `npm run build`

Notes
- Build artifact detection uses `git check-ignore`. If git is not available, build artifact deletion is skipped.
- The report includes a top-level tree summary, entrypoints/ports, deletions by category, warnings, and check results.
- Duplicate hash scanning is capped by default (max 2000 files total, 200 per size group) and the report lists the first 20 groups unless `-VerboseReport` is set.
