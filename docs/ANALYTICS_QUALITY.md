# Analytics Quality

This update improves analytics privacy, grouping, and reliability. It normalizes paths and IPs, deduplicates request storms, filters noise, and exposes quality/coverage metrics in the admin summary.

## Normalized Fields

New fields written to `analytics.ndjson`:

- `t`: epoch milliseconds
- `pathN`: normalized path (query removed, IDs masked)
- `ipN`: normalized IP (IPv6-mapped to IPv4, ::1 to 127.0.0.1)
- `uaH`: short hash of user-agent

Existing fields (`ts`, `path`, `ip`, `ua`, `referer`) remain for backward compatibility.

## Summary Additions

The admin summary response now includes:

- `summary.quality`:
  - `parsedLines`, `keptLines`, `droppedLines`, `deduped`, `noiseCount`, `privateIpExcluded`
- `summary.coverage`:
  - `earliestTs`, `latestTs`, `spanHours`, `requestedDays`, `mode`, `fromTs`, `toTs`
- `summary.debug` (only when `debug=1`):
  - `topNoisePaths`, `droppedReasons`, `dedupTopKeys` (redacted)

## Window Modes

- `rolling` (default): now minus `days * 24h`
- `calendar`: from UTC start of day, last `days` days

Use `?mode=calendar` to opt in.

## Debug Mode

`GET /api/admin/analytics/summary?days=1&debug=1` returns `summary.debug`.
Debug output never includes raw IPs, tokens, or cookies.

## Environment Variables

| Name | Default | Description |
| --- | --- | --- |
| `ANALYTICS_LOG_PATH` | `data/analytics.ndjson` | Override analytics log path (absolute or relative). |
| `ANALYTICS_DEDUP_WINDOW_MS` | `5000` | Dedup window in ms. |
| `ANALYTICS_DEDUP_MAX_KEYS` | `50000` | Max dedup keys kept in memory. |
| `ANALYTICS_IGNORE_OPTIONS` | `true` | Filter OPTIONS/HEAD as noise. |
| `ANALYTICS_IGNORE_NOISE_PATHS` | `true` | Filter noise paths as noise. |
| `ANALYTICS_NOISE_PATHS` | `/api/health,/api/admin/ping,/favicon.ico,/robots.txt` | Comma-separated noise paths. Supports `*` suffix for prefix match. |
| `ANALYTICS_EXCLUDE_PRIVATE_IPS` | `false` | Exclude private IPs from totals. |
| `ANALYTICS_MAX_LINE_BYTES` | `65536` | Maximum NDJSON line size to parse. |
| `ANALYTICS_WINDOW_MODE` | `rolling` | Default window mode (`rolling` or `calendar`). |

## Example Response (redacted)

```json
{
  "ok": true,
  "data": {
    "days": 1,
    "mode": "rolling",
    "summary": {
      "total": 42,
      "uniqueIps": 7,
      "quality": {
        "parsedLines": 120,
        "keptLines": 42,
        "droppedLines": 2,
        "deduped": 50,
        "noiseCount": 26,
        "privateIpExcluded": 0
      },
      "coverage": {
        "earliestTs": 1710000000000,
        "latestTs": 1710003600000,
        "spanHours": 1,
        "requestedDays": 1,
        "mode": "rolling",
        "fromTs": 1710000000000,
        "toTs": 1710086400000
      }
    },
    "topPaths": [
      { "path": "/api/projects/:id", "count": 10 }
    ]
  }
}
```
