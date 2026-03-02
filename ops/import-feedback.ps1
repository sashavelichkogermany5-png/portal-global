# import-feedback.ps1
# Import feedback from NDJSON fallback file into database
# Usage: pwsh -File ops/import-feedback.ps1

param(
    [string]$DbPath = "C:\Users\user\portal-global\database\portal.db",
    [string]$FeedbackFile = "C:\Users\user\portal-global\data\feedback.ndjson",
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"
$imported = 0
$failed = 0
$errors = @()

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

if (-not (Test-Path $FeedbackFile)) {
    Write-Host "[INFO] No feedback file found at $FeedbackFile" -ForegroundColor Yellow
    exit 0
}

$fileInfo = Get-Item $FeedbackFile
if ($fileInfo.Length -eq 0) {
    Write-Host "[INFO] Feedback file is empty, skipping" -ForegroundColor Yellow
    exit 0
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "FEEDBACK IMPORT" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "File: $FeedbackFile"
Write-Host "Size: $([math]::Round($fileInfo.Length / 1KB, 2)) KB"
Write-Host "DryRun: $DryRun"
Write-Host ""

if ($DryRun) {
    Write-Host "[DRY RUN] Would import:" -ForegroundColor Yellow
}

$lines = Get-Content $FeedbackFile -ErrorAction SilentlyContinue
if (-not $lines) {
    Write-Host "[INFO] No lines to import" -ForegroundColor Green
    exit 0
}

$scriptContent = @"
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const dbPath = process.argv[2];
const dryRun = process.argv[3] === 'true';

const db = new sqlite3.Database(dbPath);

let imported = 0;
let failed = 0;
const errors = [];

db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON", (err) => {
        if (err) {
            console.error("PRAGMA error:", err.message);
            process.exit(1);
        }
    });

    const stmt = db.prepare(`
        INSERT INTO feedback (user_id, tenant_id, message, page, created_at)
        VALUES (?, ?, ?, ?, ?)
    `);

    const lines = fs.readFileSync(0, 'utf8').split('\n').filter(l => l.trim());

    lines.forEach((line, idx) => {
        try {
            const entry = JSON.parse(line);
            const userId = entry.userId || null;
            const tenantId = entry.tenantId || null;
            const message = entry.message || '';
            const page = entry.page || null;
            const ts = entry.ts || new Date().toISOString();

            if (dryRun) {
                console.log(`[DRY] Would insert: userId=${userId}, message=${message.substring(0, 30)}...`);
                imported++;
            } else {
                stmt.run([userId, tenantId, message, page, ts], function(err) {
                    if (err) {
                        console.error(`[ERROR] Line ${idx + 1}:`, err.message);
                        errors.push({ line: idx + 1, error: err.message });
                        failed++;
                    } else {
                        imported++;
                    }
                });
            }
        } catch (e) {
            console.error(`[PARSE ERROR] Line ${idx + 1}:`, e.message);
            errors.push({ line: idx + 1, error: e.message });
            failed++;
        }
    });

    stmt.finalize((err) => {
        if (err) {
            console.error("[FINALIZE ERROR]:", err.message);
        }
        
        console.log(`\n========================================`);
        console.log(`IMPORTED: ${imported}`);
        console.log(`FAILED: ${failed}`);
        
        if (errors.length > 0) {
            console.log(`\nErrors:`);
            errors.forEach(e => console.log(`  Line ${e.line}: ${e.error}`));
        }
        
        db.close();
        
        if (!dryRun && imported > 0 && failed === 0) {
            console.log(`\n[SUCCESS] All records imported`);
        }
    });
});
"@

$tempScript = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.js'
Set-Content -Path $tempScript -Value $scriptContent -Encoding UTF8

try {
    $result = & node $tempScript $DbPath $DryRun 2>&1 | Out-String
    
    if ($DryRun) {
        Write-Host $result -ForegroundColor Yellow
    } else {
        Write-Host $result
    }
    
    if ($result -match "IMPORTED:\s*(\d+)" -and $matches[1] -gt 0 -and $result -notmatch "FAILED:\s*[1-9]") {
        $backupName = "feedback.ndjson.imported.$timestamp"
        $backupPath = Join-Path (Split-Path $FeedbackFile) $backupName
        Move-Item -Path $FeedbackFile -Destination $backupPath -Force
        Write-Host "`n[MOVED] $FeedbackFile -> $backupPath" -ForegroundColor Green
    }
}
finally {
    Remove-Item $tempScript -ErrorAction SilentlyContinue
}

Write-Host "`nDone." -ForegroundColor Cyan
