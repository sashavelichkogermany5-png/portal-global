[CmdletBinding()]
param(
    [string]$RepoRoot = (Get-Location).Path,
    [switch]$Apply,
    [switch]$KeepLogs,
    [switch]$VerboseReport
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot([string]$path) {
    if (-not $path) {
        throw 'RepoRoot is required.'
    }
    $resolved = Resolve-Path -LiteralPath $path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Container)) {
        throw "RepoRoot is not a directory: $path"
    }
    return $resolved.Path
}

$RepoRoot = Resolve-RepoRoot $RepoRoot

$runId = [Guid]::NewGuid().ToString()
$timestamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
$modeLabel = if ($Apply) { 'APPLY' } else { 'DRY-RUN' }

$logsRoot = Join-Path $RepoRoot 'logs\audit-clean'
New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
$manifestPath = Join-Path $logsRoot 'manifest.json'
$reportPath = Join-Path $logsRoot 'report.md'

$protectedRootNames = @('.git', 'node_modules', 'data', 'database', 'db')
$protectedExtensions = @('.db', '.sqlite', '.sqlite3', '.db-wal', '.db-shm', '.sqlite-wal', '.sqlite-shm')
$placeholderNames = @('.gitkeep', '.keep', '.placeholder', '.empty', '.emptydir', 'placeholder.txt')
$buildNames = @('.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.cache', 'tmp', 'temp')
$junkOsPatterns = @('.DS_Store', 'Thumbs.db')
$junkTempPatterns = @('*.tmp', '*.bak', '*.old', '*.swp', '*.swo')
$junkLogPatterns = @('*.log', 'npm-debug.log*', 'yarn-error.log', 'pnpm-debug.log')

function Get-RelativePath([string]$base, [string]$path) {
    $baseFull = (Resolve-Path -LiteralPath $base -ErrorAction SilentlyContinue)
    $basePath = if ($baseFull) { $baseFull.Path } else { $base }
    $full = $path
    if (Test-Path -LiteralPath $path) {
        $resolved = Resolve-Path -LiteralPath $path -ErrorAction SilentlyContinue
        if ($resolved) {
            $full = $resolved.Path
        }
    }
    if ($full.StartsWith($basePath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $rel = $full.Substring($basePath.Length)
        $rel = $rel.TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
        if ($rel -eq '') {
            return '.'
        }
        return $rel
    }
    return $path
}

function Normalize-RelPath([string]$path) {
    if (-not $path) {
        return $path
    }
    return ($path -replace '\\', '/')
}

function Is-IgnoredVirtualEnvSegment([string[]]$segments) {
    foreach ($segment in $segments) {
        if ($segment -like '.venv*') {
            return $true
        }
    }
    return $false
}

function Is-UnderPath([string]$path, [string]$root) {
    $p = $path.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $r = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if ([string]::Equals($p, $r, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    return $p.StartsWith($r + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Is-ProtectedPath([string]$path) {
    $full = Resolve-Path -LiteralPath $path -ErrorAction SilentlyContinue
    $fullPath = if ($full) { $full.Path } else { $path }
    $rel = Get-RelativePath $RepoRoot $fullPath
    if (-not $rel) {
        return $true
    }
    if ($rel -like '..*') {
        return $true
    }
    $rel = $rel -replace '/', '\\'
    if ($rel -eq '.' -or $rel -eq '') {
        return $true
    }
    $segments = @($rel -split '[\\/]' | Where-Object { $_ -ne '' })
    if (@($segments).Count -eq 0) {
        return $true
    }
    if ($protectedRootNames -contains $segments[0]) {
        return $true
    }
    if (Is-IgnoredVirtualEnvSegment $segments) {
        return $true
    }
    if ($segments -contains 'node_modules') {
        return $true
    }
    if ($segments -contains 'data') {
        return $true
    }
    if ($segments -contains 'database') {
        return $true
    }
    if ($segments -contains 'db') {
        return $true
    }
    if ($segments.Count -ge 2 -and $segments[0] -eq 'logs' -and $segments[1] -eq 'audit-clean') {
        return $true
    }
    return $false
}

function Is-ProtectedFile([System.IO.FileInfo]$file) {
    if (Is-ProtectedPath $file.FullName) {
        return $true
    }
    $ext = $file.Extension.ToLowerInvariant()
    if ($protectedExtensions -contains $ext) {
        return $true
    }
    return $false
}

function Get-RepoDirectories([string]$root) {
    $results = New-Object System.Collections.Generic.List[System.IO.DirectoryInfo]
    $stack = New-Object System.Collections.Generic.Stack[string]
    $stack.Push($root)
    while ($stack.Count -gt 0) {
        $current = $stack.Pop()
        $dirs = Get-ChildItem -LiteralPath $current -Directory -Force -ErrorAction SilentlyContinue
        foreach ($dir in $dirs) {
            if (Is-ProtectedPath $dir.FullName) {
                continue
            }
            $results.Add($dir)
            $stack.Push($dir.FullName)
        }
    }
    return $results
}

function Get-RepoFiles([string]$root) {
    $results = New-Object System.Collections.Generic.List[System.IO.FileInfo]
    $stack = New-Object System.Collections.Generic.Stack[string]
    $stack.Push($root)
    while ($stack.Count -gt 0) {
        $current = $stack.Pop()
        $items = Get-ChildItem -LiteralPath $current -Force -ErrorAction SilentlyContinue
        foreach ($item in $items) {
            if ($item.PSIsContainer) {
                if (Is-ProtectedPath $item.FullName) {
                    continue
                }
                $stack.Push($item.FullName)
                continue
            }
            if (Is-ProtectedFile $item) {
                continue
            }
            $results.Add($item)
        }
    }
    return $results
}

function Test-MatchAny([string]$name, [string[]]$patterns) {
    foreach ($pattern in $patterns) {
        if ($name -like $pattern) {
            return $true
        }
    }
    return $false
}

function Is-LogName([string]$name) {
    return (Test-MatchAny $name $junkLogPatterns)
}

$gitAvailable = $true
try {
    & git -C $RepoRoot --version | Out-Null
} catch {
    $gitAvailable = $false
}

function Test-GitIgnored([string]$path) {
    if (-not $gitAvailable) {
        return $false
    }
    $rel = Normalize-RelPath (Get-RelativePath $RepoRoot $path)
    if ($rel -like '..*') {
        return $false
    }
    & git -C $RepoRoot check-ignore -q -- "$rel"
    return $LASTEXITCODE -eq 0
}

function Format-Size([long]$bytes) {
    if ($bytes -ge 1GB) {
        return ('{0:N2} GB' -f ($bytes / 1GB))
    }
    if ($bytes -ge 1MB) {
        return ('{0:N2} MB' -f ($bytes / 1MB))
    }
    if ($bytes -ge 1KB) {
        return ('{0:N2} KB' -f ($bytes / 1KB))
    }
    return "$bytes B"
}

function Format-PathList([string[]]$paths, [int]$limit) {
    if (-not $paths -or @($paths).Count -eq 0) {
        return @('  - none')
    }
    if (-not $VerboseReport -and @($paths).Count -gt $limit) {
        $shown = @($paths)[0..($limit - 1)]
        $lines = $shown | ForEach-Object { "  - $($_)" }
        $lines += "  - ... ($(@($paths).Count - $limit) more)"
        return $lines
    }
    return $paths | ForEach-Object { "  - $($_)" }
}

function Format-Path([string]$path) {
    $rel = Normalize-RelPath (Get-RelativePath $RepoRoot $path)
    return $rel
}

function Is-UnderAnyDir([string]$path, [string[]]$dirs) {
    foreach ($dir in $dirs) {
        if (Is-UnderPath $path $dir) {
            return $true
        }
    }
    return $false
}

$allDirs = Get-RepoDirectories $RepoRoot
$buildDirs = $allDirs | Where-Object {
    $name = $_.Name.ToLowerInvariant()
    $buildNames -contains $name
} | Where-Object {
    Test-GitIgnored $_.FullName
}

$buildDirPaths = $buildDirs | ForEach-Object { $_.FullName }
$buildDirSet = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
foreach ($dir in $buildDirPaths) {
    [void]$buildDirSet.Add($dir)
}

$allFiles = Get-RepoFiles $RepoRoot
$filesForScan = $allFiles | Where-Object { -not (Is-UnderAnyDir $_.FullName $buildDirPaths) }

$emptyFiles = $filesForScan | Where-Object {
    $_.Length -eq 0 -and (-not ($KeepLogs -and (Is-LogName $_.Name)))
}

$junkOsFiles = $filesForScan | Where-Object { Test-MatchAny $_.Name $junkOsPatterns }
$junkTempFiles = $filesForScan | Where-Object { Test-MatchAny $_.Name $junkTempPatterns }
$junkLogFiles = if ($KeepLogs) { @() } else { $filesForScan | Where-Object { Is-LogName $_.Name } }

$filesToDeleteSet = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
$emptyFilesFinal = @()
foreach ($file in $emptyFiles) {
    if ($filesToDeleteSet.Add($file.FullName)) {
        $emptyFilesFinal += $file
    }
}
$junkOsFinal = @()
foreach ($file in $junkOsFiles) {
    if ($filesToDeleteSet.Add($file.FullName)) {
        $junkOsFinal += $file
    }
}
$junkTempFinal = @()
foreach ($file in $junkTempFiles) {
    if ($filesToDeleteSet.Add($file.FullName)) {
        $junkTempFinal += $file
    }
}
$junkLogFinal = @()
foreach ($file in $junkLogFiles) {
    if ($filesToDeleteSet.Add($file.FullName)) {
        $junkLogFinal += $file
    }
}

$dirsForScan = $allDirs | Where-Object { -not (Is-UnderAnyDir $_.FullName $buildDirPaths) }
$dirsSorted = $dirsForScan | Sort-Object { $_.FullName.Length } -Descending

$dirsDeleteSet = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
foreach ($dir in $buildDirPaths) {
    [void]$dirsDeleteSet.Add($dir)
}

$placeholderDirs = @()
$emptyDirs = @()
$placeholderLookup = $placeholderNames | ForEach-Object { $_.ToLowerInvariant() }

foreach ($dir in $dirsSorted) {
    if ($dirsDeleteSet.Contains($dir.FullName)) {
        continue
    }
    $items = Get-ChildItem -LiteralPath $dir.FullName -Force -ErrorAction SilentlyContinue
    $remainingDirs = @()
    $remainingFiles = @()
    foreach ($item in $items) {
        if ($item.PSIsContainer) {
            if ($dirsDeleteSet.Contains($item.FullName)) {
                continue
            }
            if (Is-UnderAnyDir $item.FullName $buildDirPaths) {
                continue
            }
            $remainingDirs += $item
            continue
        }
        if ($filesToDeleteSet.Contains($item.FullName)) {
            continue
        }
        if (Is-UnderAnyDir $item.FullName $buildDirPaths) {
            continue
        }
        $remainingFiles += $item
    }

    if ($remainingDirs.Count -eq 0 -and $remainingFiles.Count -eq 0) {
        $emptyDirs += $dir
        [void]$dirsDeleteSet.Add($dir.FullName)
        continue
    }

    if ($remainingDirs.Count -eq 0 -and $remainingFiles.Count -gt 0) {
        $allPlaceholder = $true
        foreach ($file in $remainingFiles) {
            if (-not ($placeholderLookup -contains $file.Name.ToLowerInvariant())) {
                $allPlaceholder = $false
                break
            }
        }
        if ($allPlaceholder) {
            $placeholderDirs += $dir
            [void]$dirsDeleteSet.Add($dir.FullName)
        }
    }
}

$buildDirsRel = @($buildDirPaths | ForEach-Object { Format-Path $_ })
$emptyFilesRel = @($emptyFilesFinal | ForEach-Object { Format-Path $_.FullName })
$junkOsRel = @($junkOsFinal | ForEach-Object { Format-Path $_.FullName })
$junkTempRel = @($junkTempFinal | ForEach-Object { Format-Path $_.FullName })
$junkLogRel = @($junkLogFinal | ForEach-Object { Format-Path $_.FullName })
$placeholderDirsRel = @($placeholderDirs | ForEach-Object { Format-Path $_.FullName })
$emptyDirsRel = @($emptyDirs | ForEach-Object { Format-Path $_.FullName })

Write-Output "Mode: $modeLabel"
Write-Output "RepoRoot: $RepoRoot"
Write-Output "KeepLogs: $KeepLogs"
Write-Output 'Planned deletions:'
Write-Output "  Empty files: $(@($emptyFilesRel).Count)"
Write-Output "  Junk OS files: $(@($junkOsRel).Count)"
Write-Output "  Junk temp/backup files: $(@($junkTempRel).Count)"
Write-Output "  Junk log files: $(@($junkLogRel).Count)"
Write-Output "  Build artifact dirs (gitignored): $(@($buildDirsRel).Count)"
Write-Output "  Placeholder-only dirs: $(@($placeholderDirsRel).Count)"
Write-Output "  Empty dirs: $(@($emptyDirsRel).Count)"

if ($VerboseReport) {
    if (@($emptyFilesRel).Count -gt 0) { $emptyFilesRel | ForEach-Object { Write-Output "    $($_)" } }
    if (@($junkOsRel).Count -gt 0) { $junkOsRel | ForEach-Object { Write-Output "    $($_)" } }
    if (@($junkTempRel).Count -gt 0) { $junkTempRel | ForEach-Object { Write-Output "    $($_)" } }
    if (@($junkLogRel).Count -gt 0) { $junkLogRel | ForEach-Object { Write-Output "    $($_)" } }
    if (@($buildDirsRel).Count -gt 0) { $buildDirsRel | ForEach-Object { Write-Output "    $($_)" } }
    if (@($placeholderDirsRel).Count -gt 0) { $placeholderDirsRel | ForEach-Object { Write-Output "    $($_)" } }
    if (@($emptyDirsRel).Count -gt 0) { $emptyDirsRel | ForEach-Object { Write-Output "    $($_)" } }
}

$deleteErrors = @()
$deletedFiles = @()
$deletedDirs = @()

if ($Apply) {
    foreach ($file in $filesToDeleteSet) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            continue
        }
        try {
            Remove-Item -LiteralPath $file -Force
            $deletedFiles += $file
        } catch {
            $deleteErrors += "File: $file -> $($_.Exception.Message)"
        }
    }

    foreach ($dir in $buildDirPaths) {
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
            continue
        }
        try {
            Remove-Item -LiteralPath $dir -Recurse -Force
            $deletedDirs += $dir
        } catch {
            $deleteErrors += "Dir: $dir -> $($_.Exception.Message)"
        }
    }

    foreach ($dir in ($placeholderDirs | Sort-Object { $_.FullName.Length } -Descending)) {
        if (-not (Test-Path -LiteralPath $dir.FullName -PathType Container)) {
            continue
        }
        try {
            Remove-Item -LiteralPath $dir.FullName -Recurse -Force
            $deletedDirs += $dir.FullName
        } catch {
            $deleteErrors += "Dir: $($dir.FullName) -> $($_.Exception.Message)"
        }
    }

    foreach ($dir in ($emptyDirs | Sort-Object { $_.FullName.Length } -Descending)) {
        if (-not (Test-Path -LiteralPath $dir.FullName -PathType Container)) {
            continue
        }
        try {
            Remove-Item -LiteralPath $dir.FullName -Force
            $deletedDirs += $dir.FullName
        } catch {
            $deleteErrors += "Dir: $($dir.FullName) -> $($_.Exception.Message)"
        }
    }
}

function Get-TopLevelTree() {
    $items = Get-ChildItem -LiteralPath $RepoRoot -Force -ErrorAction SilentlyContinue
    $lines = @()
    foreach ($item in ($items | Sort-Object { -not $_.PSIsContainer }, Name)) {
        if (Is-ProtectedPath $item.FullName) {
            continue
        }
        if (Test-GitIgnored $item.FullName) {
            continue
        }
        $name = $item.Name
        if ($item.PSIsContainer) {
            $name = "$name/"
        }
        $lines += "- $(Normalize-RelPath $name)"
    }
    return $lines
}

function Get-Entrypoints() {
    $entries = @()
    $serverRoot = Join-Path $RepoRoot 'server.js'
    if (Test-Path -LiteralPath $serverRoot) {
        $content = Get-Content -LiteralPath $serverRoot -Raw -ErrorAction SilentlyContinue
        $port = $null
        if ($content -match 'PORT\s*=\s*process\.env\.PORT\s*\|\|\s*(\d{2,5})') {
            $port = $Matches[1]
        }
        $portInfo = if ($port) { "port $port (process.env.PORT || $port)" } else { 'port via env/config' }
        $entries += "- server.js (Express) $portInfo"
    }

    $backendServer = Join-Path $RepoRoot 'backend\server.js'
    if (Test-Path -LiteralPath $backendServer) {
        $content = Get-Content -LiteralPath $backendServer -Raw -ErrorAction SilentlyContinue
        $port = $null
        if ($content -match 'PORT\s*=\s*process\.env\.PORT\s*\|\|\s*(\d{2,5})') {
            $port = $Matches[1]
        }
        $portInfo = if ($port) { "port $port (process.env.PORT || $port)" } else { 'port via env/config' }
        $entries += "- backend/server.js (API) $portInfo"
    }

    $webNext = Join-Path $RepoRoot 'web-next\package.json'
    if (Test-Path -LiteralPath $webNext) {
        $entries += '- web-next/ (Next.js: next dev/build/start, default port 3000 unless PORT is set)'
    }

    $opsScripts = Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'ops') -Filter '*.ps1' -Recurse -ErrorAction SilentlyContinue
    if ($opsScripts) {
        $examples = $opsScripts | Sort-Object Name | Select-Object -First 6 | ForEach-Object { Normalize-RelPath (Get-RelativePath $RepoRoot $_.FullName) }
        $entries += "- ops/ scripts ($(@($opsScripts).Count) files). Examples: $($examples -join ', ')"
    }

    return $entries
}

function Get-Warnings() {
    $warnings = [ordered]@{
        LargeFiles = @()
        DuplicateFiles = @()
        SuspiciousFolders = @()
        Notes = @()
    }

    if (-not $gitAvailable) {
        $warnings.Notes += 'git not available; build artifact detection limited to name match.'
    }

    $files = Get-RepoFiles $RepoRoot
    $largeThreshold = 50MB
    $largeFiles = $files | Where-Object { $_.Length -ge $largeThreshold } | Sort-Object Length -Descending
    foreach ($file in $largeFiles) {
        $warnings.LargeFiles += [ordered]@{
            path = Format-Path $file.FullName
            size = Format-Size $file.Length
        }
    }

    $dupGroups = $files | Where-Object { $_.Length -gt 0 } | Group-Object Length | Where-Object { $_.Count -gt 1 }
    $dupResults = @()
    $maxHashTotalFiles = if ($VerboseReport) { 10000 } else { 2000 }
    $maxHashGroupFiles = if ($VerboseReport) { 1000 } else { 200 }
    $hashedFileCount = 0
    foreach ($group in $dupGroups) {
        if ($group.Count -gt $maxHashGroupFiles) {
            $warnings.Notes += "duplicate hash skipped for size $($group.Name) ($($group.Count) files)"
            continue
        }
        if ($hashedFileCount + $group.Count -gt $maxHashTotalFiles) {
            $warnings.Notes += "duplicate hash scan capped at $maxHashTotalFiles files"
            break
        }
        $hashedFileCount += $group.Count
        $hashMap = @{}
        foreach ($file in $group.Group) {
            try {
                $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
            } catch {
                continue
            }
            if (-not $hashMap.ContainsKey($hash)) {
                $hashMap[$hash] = @()
            }
            $hashMap[$hash] += $file
        }
        foreach ($hash in $hashMap.Keys) {
            if (@($hashMap[$hash]).Count -gt 1) {
                $dupResults += [ordered]@{
                    hash = $hash
                    size = Format-Size $group.Name
                    files = $hashMap[$hash] | ForEach-Object { Format-Path $_.FullName }
                }
            }
        }
    }
    $warnings.DuplicateFiles = $dupResults

    $suspiciousPatterns = @('backup', 'bak', 'old', 'unused', 'tmp', 'temp', 'archive', 'legacy', 'deprecated', 'dump', 'trash', 'scratch')
    $dirs = Get-RepoDirectories $RepoRoot
    foreach ($dir in $dirs) {
        $name = $dir.Name.ToLowerInvariant()
        foreach ($pattern in $suspiciousPatterns) {
            if ($name -like "*$pattern*") {
                $warnings.SuspiciousFolders += [ordered]@{
                    path = Format-Path $dir.FullName
                    pattern = $pattern
                }
                break
            }
        }
    }

    return $warnings
}

$postChecks = @()
if ($Apply) {
    Push-Location $RepoRoot
    try {
        $packageJson = Join-Path $RepoRoot 'package.json'
        $scripts = @()
        if (Test-Path -LiteralPath $packageJson) {
            try {
                $pkg = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json
                if ($pkg.scripts) {
                    $scripts = $pkg.scripts.PSObject.Properties.Name
                }
            } catch {
                $scripts = @()
            }
        }

        function Invoke-NpmScript([string]$scriptName) {
            $result = [ordered]@{
                script = $scriptName
                status = 'skipped'
                exitCode = $null
                durationMs = 0
                output = @()
            }
            if (-not ($scripts -contains $scriptName)) {
                return $result
            }
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $prevPreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                $output = & npm run $scriptName 2>&1
            } catch {
                $output = $_
            } finally {
                $ErrorActionPreference = $prevPreference
            }
            $sw.Stop()
            $result.durationMs = $sw.ElapsedMilliseconds
            $result.exitCode = $LASTEXITCODE
            $result.output = $output
            $result.status = if ($LASTEXITCODE -eq 0) { 'passed' } else { 'failed' }
            return $result
        }

        $postChecks += Invoke-NpmScript 'health'
        $postChecks += Invoke-NpmScript 'test'
        $postChecks += Invoke-NpmScript 'lint'
        $postChecks += Invoke-NpmScript 'build'
    } finally {
        Pop-Location
    }
}

$treeLines = @(Get-TopLevelTree)
$entryLines = @(Get-Entrypoints)
$warnings = Get-Warnings

$reportLines = New-Object System.Collections.Generic.List[string]
function Add-Lines([System.Collections.Generic.List[string]]$list, [object[]]$lines) {
    foreach ($line in @($lines)) {
        $list.Add([string]$line)
    }
}
$reportLines.Add('# Audit Clean Report')
$reportLines.Add('')
$reportLines.Add("- RunId: $runId")
$reportLines.Add("- Timestamp: $timestamp")
$reportLines.Add("- Mode: $modeLabel")
$reportLines.Add("- RepoRoot: $RepoRoot")
$reportLines.Add("- KeepLogs: $KeepLogs")
$reportLines.Add('')
$reportLines.Add('## Repo Tree Summary (top-level)')
Add-Lines $reportLines $treeLines
$reportLines.Add('')
$reportLines.Add('## Detected Entrypoints and Ports')
if (@($entryLines).Count -eq 0) {
    $reportLines.Add('- none')
} else {
    Add-Lines $reportLines $entryLines
}
$reportLines.Add('')
$reportLines.Add('## Deletions (by category)')
$reportLines.Add("- Empty files ($(@($emptyFilesRel).Count))")
Add-Lines $reportLines (Format-PathList $emptyFilesRel 40)
$reportLines.Add("- Junk OS files ($(@($junkOsRel).Count))")
Add-Lines $reportLines (Format-PathList $junkOsRel 40)
$reportLines.Add("- Junk temp/backup files ($(@($junkTempRel).Count))")
Add-Lines $reportLines (Format-PathList $junkTempRel 40)
$reportLines.Add("- Junk log files ($(@($junkLogRel).Count))")
Add-Lines $reportLines (Format-PathList $junkLogRel 40)
$reportLines.Add("- Build artifact dirs (gitignored) ($(@($buildDirsRel).Count))")
Add-Lines $reportLines (Format-PathList $buildDirsRel 40)
$reportLines.Add("- Placeholder-only dirs ($(@($placeholderDirsRel).Count))")
Add-Lines $reportLines (Format-PathList $placeholderDirsRel 40)
$reportLines.Add("- Empty dirs ($(@($emptyDirsRel).Count))")
Add-Lines $reportLines (Format-PathList $emptyDirsRel 40)
$reportLines.Add('')

$reportLines.Add('## Warnings')
$reportLines.Add("- Large files > 50 MB ($(@($warnings.LargeFiles).Count))")
if (@($warnings.LargeFiles).Count -eq 0) {
    $reportLines.Add('  - none')
} else {
    foreach ($file in $warnings.LargeFiles) {
        $reportLines.Add("  - $($file.path) ($($file.size))")
    }
}

$dupItems = @($warnings.DuplicateFiles)
$reportLines.Add("- Duplicate files by hash ($($dupItems.Count))")
if ($dupItems.Count -eq 0) {
    $reportLines.Add('  - none')
} else {
    $dupLimit = if ($VerboseReport) { $dupItems.Count } else { [Math]::Min($dupItems.Count, 20) }
    foreach ($dup in $dupItems | Select-Object -First $dupLimit) {
        $reportLines.Add("  - Hash $($dup.hash) ($($dup.files.Count) files, $($dup.size))")
        foreach ($file in $dup.files) {
            $reportLines.Add("    - $file")
        }
    }
    if (-not $VerboseReport -and $dupItems.Count -gt $dupLimit) {
        $reportLines.Add("  - ... ($($dupItems.Count - $dupLimit) more)")
    }
}

$reportLines.Add("- Suspicious folders ($(@($warnings.SuspiciousFolders).Count))")
if (@($warnings.SuspiciousFolders).Count -eq 0) {
    $reportLines.Add('  - none')
} else {
    foreach ($folder in $warnings.SuspiciousFolders) {
        $reportLines.Add("  - $($folder.path) (matched: $($folder.pattern))")
    }
}

if (@($warnings.Notes).Count -gt 0) {
    $reportLines.Add('- Notes')
    foreach ($note in $warnings.Notes) {
        $reportLines.Add("  - $note")
    }
}

if ($Apply) {
    $reportLines.Add('')
    $reportLines.Add('## Post-cleanup Checks')
    foreach ($check in $postChecks) {
        $reportLines.Add("- npm run $($check.script): $($check.status) (exit $($check.exitCode))")
        if ($check.output -and @($check.output).Count -gt 0) {
            $tail = if ($VerboseReport) { $check.output } else { $check.output | Select-Object -Last 20 }
            foreach ($line in $tail) {
                $reportLines.Add("  $line")
            }
        }
    }
}

if (@($deleteErrors).Count -gt 0) {
    $reportLines.Add('')
    $reportLines.Add('## Deletion Errors')
    foreach ($err in $deleteErrors) {
        $reportLines.Add("- $err")
    }
}

$reportLines | Set-Content -LiteralPath $reportPath -Encoding UTF8

$manifest = [ordered]@{
    runId = $runId
    timestamp = $timestamp
    mode = $modeLabel
    repoRoot = $RepoRoot
    keepLogs = [bool]$KeepLogs
    deletions = [ordered]@{
        emptyFiles = $emptyFilesRel
        junkOsFiles = $junkOsRel
        junkTempFiles = $junkTempRel
        junkLogFiles = $junkLogRel
        buildArtifactDirs = $buildDirsRel
        placeholderDirs = $placeholderDirsRel
        emptyDirs = $emptyDirsRel
    }
    deletionErrors = $deleteErrors
    postChecks = $postChecks
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Output "Report: $reportPath"
Write-Output "Manifest: $manifestPath"
Write-Output 'Next steps:'
Write-Output "  - Review $reportPath"
if (-not $Apply) {
    Write-Output '  - Re-run with -Apply to execute deletions'
}
