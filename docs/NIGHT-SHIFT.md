# NIGHT-SHIFT

## Run
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ops/night-shift.ps1
```

Single-cycle:
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ops/night-shift.ps1 -Once
```

Fresh reset (archive logs + reset work + run one cycle):
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ops/night-shift.ps1 -Fresh
```

Flags:
- `-ResetWork`: set all work items to `pending` and clear progress fields
- `-CleanLogs`: archive `logs/night-shift.json` and `logs/smoke-agent-e2e.json` into `logs/archive/`
- `-Fresh`: equivalent to `-ResetWork -CleanLogs` and runs one cycle

Remote smoke only:
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ops/night-shift.ps1 -Remote -BackendBaseUrl https://api.example.com -WebBaseUrl https://app.example.com
```

## Logs
- `logs/night-shift.json`: PASS/FAIL, exit code, last item, and run history
- `logs/smoke-agent-e2e.json`: latest smoke details

## Resume
- Work items live in `ops/night-shift.work.json`
- To continue, keep statuses as-is and re-run the script
- To re-run an item, set its `status` to `pending`
