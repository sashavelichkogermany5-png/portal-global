# AGENTS.md — rules for OpenCode/Cursor/Copilot agents

## Goal
Small safe changes. Keep compatibility. Prefer minimal diffs.

## Hard rules
- Do NOT change architecture unless explicitly asked.
- Keep auth compatible: token + cookie (do not break existing clients).
- Tenant isolation is mandatory: tenantId from auth/session; never trust tenantId in body.
- After changes: run health check and report results.
- Always list changed files.

## Quick agent prompt (paste into OpenCode)
You are an engineering agent working in the portal-global repository.
Rules:
- Do not change architecture unless asked.
- Keep auth compatible: token + cookie.
- Enforce tenant scoping for all data access.
- Provide dev/prod scripts, health checks, and safe ops utilities.
- After edits: run npm run health and summarize what changed.
Deliver minimal diffs, explain why, list changed files.
