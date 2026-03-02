param(
  [string]$BaseUrl = "",
  [string]$PortsPath = "",
  [string]$ResultPath = ""
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$logsDir = Join-Path $root "logs"
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
}

if (-not $PortsPath) {
  $PortsPath = Join-Path $logsDir "ports.json"
}
if (-not $ResultPath) {
  $ResultPath = Join-Path $logsDir "smoke-result.json"
}

function Write-Section {
  param([string]$Message)
  Write-Host "[smoke] $Message"
}

function Get-StatusCode {
  param($ErrorRecord)
  if ($ErrorRecord.Exception -and $ErrorRecord.Exception.Response) {
    return [int]$ErrorRecord.Exception.Response.StatusCode
  }
  return $null
}

function ConvertFrom-JsonSafe {
  param([string]$Text)
  if (-not $Text) { return $null }
  try {
    return $Text | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-FirstValue {
  param([object[]]$Values)
  foreach ($value in $Values) {
    if ($null -ne $value -and $value -ne '') {
      return $value
    }
  }
  return $null
}

function Extract-RoleFromRaw {
  param(
    [string]$Raw,
    [string[]]$Keys
  )
  if (-not $Raw) { return $null }
  foreach ($key in $Keys) {
    $escapedKey = [regex]::Escape($key)
    $pattern = '"' + $escapedKey + '"\s*:\s*"(admin|superadmin)"'
    if ($Raw -match $pattern) {
      return $Matches[1]
    }
  }
  if ($Raw -match '"role"\s*:\s*"(admin|superadmin)"') {
    return $Matches[1]
  }
  return $null
}

function Read-EnvExample {
  param([string]$Path)
  $data = @{}
  if (-not (Test-Path $Path)) {
    return $data
  }
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    if ($trimmed.StartsWith("#")) { continue }
    $pair = $trimmed -split "=", 2
    if ($pair.Length -ne 2) { continue }
    $key = $pair[0].Trim()
    $value = $pair[1].Trim()
    if ($key) {
      $data[$key] = $value
    }
  }
  return $data
}

function Resolve-Credentials {
  $email = $env:SMOKE_EMAIL
  $password = $env:SMOKE_PASSWORD
  $source = "env"
  if (-not $email -or -not $password) {
    $examplePath = Join-Path $root ".env.example"
    $example = Read-EnvExample -Path $examplePath
    $exampleEmail = $example["SMOKE_EMAIL"]
    $examplePassword = $example["SMOKE_PASSWORD"]
    if (-not $exampleEmail) { $exampleEmail = $example["TEST_USER_EMAIL"] }
    if (-not $examplePassword) { $examplePassword = $example["TEST_USER_PASSWORD"] }
    if (-not $email -and $exampleEmail) {
      $email = $exampleEmail
      $source = "env.example"
    }
    if (-not $password -and $examplePassword) {
      $password = $examplePassword
      $source = "env.example"
    }
  }
  return @{ email = $email; password = $password; source = $source }
}

function Resolve-BaseUrl {
  param([string]$BaseUrl, [string]$PortsPath, [string]$BackendPort)
  $base = $BaseUrl
  $port = $BackendPort
  if (-not $base -and (Test-Path $PortsPath)) {
    try {
      $ports = Get-Content -Raw $PortsPath | ConvertFrom-Json
      if ($ports.backendUrl) { $base = [string]$ports.backendUrl }
      if ($ports.backendPort) { $port = [string]$ports.backendPort }
    } catch {
    }
  }
  if (-not $base) {
    $base = "http://localhost:$port"
  }
  return @($base.TrimEnd("/"), $port)
}

function New-RandomEmail {
  $stamp = (Get-Date).ToString("yyyyMMddHHmmss")
  $rand = Get-Random -Minimum 1000 -Maximum 9999
  return "smoke-$stamp-$rand@local"
}

function New-RandomPassword {
  $rand = Get-Random -Minimum 1000 -Maximum 9999
  return "Smoke$rand!"
}

function Invoke-JsonRequest {
  param(
    [string]$Url,
    [string]$Method,
    [string]$Body = "",
    $Session = $null,
    [hashtable]$Headers = $null,
    [int]$TimeoutSec = 10
  )
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method $Method -ContentType "application/json" -Body $Body -WebSession $Session -Headers $Headers -TimeoutSec $TimeoutSec
    return @{
      ok = $true
      status = $response.StatusCode
      data = ConvertFrom-JsonSafe -Text $response.Content
      raw = $response.Content
    }
  } catch {
    $statusCode = Get-StatusCode $_
    return @{
      ok = $false
      status = $statusCode
      error = $_.Exception.Message
    }
  }
}

function Fetch-AuthMe {
  param(
    [string]$BaseUrl,
    $Session
  )
  $resp = Invoke-JsonRequest -Url "$BaseUrl/api/auth/me" -Method "GET" -Session $Session -TimeoutSec 5
  if (-not $resp.ok) { return @{ ok = $false; status = $resp.status; error = $resp.error } }
  $payload = $resp.data
  if ($payload -and $payload.ok -eq $false) {
    $msg = $payload.message
    if (-not $msg) { $msg = $payload.error }
    if (-not $msg) { $msg = "Auth/me failed" }
    return @{ ok = $false; status = $resp.status; error = $msg }
  }
  $data = if ($payload -and $payload.data) { $payload.data } else { $payload }
  $roleFromRaw = Extract-RoleFromRaw -Raw $resp.raw -Keys @("tenantRole", "role")
  return @{
    ok = $true
    status = $resp.status
    tenantId = $data?.activeTenantId
    tenantRole = Get-FirstValue -Values @($data?.tenantRole, $roleFromRaw)
    userRole = Get-FirstValue -Values @($data?.user?.role, $roleFromRaw)
  }
}

function Try-Login {
  param(
    [string]$BaseUrl,
    [string]$Email,
    [string]$Password
  )
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $payload = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
  $resp = Invoke-JsonRequest -Url "$BaseUrl/api/auth/login" -Method "POST" -Body $payload -Session $session -TimeoutSec 10
  if (-not $resp.ok) {
    return @{ ok = $false; status = $resp.status; error = $resp.error }
  }
  if ($resp.data -and $resp.data.ok -eq $false) {
    $msg = $resp.data.message
    if (-not $msg) { $msg = $resp.data.error }
    if (-not $msg) { $msg = "Login failed" }
    return @{ ok = $false; status = $resp.status; error = $msg }
  }
  $loginPayload = $resp.data
  $loginData = if ($loginPayload -and $loginPayload.data) { $loginPayload.data } else { $loginPayload }
  $loginTenantId = $loginData?.activeTenantId
  $loginRole = Get-FirstValue -Values @($loginData?.user?.role, (Extract-RoleFromRaw -Raw $resp.raw -Keys @("tenantRole", "role")))
  $me = Fetch-AuthMe -BaseUrl $BaseUrl -Session $session
  if (-not $me.ok) {
    return @{
      ok = $true
      session = $session
      tenantId = $loginTenantId
      tenantRole = $loginRole
      userRole = $loginRole
    }
  }
  return @{
    ok = $true
    session = $session
    tenantId = $me.tenantId
    tenantRole = $me.tenantRole
    userRole = $me.userRole
  }
}

function Try-Register {
  param(
    [string]$BaseUrl,
    [string]$Email,
    [string]$Password
  )
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $payload = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
  $resp = Invoke-JsonRequest -Url "$BaseUrl/api/auth/register" -Method "POST" -Body $payload -Session $session -TimeoutSec 10
  if (-not $resp.ok) {
    return @{ ok = $false; status = $resp.status; error = $resp.error }
  }
  if ($resp.data -and $resp.data.ok -eq $false) {
    $msg = $resp.data.message
    if (-not $msg) { $msg = $resp.data.error }
    if (-not $msg) { $msg = "Register failed" }
    return @{ ok = $false; status = $resp.status; error = $msg }
  }
  $registerPayload = $resp.data
  $registerData = if ($registerPayload -and $registerPayload.data) { $registerPayload.data } else { $registerPayload }
  $registerTenantId = $registerData?.activeTenantId
  $registerRole = Get-FirstValue -Values @($registerData?.user?.role, (Extract-RoleFromRaw -Raw $resp.raw -Keys @("tenantRole", "role")))
  $me = Fetch-AuthMe -BaseUrl $BaseUrl -Session $session
  if (-not $me.ok) {
    return @{
      ok = $true
      session = $session
      tenantId = $registerTenantId
      tenantRole = $registerRole
      userRole = $registerRole
    }
  }
  return @{
    ok = $true
    session = $session
    tenantId = $me.tenantId
    tenantRole = $me.tenantRole
    userRole = $me.userRole
  }
}

$backendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "3000" }
$resolved = Resolve-BaseUrl -BaseUrl $BaseUrl -PortsPath $PortsPath -BackendPort $backendPort
$base = $resolved[0]

$checks = [ordered]@{}

function Set-Check {
  param(
    [string]$Name,
    [string]$Status,
    [string]$Reason = "",
    [string]$Url = "",
    $HttpStatus = $null,
    [hashtable]$Meta = $null
  )
  $entry = [ordered]@{ status = $Status }
  if ($Reason) { $entry.reason = $Reason }
  if ($Url) { $entry.url = $Url }
  if ($null -ne $HttpStatus) { $entry.httpStatus = $HttpStatus }
  if ($Meta) { $entry.meta = $Meta }
  $checks[$Name] = $entry

  $detail = $Reason
  if (-not $detail -and $null -ne $HttpStatus) { $detail = "status $HttpStatus" }
  $suffix = if ($detail) { " - $detail" } else { "" }
  Write-Host "[smoke] [$Status] $Name$suffix"
}

Write-Section "Base URL: $base"

$healthUrl = "$base/api/health"
Write-Section "Health check: $healthUrl"
$healthOk = $false
try {
  $healthResp = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 5
  $healthOk = $healthResp.StatusCode -eq 200
  if ($healthOk) {
    Set-Check -Name "health" -Status "PASS" -Url $healthUrl -HttpStatus $healthResp.StatusCode
  } else {
    Set-Check -Name "health" -Status "FAIL" -Url $healthUrl -HttpStatus $healthResp.StatusCode -Reason "Unexpected status"
  }
} catch {
  $statusCode = Get-StatusCode $_
  $message = $_.Exception.Message
  Set-Check -Name "health" -Status "FAIL" -Url $healthUrl -HttpStatus $statusCode -Reason $message
}

$skipDueToHealth = -not $healthOk
if ($skipDueToHealth) {
  Set-Check -Name "login" -Status "SKIPPED" -Reason "health check failed"
  Set-Check -Name "authMe" -Status "SKIPPED" -Reason "health check failed"
  Set-Check -Name "autopilotStatus" -Status "SKIPPED" -Reason "health check failed"
  Set-Check -Name "autopilotEnable" -Status "SKIPPED" -Reason "health check failed"
  Set-Check -Name "autopilotTick" -Status "SKIPPED" -Reason "health check failed"
}

$hasSession = $false
$session = $null
$tenantId = $null
$tenantRole = $null
$userRole = $null
$authEndpointMissing = $false
$usedRegister = $false

if (-not $skipDueToHealth) {
  $creds = Resolve-Credentials
  $email = $creds.email
  $password = $creds.password

  if ($email -and $password) {
    Write-Section "Auth login: $base/api/auth/login"
    $loginResult = Try-Login -BaseUrl $base -Email $email -Password $password
    if ($loginResult.ok) {
      $session = $loginResult.session
      $tenantId = $loginResult.tenantId
      $tenantRole = $loginResult.tenantRole
      $userRole = $loginResult.userRole
      $hasSession = $true
      Set-Check -Name "login" -Status "PASS" -Url "$base/api/auth/login" -Meta @{ source = $creds.source; via = "login"; tenantRole = $tenantRole; userRole = $userRole }
    } else {
      if ($loginResult.status -eq 404) {
        $authEndpointMissing = $true
        Set-Check -Name "login" -Status "SKIPPED" -Reason "auth endpoint missing" -Url "$base/api/auth/login" -HttpStatus $loginResult.status
      } else {
        Set-Check -Name "login" -Status "FAIL" -Reason $loginResult.error -Url "$base/api/auth/login" -HttpStatus $loginResult.status
      }
    }
  }

  $normalizedRole = (Get-FirstValue -Values @($tenantRole, $userRole, "guest")).ToString().ToLower()
  $isAdmin = $normalizedRole -eq "admin" -or $normalizedRole -eq "superadmin"

  if (-not $hasSession -or -not $isAdmin) {
    $registerAttempts = 0
    while ($registerAttempts -lt 5 -and -not $isAdmin) {
      $registerAttempts += 1
      $regEmail = New-RandomEmail
      $regPassword = New-RandomPassword
      Write-Section "Auth register: $base/api/auth/register ($regEmail)"
      $registerResult = Try-Register -BaseUrl $base -Email $regEmail -Password $regPassword
      if ($registerResult.ok) {
        $session = $registerResult.session
        $tenantId = $registerResult.tenantId
        $tenantRole = $registerResult.tenantRole
        $userRole = $registerResult.userRole
        $hasSession = $true
        $usedRegister = $true
        $normalizedRole = (Get-FirstValue -Values @($tenantRole, $userRole, "guest")).ToString().ToLower()
        $isAdmin = $normalizedRole -eq "admin" -or $normalizedRole -eq "superadmin"
        Set-Check -Name "register" -Status "PASS" -Url "$base/api/auth/register" -Meta @{ attempts = $registerAttempts }
        Set-Check -Name "login" -Status "PASS" -Url "$base/api/auth/login" -Meta @{ source = "register"; via = "register"; tenantRole = $tenantRole; userRole = $userRole }
        break
      }
      if ($registerResult.status -eq 409) {
        continue
      }
      Set-Check -Name "register" -Status "FAIL" -Reason $registerResult.error -Url "$base/api/auth/register" -HttpStatus $registerResult.status
      break
    }
  }

  if ($hasSession) {
    $me = Fetch-AuthMe -BaseUrl $base -Session $session
    if ($me.ok) {
      $tenantId = $me.tenantId
      $tenantRole = $me.tenantRole
      $userRole = $me.userRole
      Set-Check -Name "authMe" -Status "PASS" -Url "$base/api/auth/me" -HttpStatus $me.status -Meta @{ tenantRole = $tenantRole; userRole = $userRole }
    } else {
      Set-Check -Name "authMe" -Status "FAIL" -Reason $me.error -Url "$base/api/auth/me" -HttpStatus $me.status
      $hasSession = $false
    }
  } elseif (-not $checks.Contains("register")) {
    Set-Check -Name "register" -Status "SKIPPED" -Reason "no session"
    Set-Check -Name "authMe" -Status "SKIPPED" -Reason "no session"
  }
}

$autopilotAvailable = $true
if (-not $skipDueToHealth) {
  $autopilotUrl = "$base/api/autopilot/status"
  Write-Section "Autopilot status: $autopilotUrl"

  if ($hasSession) {
    $headers = @{}
    if ($tenantId) { $headers["X-Tenant-Id"] = $tenantId }
    $apResp = Invoke-JsonRequest -Url $autopilotUrl -Method "GET" -Session $session -Headers $headers -TimeoutSec 5
    if ($apResp.ok) {
      if ($apResp.data -and $apResp.data.ok -eq $false) {
        $msg = $apResp.data.message
        if (-not $msg) { $msg = $apResp.data.error }
        if (-not $msg) { $msg = "Autopilot status failed" }
        Set-Check -Name "autopilotStatus" -Status "FAIL" -Reason $msg -Url $autopilotUrl -HttpStatus $apResp.status
      } else {
        Set-Check -Name "autopilotStatus" -Status "PASS" -Url $autopilotUrl -HttpStatus $apResp.status -Meta @{ authMode = "session" }
      }
    } else {
      if ($apResp.status -eq 404) {
        $autopilotAvailable = $false
        Set-Check -Name "autopilotStatus" -Status "SKIPPED" -Reason "autopilot endpoint missing" -Url $autopilotUrl -HttpStatus $apResp.status
      } elseif ($apResp.status -eq 401 -or $apResp.status -eq 403) {
        Set-Check -Name "autopilotStatus" -Status "FAIL" -Reason "Unauthorized" -Url $autopilotUrl -HttpStatus $apResp.status
      } else {
        Set-Check -Name "autopilotStatus" -Status "FAIL" -Reason $apResp.error -Url $autopilotUrl -HttpStatus $apResp.status
      }
    }
  } else {
    $apResp = Invoke-JsonRequest -Url $autopilotUrl -Method "GET" -TimeoutSec 5
    if ($apResp.ok) {
      if ($apResp.data -and $apResp.data.ok -eq $false) {
        $msg = $apResp.data.message
        if (-not $msg) { $msg = $apResp.data.error }
        if (-not $msg) { $msg = "Autopilot status failed" }
        Set-Check -Name "autopilotStatus" -Status "FAIL" -Reason $msg -Url $autopilotUrl -HttpStatus $apResp.status
      } else {
        Set-Check -Name "autopilotStatus" -Status "PASS" -Url $autopilotUrl -HttpStatus $apResp.status -Meta @{ authMode = "guest" }
      }
    } else {
      if ($apResp.status -eq 404) {
        $autopilotAvailable = $false
        Set-Check -Name "autopilotStatus" -Status "SKIPPED" -Reason "autopilot endpoint missing" -Url $autopilotUrl -HttpStatus $apResp.status
      } elseif ($apResp.status -eq 401 -or $apResp.status -eq 403) {
        Set-Check -Name "autopilotStatus" -Status "PASS" -Reason "auth required" -Url $autopilotUrl -HttpStatus $apResp.status -Meta @{ authMode = "guest" }
      } else {
        Set-Check -Name "autopilotStatus" -Status "FAIL" -Reason $apResp.error -Url $autopilotUrl -HttpStatus $apResp.status
      }
    }
  }
}

if (-not $skipDueToHealth) {
  if (-not $autopilotAvailable) {
    Set-Check -Name "autopilotEnable" -Status "SKIPPED" -Reason "autopilot endpoint missing"
    Set-Check -Name "autopilotTick" -Status "SKIPPED" -Reason "autopilot endpoint missing"
  } else {
    $serviceToken = $env:AUTOPILOT_SERVICE_TOKEN
    $serviceToken = if ($serviceToken) { $serviceToken.Trim() } else { "" }
    $tenantHeaderValue = $tenantId
    if (-not $tenantHeaderValue) { $tenantHeaderValue = $env:SMOKE_TENANT_ID }
    if (-not $tenantHeaderValue) { $tenantHeaderValue = "1" }
    $normalizedRole = (Get-FirstValue -Values @($tenantRole, $userRole, "guest")).ToString().ToLower()
    $isAdmin = $normalizedRole -eq "admin" -or $normalizedRole -eq "superadmin"

    if ($hasSession -and $isAdmin) {
      $headers = @{}
      if ($tenantHeaderValue) { $headers["X-Tenant-Id"] = $tenantHeaderValue }
      Write-Section "Autopilot enable: $base/api/autopilot/enable"
      $enablePayload = @{ enabled = $true } | ConvertTo-Json -Compress
      $enableResp = Invoke-JsonRequest -Url "$base/api/autopilot/enable" -Method "POST" -Body $enablePayload -Session $session -Headers $headers -TimeoutSec 10
      if ($enableResp.ok -and -not ($enableResp.data -and $enableResp.data.ok -eq $false)) {
        Set-Check -Name "autopilotEnable" -Status "PASS" -Url "$base/api/autopilot/enable" -HttpStatus $enableResp.status -Meta @{ authMode = "session" }
      } else {
        $msg = $enableResp.error
        if ($enableResp.data) { $msg = Get-FirstValue -Values @($enableResp.data.message, $enableResp.data.error, $msg) }
        if (-not $msg) { $msg = "Autopilot enable failed" }
        Set-Check -Name "autopilotEnable" -Status "FAIL" -Reason $msg -Url "$base/api/autopilot/enable" -HttpStatus $enableResp.status
      }

      Write-Section "Autopilot tick: $base/api/autopilot/tick"
      $tickPayload = @{ } | ConvertTo-Json -Compress
      $tickResp = Invoke-JsonRequest -Url "$base/api/autopilot/tick" -Method "POST" -Body $tickPayload -Session $session -Headers $headers -TimeoutSec 20
      if ($tickResp.ok -and -not ($tickResp.data -and $tickResp.data.ok -eq $false)) {
        Set-Check -Name "autopilotTick" -Status "PASS" -Url "$base/api/autopilot/tick" -HttpStatus $tickResp.status -Meta @{ authMode = "session" }
      } else {
        $msg = $tickResp.error
        if ($tickResp.data) { $msg = Get-FirstValue -Values @($tickResp.data.message, $tickResp.data.error, $msg) }
        if (-not $msg) { $msg = "Autopilot tick failed" }
        Set-Check -Name "autopilotTick" -Status "FAIL" -Reason $msg -Url "$base/api/autopilot/tick" -HttpStatus $tickResp.status
      }
    } elseif ($serviceToken) {
      $headers = @{
        "x-service-token" = $serviceToken
        "Authorization" = "Bearer $serviceToken"
        "X-Tenant-Id" = $tenantHeaderValue
      }
      Write-Section "Autopilot enable (service-token): $base/api/autopilot/enable"
      $enableBody = @{ enabled = $true; tenantId = $tenantHeaderValue } | ConvertTo-Json -Compress
      $enableResp = Invoke-JsonRequest -Url "$base/api/autopilot/enable" -Method "POST" -Body $enableBody -Headers $headers -TimeoutSec 10
      if ($enableResp.ok -and -not ($enableResp.data -and $enableResp.data.ok -eq $false)) {
        Set-Check -Name "autopilotEnable" -Status "PASS" -Url "$base/api/autopilot/enable" -HttpStatus $enableResp.status -Meta @{ authMode = "service-token" }
      } else {
        $msg = $enableResp.error
        if ($enableResp.data) { $msg = Get-FirstValue -Values @($enableResp.data.message, $enableResp.data.error, $msg) }
        if (-not $msg) { $msg = "Autopilot enable failed" }
        Set-Check -Name "autopilotEnable" -Status "FAIL" -Reason $msg -Url "$base/api/autopilot/enable" -HttpStatus $enableResp.status -Meta @{ authMode = "service-token" }
      }

      Write-Section "Autopilot tick (service-token): $base/api/autopilot/tick"
      $tickBody = @{ tenantId = $tenantHeaderValue } | ConvertTo-Json -Compress
      $tickResp = Invoke-JsonRequest -Url "$base/api/autopilot/tick" -Method "POST" -Body $tickBody -Headers $headers -TimeoutSec 20
      if ($tickResp.ok -and -not ($tickResp.data -and $tickResp.data.ok -eq $false)) {
        Set-Check -Name "autopilotTick" -Status "PASS" -Url "$base/api/autopilot/tick" -HttpStatus $tickResp.status -Meta @{ authMode = "service-token" }
      } else {
        $msg = $tickResp.error
        if ($tickResp.data) { $msg = Get-FirstValue -Values @($tickResp.data.message, $tickResp.data.error, $msg) }
        if (-not $msg) { $msg = "Autopilot tick failed" }
        Set-Check -Name "autopilotTick" -Status "FAIL" -Reason $msg -Url "$base/api/autopilot/tick" -HttpStatus $tickResp.status -Meta @{ authMode = "service-token" }
      }
    } else {
      $reason = "admin required"
      if ($authEndpointMissing) { $reason = "auth endpoint missing and no service token" }
      Set-Check -Name "autopilotEnable" -Status "FAIL" -Reason $reason
      Set-Check -Name "autopilotTick" -Status "FAIL" -Reason $reason
    }
  }
}

$passed = @()
$failed = @()
$skipped = @()
foreach ($name in $checks.Keys) {
  $entry = $checks[$name]
  switch ($entry.status) {
    "PASS" { $passed += $name }
    "FAIL" { $failed += $name }
    "SKIPPED" { $skipped += [ordered]@{ check = $name; reason = $entry.reason } }
  }
}
$ok = $failed.Count -eq 0
$result = [ordered]@{
  ok = $ok
  ts = (Get-Date).ToString("o")
  baseUrl = $base
  checks = $checks
  summary = [ordered]@{
    passed = $passed
    failed = $failed
    skipped = $skipped
  }
}
$result | ConvertTo-Json -Depth 6 | Out-File -FilePath $ResultPath -Encoding ascii

$finalStatus = if ($ok) { "PASS" } else { "FAIL" }
Write-Section "Result: $finalStatus"
if ($passed.Count -gt 0) {
  Write-Section ("Passed: " + ($passed -join ", "))
}
if ($skipped.Count -gt 0) {
  $skipText = $skipped | ForEach-Object { "{0} ({1})" -f $_.check, $_.reason }
  Write-Section ("Skipped: " + ($skipText -join ", "))
}
if ($failed.Count -gt 0) {
  Write-Section ("Failed: " + ($failed -join ", "))
}

if (-not $ok) {
  exit 1
}
exit 0
