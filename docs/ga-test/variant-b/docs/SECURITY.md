# Short summary
- Security policy and vuln reporting guidance.
- Known issue: sqlite3 pulls tar advisory during install only.
- Mitigation: monitor sqlite3 releases.
- Audits run periodically; last reviewed 2026-03-02.
# Security Policy

## Reporting a Vulnerability
If you believe you have found a security issue, please avoid public disclosure and
contact the maintainers privately with details and reproduction steps.

## Known Issues
### tar vulnerabilities via sqlite3 (install-time only)
- The project uses `sqlite3`, which pulls in `tar@6.x` transitively.
- These advisories are triggered during install/build of native modules, not at runtime.
- Impact: no known runtime exploit path in the application itself.
- Mitigation: monitor `sqlite3` releases; upgrade when the dependency chain updates.

## Audits
- Dependency audits are run periodically with `npm audit`.
- Last reviewed: 2026-03-02.
