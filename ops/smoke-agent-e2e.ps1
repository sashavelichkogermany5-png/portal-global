param(
  [string]$BackendBaseUrl = "",
  [string]$WebBaseUrl = "",
  [string]$ResultPath = ""
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$logsDir = Join-Path $root "logs"
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
}
if (-not $ResultPath) {
  $ResultPath = Join-Path $logsDir "smoke-agent-e2e.json"
}

$startTime = Get-Date

function Write-Section {
  param([string]$Message)
  Write-Host "[smoke-agent-e2e] $Message"
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

function Get-StatusCode {
  param($ErrorRecord)
  if ($ErrorRecord.Exception -and $ErrorRecord.Exception.Response) {
    return [int]$ErrorRecord.Exception.Response.StatusCode
  }
  return $null
}

function Get-ResponseHeaders {
  param($Headers)
  $result = [ordered]@{}
  if (-not $Headers) {
    return $result
  }
  foreach ($key in $Headers.Keys) {
    $value = $Headers[$key]
    if ($value -is [System.Array]) {
      $result[$key] = ($value -join ", ")
    } else {
      $result[$key] = [string]$value
    }
  }
  return $result
}

function Get-ResponseBody {
  param($ErrorRecord)
  if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
    return $ErrorRecord.ErrorDetails.Message
  }
  if (-not $ErrorRecord.Exception -or -not $ErrorRecord.Exception.Response) {
    return $null
  }
  try {
    $stream = $ErrorRecord.Exception.Response.GetResponseStream()
    if (-not $stream) { return $null }
    $reader = New-Object System.IO.StreamReader($stream)
    $content = $reader.ReadToEnd()
    $reader.Close()
    return $content
  } catch {
    return $null
  }
}

function Convert-SetCookieHeader {
  param($SetCookie)
  if (-not $SetCookie) { return $null }
  $entries = @()
  if ($SetCookie -is [System.Array]) {
    $entries = $SetCookie
  } else {
    $entries = @($SetCookie)
  }
  $cookies = @()
  foreach ($entry in $entries) {
    if (-not $entry) { continue }
    $parts = $entry -split ";", 2
    if ($parts.Length -gt 0 -and $parts[0]) {
      $cookies += $parts[0].Trim()
    }
  }
  if ($cookies.Count -eq 0) { return $null }
  return ($cookies -join "; ")
}

function Get-CookieHeaderFromSession {
  param(
    $Session,
    [string]$Url
  )
  if (-not $Session -or -not $Session.Cookies -or -not $Url) { return $null }
  try {
    $uri = [Uri]$Url
    $cookieCollection = $Session.Cookies.GetCookies($uri)
    if (-not $cookieCollection -or $cookieCollection.Count -eq 0) { return $null }
    $pairs = @()
    foreach ($cookie in $cookieCollection) {
      if ($cookie.Name -and $cookie.Value) {
        $pairs += ("{0}={1}" -f $cookie.Name, $cookie.Value)
      }
    }
    if ($pairs.Count -eq 0) { return $null }
    return ($pairs -join "; ")
  } catch {
    return $null
  }
}

function Get-AuthToken {
  param($Payload)
  if (-not $Payload) { return $null }
  if ($Payload.token) { return $Payload.token }
  if ($Payload.accessToken) { return $Payload.accessToken }
  if ($Payload.data) {
    if ($Payload.data.token) { return $Payload.data.token }
    if ($Payload.data.accessToken) { return $Payload.data.accessToken }
    if ($Payload.data.data) {
      if ($Payload.data.data.token) { return $Payload.data.data.token }
      if ($Payload.data.data.accessToken) { return $Payload.data.data.accessToken }
    }
  }
  return $null
}

function Get-ActiveTenantId {
  param($Payload)
  if (-not $Payload) { return $null }
  if ($Payload.activeTenantId) { return $Payload.activeTenantId }
  if ($Payload.data) {
    if ($Payload.data.activeTenantId) { return $Payload.data.activeTenantId }
    if ($Payload.data.data -and $Payload.data.data.activeTenantId) { return $Payload.data.data.activeTenantId }
  }
  return $null
}

function Get-UserId {
  param($Payload)
  if (-not $Payload) { return $null }
  if ($Payload.user -and $Payload.user.id) { return $Payload.user.id }
  if ($Payload.data) {
    if ($Payload.data.user -and $Payload.data.user.id) { return $Payload.data.user.id }
    if ($Payload.data.data -and $Payload.data.data.user -and $Payload.data.data.user.id) { return $Payload.data.data.user.id }
  }
  return $null
}

function Get-EntityId {
  param($Payload)
  if (-not $Payload) { return $null }
  if ($Payload.id) { return $Payload.id }
  if ($Payload.data) {
    if ($Payload.data.id) { return $Payload.data.id }
    if ($Payload.data.data -and $Payload.data.data.id) { return $Payload.data.data.id }
  }
  return $null
}

function Get-Memberships {
  param($Payload)
  if (-not $Payload) { return $null }
  if ($Payload.memberships) { return $Payload.memberships }
  if ($Payload.data) {
    if ($Payload.data.memberships) { return $Payload.data.memberships }
    if ($Payload.data.data -and $Payload.data.data.memberships) { return $Payload.data.data.memberships }
  }
  return $null
}

function Convert-CurlHeaders {
  param([string]$HeaderText)
  $result = [ordered]@{}
  if (-not $HeaderText) { return $result }
  $blocks = $HeaderText -split "(\r?\n){2}"
  $block = $null
  for ($i = $blocks.Length - 1; $i -ge 0; $i--) {
    if ($blocks[$i] -and $blocks[$i].Trim()) {
      $block = $blocks[$i]
      break
    }
  }
  if (-not $block) { return $result }
  foreach ($line in $block -split "\r?\n") {
    if (-not $line) { continue }
    if ($line -match "^HTTP/") { continue }
    $parts = $line -split ":", 2
    if ($parts.Length -eq 2) {
      $key = $parts[0].Trim()
      $value = $parts[1].Trim()
      if ($key) {
        $result[$key] = $value
      }
    }
  }
  return $result
}

function Invoke-WithRetry {
  param(
    [scriptblock]$Operation,
    [int]$MaxTries = 3,
    [int]$DelayMs = 0
  )
  $lastResult = $null
  for ($attempt = 1; $attempt -le $MaxTries; $attempt++) {
    try {
      $lastResult = & $Operation
    } catch {
      $lastResult = @{ ok = $false; status = $null; error = $_.Exception.Message }
    }
    if ($lastResult -and $lastResult.ok) {
      return $lastResult
    }
    if ($attempt -lt $MaxTries -and $DelayMs -gt 0) {
      Start-Sleep -Milliseconds $DelayMs
    }
  }
  return $lastResult
}

function Truncate-Body {
  param(
    [string]$Body,
    [int]$MaxLen = 10000
  )
  if ($null -eq $Body) { return $null }
  if ($Body.Length -le $MaxLen) { return $Body }
  return $Body.Substring(0, $MaxLen)
}

function Get-BodyText {
  param($Detail)
  if (-not $Detail) { return "" }
  if ($Detail.responseBody) { return [string]$Detail.responseBody }
  if ($Detail.raw) { return [string]$Detail.raw }
  if ($Detail.data -ne $null) {
    try {
      return ($Detail.data | ConvertTo-Json -Compress -Depth 8)
    } catch {
      return [string]$Detail.data
    }
  }
  if ($Detail.error) { return [string]$Detail.error }
  return ""
}

function Format-BodySnippet {
  param(
    [string]$Body,
    [int]$MaxLen = 200
  )
  if (-not $Body) { return "" }
  $singleLine = ($Body -replace "\s+", " ").Trim()
  if ($singleLine.Length -le $MaxLen) { return $singleLine }
  return $singleLine.Substring(0, $MaxLen) + "..."
}

function Write-FailLine {
  param(
    [string]$StepName,
    $Detail,
    [string]$LogPath
  )
  $status = $Detail.status
  if (-not $status) { $status = "n/a" }
  $bodyText = Get-BodyText -Detail $Detail
  $snippet = Format-BodySnippet -Body $bodyText -MaxLen 400
  if (-not $snippet) { $snippet = "(no response body)" }
  Write-Section ("FAIL(" + $StepName + "): " + $status + " " + $snippet)
  Write-Section ("Log: " + $LogPath)
}

function Invoke-JsonRequest {
  param(
    [string]$Url,
    [string]$Method,
    [string]$Body = "",
    $Session = $null,
    [hashtable]$Headers = $null,
    [int]$TimeoutSec = 15
  )
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method $Method -ContentType "application/json" -Body $Body -WebSession $Session -Headers $Headers -TimeoutSec $TimeoutSec
    $responseHeaders = Get-ResponseHeaders -Headers $response.Headers
    $setCookie = $null
    if ($response.Headers -and $response.Headers["Set-Cookie"]) {
      $setCookie = $response.Headers["Set-Cookie"]
    }
    $responseBody = Truncate-Body -Body $response.Content
    return @{
      ok = $true
      status = $response.StatusCode
      url = $Url
      data = ConvertFrom-JsonSafe -Text $response.Content
      raw = $response.Content
      responseBody = $responseBody
      responseHeaders = $responseHeaders
      headers = $responseHeaders
      setCookie = $setCookie
    }
  } catch {
    $statusCode = Get-StatusCode $_
    $responseBody = Truncate-Body -Body (Get-ResponseBody $_)
    $responseHeaders = $null
    if ($_.Exception -and $_.Exception.Response -and $_.Exception.Response.Headers) {
      $responseHeaders = Get-ResponseHeaders -Headers $_.Exception.Response.Headers
    }
    return @{
      ok = $false
      status = $statusCode
      url = $Url
      error = $_.Exception.Message
      responseBody = $responseBody
      responseHeaders = $responseHeaders
      headers = $responseHeaders
    }
  }
}

function Unwrap-Data {
  param($Payload)
  if (-not $Payload) { return $null }
  if ($Payload.PSObject.Properties.Match("data").Count -gt 0) { return $Payload.data }
  return $Payload
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
    $example = Read-EnvExample -Path (Join-Path $root ".env.example")
    $exampleEmail = $example["TEST_USER_EMAIL"]
    $examplePassword = $example["TEST_USER_PASSWORD"]
    if (-not $email -and $exampleEmail) {
      $email = $exampleEmail
      $source = "env.example"
    }
    if (-not $password -and $examplePassword) {
      $password = $examplePassword
      $source = "env.example"
    }
  }
  if (-not $email) { $email = "demo@local" }
  if (-not $password) { $password = "demo12345" }
  return @{ email = $email; password = $password; source = $source }
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

function Test-Health {
  param([string]$BaseUrl)
  $url = "$BaseUrl/api/health"
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
    $body = Truncate-Body -Body $resp.Content
    return @{
      ok = ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300)
      status = $resp.StatusCode
      url = $url
      responseBody = $body
      responseHeaders = Get-ResponseHeaders -Headers $resp.Headers
    }
  } catch {
    $responseBody = Truncate-Body -Body (Get-ResponseBody $_)
    $responseHeaders = $null
    if ($_.Exception -and $_.Exception.Response -and $_.Exception.Response.Headers) {
      $responseHeaders = Get-ResponseHeaders -Headers $_.Exception.Response.Headers
    }
    return @{
      ok = $false
      status = Get-StatusCode $_
      url = $url
      error = $_.Exception.Message
      responseBody = $responseBody
      responseHeaders = $responseHeaders
    }
  }
}

function Test-Web {
  param([string]$BaseUrl)
  $url = "$BaseUrl/"
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
    $ok = $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400
    return @{ ok = $ok; status = $resp.StatusCode; url = $url }
  } catch {
    return @{ ok = $false; status = Get-StatusCode $_; url = $url; error = $_.Exception.Message }
  }
}

function Resolve-BackendBaseUrl {
  param([string]$BaseUrl)
  if ($BaseUrl) { return $BaseUrl.TrimEnd("/") }
  $port = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "3000" }
  $candidate = "http://localhost:$port"
  $health = Test-Health -BaseUrl $candidate
  if ($health.ok) { return $candidate }
  $fallback = "http://localhost:3100"
  $fallbackHealth = Test-Health -BaseUrl $fallback
  if ($fallbackHealth.ok) { return $fallback }
  return $candidate
}

function Resolve-WebBaseUrl {
  param([string]$BaseUrl)
  if ($BaseUrl) { return $BaseUrl.TrimEnd("/") }
  $port = if ($env:WEB_PORT) { $env:WEB_PORT } else { "3001" }
  $candidate = "http://localhost:$port"
  $check = Test-Web -BaseUrl $candidate
  if ($check.ok) { return $candidate }
  $fallback = "http://localhost:3101"
  $fallbackCheck = Test-Web -BaseUrl $fallback
  if ($fallbackCheck.ok) { return $fallback }
  return $candidate
}

$backendBase = Resolve-BackendBaseUrl -BaseUrl $BackendBaseUrl
$webBase = Resolve-WebBaseUrl -BaseUrl $WebBaseUrl

$results = [ordered]@{
  ts = (Get-Date).ToString("o")
  backendBaseUrl = $backendBase
  webBaseUrl = $webBase
  steps = [ordered]@{}
}

$errors = @()
$exitCode = 0
$failedStep = $null
$unexpectedError = $null
$health = @{ ok = $false; status = $null; url = $null }
$authDetail = [ordered]@{}
$uploadDetail = [ordered]@{}
$uploadUnauthDetail = [ordered]@{}
$agentDetail = [ordered]@{}
$financialDetail = [ordered]@{}

try {

Write-Section "Backend: $backendBase"
Write-Section "Web: $webBase"

$health = Invoke-WithRetry -Operation { Test-Health -BaseUrl $backendBase } -MaxTries 5 -DelayMs 500
$results.steps.health = $health
if (-not $health.ok) {
  $errors += "health"
}

$creds = Resolve-Credentials
  $session = $null
  $tenantId = $null
  $tenantRole = $null
  $memberships = $null
  $authDetail = [ordered]@{}
  $authToken = $null
  $authCookie = $null
  $authUserId = $null
  $adminOverviewDetail = [ordered]@{}
  $adminUsersDetail = [ordered]@{}
  $adminRoleDetail = [ordered]@{}
  $adminAuditDetail = [ordered]@{}
  $adminTenantSwitchDetail = [ordered]@{}
  $tenantBootstrapDetail = [ordered]@{}
  $tenantSwitchDetail = [ordered]@{}
  $tenantIsolationDetail = [ordered]@{}
  $tenantRbacDetail = [ordered]@{}

if ($health.ok) {
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $loginPayload = @{ email = $creds.email; password = $creds.password } | ConvertTo-Json -Compress
  Write-Section "Login: $backendBase/api/auth/login"
  $loginResp = Invoke-WithRetry -Operation {
    $resp = Invoke-JsonRequest -Url "$backendBase/api/auth/login" -Method "POST" -Body $loginPayload -Session $session -TimeoutSec 10
    if ($resp.ok -and $resp.data -and $resp.data.ok -eq $false) { $resp.ok = $false }
    return $resp
  } -MaxTries 3 -DelayMs 300
  $loginData = Unwrap-Data -Payload $loginResp.data
  $authDetail.login = [ordered]@{
    ok = $loginResp.ok
    status = $loginResp.status
    url = $loginResp.url
    responseBody = $loginResp.responseBody
    responseHeaders = $loginResp.responseHeaders
    raw = $loginResp.data
  }

  if (-not $loginResp.ok -or ($loginResp.data -and $loginResp.data.ok -eq $false)) {
    $regEmail = New-RandomEmail
    $regPassword = New-RandomPassword
    $regPayload = @{ email = $regEmail; password = $regPassword } | ConvertTo-Json -Compress
    Write-Section "Register: $backendBase/api/auth/register ($regEmail)"
    $registerResp = Invoke-JsonRequest -Url "$backendBase/api/auth/register" -Method "POST" -Body $regPayload -Session $session -TimeoutSec 10
    $registerData = Unwrap-Data -Payload $registerResp.data
    $authDetail.register = [ordered]@{
      ok = $registerResp.ok
      status = $registerResp.status
      url = $registerResp.url
      responseBody = $registerResp.responseBody
      responseHeaders = $registerResp.responseHeaders
      raw = $registerResp.data
    }
    if ($registerResp.ok -and -not ($registerResp.data -and $registerResp.data.ok -eq $false)) {
      $authToken = Get-AuthToken -Payload $registerResp.data
      $authCookie = Convert-SetCookieHeader -SetCookie $registerResp.setCookie
      $authDetail.ok = $true
      $authDetail.via = "register"
      $authDetail.email = $regEmail
      $authDetail.status = $registerResp.status
      $tenantId = Get-ActiveTenantId -Payload $registerResp.data
      $authUserId = Get-UserId -Payload $registerResp.data
      $memberships = Get-Memberships -Payload $registerResp.data
    } else {
      $authDetail.ok = $false
      $authDetail.via = "register"
      $authDetail.status = $registerResp.status
      $authDetail.error = $registerResp.error
      $errors += "authLogin"
    }
  } else {
    $authToken = Get-AuthToken -Payload $loginResp.data
    $authCookie = Convert-SetCookieHeader -SetCookie $loginResp.setCookie
    $authDetail.ok = $true
    $authDetail.via = "login"
    $authDetail.email = $creds.email
    $authDetail.status = $loginResp.status
    $authDetail.source = $creds.source
    $tenantId = Get-ActiveTenantId -Payload $loginResp.data
    $authUserId = Get-UserId -Payload $loginResp.data
    $memberships = Get-Memberships -Payload $loginResp.data
  }

  if ($authDetail.ok) {
    Write-Section "Auth me: $backendBase/api/auth/me"
    $meResp = Invoke-WithRetry -Operation {
      $resp = Invoke-JsonRequest -Url "$backendBase/api/auth/me" -Method "GET" -Session $session -TimeoutSec 10
      if ($resp.ok -and $resp.data -and $resp.data.ok -eq $false) { $resp.ok = $false }
      return $resp
    } -MaxTries 3 -DelayMs 300
    $meData = Unwrap-Data -Payload $meResp.data
    if ($meResp.ok -and -not ($meResp.data -and $meResp.data.ok -eq $false)) {
      $tenantId = Get-ActiveTenantId -Payload $meResp.data
      $tenantRole = $meData?.tenantRole
      $authUserId = Get-UserId -Payload $meResp.data
      $memberships = Get-Memberships -Payload $meResp.data
      $authDetail.me = [ordered]@{
        ok = $true
        status = $meResp.status
        url = $meResp.url
        tenantId = $tenantId
        tenantRole = $tenantRole
        responseBody = $meResp.responseBody
        responseHeaders = $meResp.responseHeaders
        raw = $meResp.data
      }
    } else {
      $authDetail.me = [ordered]@{
        ok = $false
        status = $meResp.status
        url = $meResp.url
        error = $meResp.error
        responseBody = $meResp.responseBody
        responseHeaders = $meResp.responseHeaders
        raw = $meResp.data
      }
      $errors += "authMe"
    }
  }
} else {
  $authDetail.ok = $false
  $authDetail.reason = "health failed"
}

$results.steps.auth = $authDetail

if ($authDetail.ok -and -not $authCookie) {
  $authCookie = Get-CookieHeaderFromSession -Session $session -Url $backendBase
  if (-not $authCookie -and $webBase) {
    $authCookie = Get-CookieHeaderFromSession -Session $session -Url $webBase
  }
}

if ($authDetail.ok) {
  $adminHeaders = @{}
  if ($authToken) { $adminHeaders["Authorization"] = "Bearer $authToken" }
  if ($tenantId) { $adminHeaders["X-Tenant-Id"] = $tenantId }

  $adminTenantSwitchDetail = [ordered]@{ ok = $true; status = 200; skipped = $true }
  if ($tenantRole -ne "admin" -and $memberships) {
    $adminTenantId = $null
    foreach ($membership in @($memberships)) {
      if ($membership.role -eq "admin" -and $membership.tenantId -and $membership.tenantId -ne $tenantId) {
        $adminTenantId = $membership.tenantId
        break
      }
    }
    if ($adminTenantId) {
      $switchBody = @{ tenantId = $adminTenantId } | ConvertTo-Json -Compress
      Write-Section "Admin tenant switch: $backendBase/api/tenants/switch"
      $switchResp = Invoke-JsonRequest -Url "$backendBase/api/tenants/switch" -Method "POST" -Body $switchBody -Session $session -Headers $adminHeaders -TimeoutSec 10
      $adminTenantSwitchDetail = [ordered]@{
        ok = $switchResp.ok
        status = $switchResp.status
        url = $switchResp.url
        responseBody = $switchResp.responseBody
        responseHeaders = $switchResp.responseHeaders
        raw = $switchResp.data
        targetTenantId = $adminTenantId
      }
      if ($switchResp.ok) {
        $tenantId = $adminTenantId
        $tenantRole = "admin"
        $adminHeaders["X-Tenant-Id"] = $tenantId
      } else {
        $errors += "adminTenantSwitch"
      }
    }
  }

  Write-Section "Admin overview: $backendBase/api/admin/overview"
  $adminOverviewResp = Invoke-JsonRequest -Url "$backendBase/api/admin/overview" -Method "GET" -Session $session -Headers $adminHeaders -TimeoutSec 10
  $adminOverviewDetail = [ordered]@{
    ok = $adminOverviewResp.ok
    status = $adminOverviewResp.status
    url = $adminOverviewResp.url
    responseBody = $adminOverviewResp.responseBody
    responseHeaders = $adminOverviewResp.responseHeaders
    raw = $adminOverviewResp.data
  }

  if (-not $adminOverviewResp.ok -and $adminOverviewResp.status -eq 403) {
    $bootstrapStatus = Invoke-JsonRequest -Url "$backendBase/api/admin/bootstrap/status" -Method "GET" -Session $session -Headers $adminHeaders -TimeoutSec 10
    $bootstrapData = Unwrap-Data -Payload $bootstrapStatus.data
    if ($bootstrapStatus.ok -and $bootstrapData -and $bootstrapData.enabled) {
      $bootstrapToken = $env:ADMIN_BOOTSTRAP_CODE
      if (-not $bootstrapToken) { $bootstrapToken = $env:ADMIN_BOOTSTRAP_TOKEN }
      $bootstrapPayload = if ($bootstrapToken) { @{ token = $bootstrapToken } } else { @{} }
      $bootstrapBody = $bootstrapPayload | ConvertTo-Json -Compress
      $null = Invoke-JsonRequest -Url "$backendBase/api/admin/bootstrap" -Method "POST" -Body $bootstrapBody -Session $session -Headers $adminHeaders -TimeoutSec 10
      $adminOverviewResp = Invoke-JsonRequest -Url "$backendBase/api/admin/overview" -Method "GET" -Session $session -Headers $adminHeaders -TimeoutSec 10
      $adminOverviewDetail = [ordered]@{
        ok = $adminOverviewResp.ok
        status = $adminOverviewResp.status
        url = $adminOverviewResp.url
        responseBody = $adminOverviewResp.responseBody
        responseHeaders = $adminOverviewResp.responseHeaders
        raw = $adminOverviewResp.data
      }
    }
  }

  if (-not $adminOverviewDetail.ok) {
    $errors += "adminOverview"
  } else {
    Write-Section "Admin users: $backendBase/api/admin/users"
    $adminUsersResp = Invoke-JsonRequest -Url "$backendBase/api/admin/users" -Method "GET" -Session $session -Headers $adminHeaders -TimeoutSec 10
    $adminUsersData = Unwrap-Data -Payload $adminUsersResp.data
    $adminUsersDetail = [ordered]@{
      ok = $adminUsersResp.ok
      status = $adminUsersResp.status
      url = $adminUsersResp.url
      responseBody = $adminUsersResp.responseBody
      responseHeaders = $adminUsersResp.responseHeaders
      raw = $adminUsersResp.data
    }

    if (-not $adminUsersResp.ok) {
      $errors += "adminUsers"
    }

    $roleTarget = $null
    if ($adminUsersResp.ok -and $adminUsersData -and $adminUsersData.Count -gt 0) {
      $roleTarget = $adminUsersData[0]
    }

    if ($roleTarget -and $roleTarget.id) {
      $roleValue = if ($roleTarget.role) { $roleTarget.role } else { $roleTarget.tenantRole }
      if (-not $roleValue) { $roleValue = "user" }
      Write-Section ("Admin role change: " + $backendBase + "/api/admin/users/" + $roleTarget.id + "/role")
      $rolePayload = @{ role = $roleValue } | ConvertTo-Json -Compress
      $adminRoleResp = Invoke-JsonRequest -Url "$backendBase/api/admin/users/$($roleTarget.id)/role" -Method "PATCH" -Body $rolePayload -Session $session -Headers $adminHeaders -TimeoutSec 10
      $adminRoleDetail = [ordered]@{
        ok = $adminRoleResp.ok
        status = $adminRoleResp.status
        url = $adminRoleResp.url
        responseBody = $adminRoleResp.responseBody
        responseHeaders = $adminRoleResp.responseHeaders
        raw = $adminRoleResp.data
      }
      if (-not $adminRoleResp.ok) {
        $errors += "adminRole"
      }
    } else {
      $adminRoleDetail = [ordered]@{
        ok = $false
        status = 404
        url = "$backendBase/api/admin/users"
        responseBody = "No users returned"
        responseHeaders = @{}
      }
      $errors += "adminRole"
    }

    Write-Section "Admin audit: $backendBase/api/admin/audit"
    $adminAuditResp = Invoke-JsonRequest -Url "$backendBase/api/admin/audit?limit=25" -Method "GET" -Session $session -Headers $adminHeaders -TimeoutSec 10
    $adminAuditDetail = [ordered]@{
      ok = $adminAuditResp.ok
      status = $adminAuditResp.status
      url = $adminAuditResp.url
      responseBody = $adminAuditResp.responseBody
      responseHeaders = $adminAuditResp.responseHeaders
      raw = $adminAuditResp.data
    }
    if (-not $adminAuditResp.ok) {
      $errors += "adminAudit"
    }
  }
}

if ($authDetail.ok) {
  $tenantAId = $tenantId
  $tenantBootstrapDetail = [ordered]@{
    ok = $true
    status = 200
    url = "$backendBase/api/tenants"
    responseBody = $null
    responseHeaders = @{}
    raw = [ordered]@{}
  }

  if (-not $tenantAId) {
    $tenantBootstrapDetail.ok = $false
    $tenantBootstrapDetail.status = 400
    $tenantBootstrapDetail.responseBody = "Missing active tenant"
    $errors += "tenantBootstrap"
  } else {
    $tenantHeaders = @{}
    if ($authToken) { $tenantHeaders["Authorization"] = "Bearer $authToken" }
    $tenantHeaders["X-Tenant-Id"] = $tenantAId
    Write-Section "Tenant list: $backendBase/api/tenants"
    $tenantListResp = Invoke-JsonRequest -Url "$backendBase/api/tenants" -Method "GET" -Session $session -Headers $tenantHeaders -TimeoutSec 10
    $tenantListData = Unwrap-Data -Payload $tenantListResp.data
    $tenantBootstrapDetail.raw.tenants = $tenantListResp.data

    if (-not $tenantListResp.ok) {
      $tenantBootstrapDetail.ok = $false
      $tenantBootstrapDetail.status = $tenantListResp.status
      $tenantBootstrapDetail.url = $tenantListResp.url
      $tenantBootstrapDetail.responseBody = $tenantListResp.responseBody
      $tenantBootstrapDetail.responseHeaders = $tenantListResp.responseHeaders
      $errors += "tenantBootstrap"
    } else {
      $memberships = $tenantListData?.memberships
      $tenantBId = $null
      $tenantBRole = $null
      if ($memberships) {
        foreach ($membership in @($memberships)) {
          if ($membership.tenantId -ne $tenantAId) {
            $tenantBId = $membership.tenantId
            $tenantBRole = $membership.role
            break
          }
        }
      }

      if (-not $tenantBId) {
        $tenantCreateBody = @{ name = "Smoke Tenant B" } | ConvertTo-Json -Compress
        Write-Section "Tenant bootstrap create: $backendBase/api/tenants"
        $tenantCreateResp = Invoke-JsonRequest -Url "$backendBase/api/tenants" -Method "POST" -Body $tenantCreateBody -Session $session -Headers $tenantHeaders -TimeoutSec 10
        $tenantBootstrapDetail.raw.create = $tenantCreateResp.data
        if (-not $tenantCreateResp.ok) {
          $tenantBootstrapDetail.ok = $false
          $tenantBootstrapDetail.status = $tenantCreateResp.status
          $tenantBootstrapDetail.url = $tenantCreateResp.url
          $tenantBootstrapDetail.responseBody = $tenantCreateResp.responseBody
          $tenantBootstrapDetail.responseHeaders = $tenantCreateResp.responseHeaders
          $errors += "tenantBootstrap"
        } else {
          $tenantCreateData = Unwrap-Data -Payload $tenantCreateResp.data
          $tenantBId = Get-EntityId -Payload $tenantCreateResp.data
          if (-not $tenantBId) {
            $tenantBId = $tenantCreateData?.id
          }
          if (-not $tenantBId) {
            $tenantListResp = Invoke-JsonRequest -Url "$backendBase/api/tenants" -Method "GET" -Session $session -Headers $tenantHeaders -TimeoutSec 10
            $tenantListData = Unwrap-Data -Payload $tenantListResp.data
            $tenantBootstrapDetail.raw.tenants = $tenantListResp.data
            if ($tenantListResp.ok -and $tenantListData?.memberships) {
              foreach ($membership in @($tenantListData.memberships)) {
                if ($membership.tenantId -ne $tenantAId) {
                  $tenantBId = $membership.tenantId
                  $tenantBRole = $membership.role
                  break
                }
              }
            }
          }
        }
      }

      if (-not $tenantBId) {
        $tenantBootstrapDetail.ok = $false
        $tenantBootstrapDetail.status = 404
        $tenantBootstrapDetail.responseBody = "Tenant B not found"
        $errors += "tenantBootstrap"
      } else {
        if (-not $tenantBRole -and $tenantListData?.memberships) {
          foreach ($membership in @($tenantListData.memberships)) {
            if ($membership.tenantId -eq $tenantBId) {
              $tenantBRole = $membership.role
              break
            }
          }
        }

        if (-not $tenantBRole) { $tenantBRole = "admin" }
        $tenantBootstrapDetail.raw.tenantAId = $tenantAId
        $tenantBootstrapDetail.raw.tenantBId = $tenantBId
        $tenantBootstrapDetail.raw.tenantBRole = $tenantBRole

        if ($tenantBRole -ne "user" -and $authUserId) {
          $switchBody = @{ tenantId = $tenantBId } | ConvertTo-Json -Compress
          Write-Section "Tenant bootstrap switch: $backendBase/api/tenants/switch"
          $switchResp = Invoke-JsonRequest -Url "$backendBase/api/tenants/switch" -Method "POST" -Body $switchBody -Session $session -Headers $tenantHeaders -TimeoutSec 10
          $tenantBootstrapDetail.raw.switchToB = $switchResp.data
          if (-not $switchResp.ok) {
            $tenantBootstrapDetail.ok = $false
            $tenantBootstrapDetail.status = $switchResp.status
            $tenantBootstrapDetail.url = $switchResp.url
            $tenantBootstrapDetail.responseBody = $switchResp.responseBody
            $tenantBootstrapDetail.responseHeaders = $switchResp.responseHeaders
            $errors += "tenantBootstrap"
          } else {
            $tenantId = $tenantBId
            $roleHeaders = @{}
            if ($authToken) { $roleHeaders["Authorization"] = "Bearer $authToken" }
            $roleHeaders["X-Tenant-Id"] = $tenantBId
            $rolePayload = @{ role = "user" } | ConvertTo-Json -Compress
            Write-Section "Tenant bootstrap role update: $backendBase/api/admin/users/$authUserId/role"
            $roleResp = Invoke-JsonRequest -Url "$backendBase/api/admin/users/$authUserId/role" -Method "PATCH" -Body $rolePayload -Session $session -Headers $roleHeaders -TimeoutSec 10
            $tenantBootstrapDetail.raw.roleUpdate = $roleResp.data
            if (-not $roleResp.ok) {
              $tenantBootstrapDetail.ok = $false
              $tenantBootstrapDetail.status = $roleResp.status
              $tenantBootstrapDetail.url = $roleResp.url
              $tenantBootstrapDetail.responseBody = $roleResp.responseBody
              $tenantBootstrapDetail.responseHeaders = $roleResp.responseHeaders
              $errors += "tenantBootstrap"
            } else {
              $tenantBRole = "user"
              $tenantBootstrapDetail.raw.tenantBRole = "user"
            }

            $switchBackBody = @{ tenantId = $tenantAId } | ConvertTo-Json -Compress
            $switchBackResp = Invoke-JsonRequest -Url "$backendBase/api/tenants/switch" -Method "POST" -Body $switchBackBody -Session $session -Headers $roleHeaders -TimeoutSec 10
            $tenantBootstrapDetail.raw.switchBack = $switchBackResp.data
            if ($switchBackResp.ok) {
              $tenantId = $tenantAId
            } else {
              $tenantBootstrapDetail.ok = $false
              $tenantBootstrapDetail.status = $switchBackResp.status
              $tenantBootstrapDetail.url = $switchBackResp.url
              $tenantBootstrapDetail.responseBody = $switchBackResp.responseBody
              $tenantBootstrapDetail.responseHeaders = $switchBackResp.responseHeaders
              $errors += "tenantBootstrap"
            }
          }
        }

        if ($tenantBootstrapDetail.ok) {
          $tenantBootstrapDetail.status = $tenantListResp.status
          $tenantBootstrapDetail.url = $tenantListResp.url
          $tenantBootstrapDetail.responseBody = $tenantListResp.responseBody
          $tenantBootstrapDetail.responseHeaders = $tenantListResp.responseHeaders
        }
      }
    }
  }

  if ($tenantBootstrapDetail.ok) {
    $tenantSwitchDetail = [ordered]@{
      ok = $true
      status = 200
      url = "$backendBase/api/tenants/switch"
      responseBody = $null
      responseHeaders = @{}
      raw = [ordered]@{}
    }
    $tenantIsolationDetail = [ordered]@{
      ok = $true
      status = 200
      url = "$backendBase/api/agent/messages"
      responseBody = $null
      responseHeaders = @{}
      raw = [ordered]@{}
    }

    $tenantEventBody = @{ event_type = "tenant_isolation"; context = @{ scope = "tenantA"; ts = (Get-Date).ToString("o") } } | ConvertTo-Json -Compress
    Write-Section "Tenant isolation event: $backendBase/api/agent/events"
    $tenantEventResp = Invoke-JsonRequest -Url "$backendBase/api/agent/events" -Method "POST" -Body $tenantEventBody -Session $session -Headers @{ "X-Tenant-Id" = $tenantAId } -TimeoutSec 10
    $tenantEventData = Unwrap-Data -Payload $tenantEventResp.data
    $tenantEventCorrelationId = $tenantEventData?.correlationId
    if (-not $tenantEventCorrelationId -and $tenantEventResp.data?.data?.correlationId) {
      $tenantEventCorrelationId = $tenantEventResp.data.data.correlationId
    }
    $tenantIsolationDetail.raw.event = $tenantEventResp.data

    if (-not $tenantEventResp.ok -or -not $tenantEventCorrelationId) {
      $tenantIsolationDetail.ok = $false
      $tenantIsolationDetail.status = $tenantEventResp.status
      $tenantIsolationDetail.url = $tenantEventResp.url
      $tenantIsolationDetail.responseBody = $tenantEventResp.responseBody
      $tenantIsolationDetail.responseHeaders = $tenantEventResp.responseHeaders
      $errors += "tenantIsolation"
    } else {
      $switchBody = @{ tenantId = $tenantBootstrapDetail.raw.tenantBId } | ConvertTo-Json -Compress
      Write-Section "Tenant switch: $backendBase/api/tenants/switch"
      $switchResp = Invoke-JsonRequest -Url "$backendBase/api/tenants/switch" -Method "POST" -Body $switchBody -Session $session -Headers @{ "X-Tenant-Id" = $tenantAId } -TimeoutSec 10
      $tenantSwitchDetail = [ordered]@{
        ok = $switchResp.ok
        status = $switchResp.status
        url = $switchResp.url
        responseBody = $switchResp.responseBody
        responseHeaders = $switchResp.responseHeaders
        raw = [ordered]@{ toTenant = $tenantBootstrapDetail.raw.tenantBId }
      }
      if (-not $switchResp.ok) {
        $errors += "tenantSwitch"
      } else {
        $tenantId = $tenantBootstrapDetail.raw.tenantBId
        $rbacHeaders = @{}
        if ($authToken) { $rbacHeaders["Authorization"] = "Bearer $authToken" }
        $rbacHeaders["X-Tenant-Id"] = $tenantId
        $messagesResp = Invoke-JsonRequest -Url "$backendBase/api/agent/messages?correlationId=$tenantEventCorrelationId" -Method "GET" -Session $session -Headers $rbacHeaders -TimeoutSec 10
        $actionsResp = Invoke-JsonRequest -Url "$backendBase/api/agent/actions?correlationId=$tenantEventCorrelationId" -Method "GET" -Session $session -Headers $rbacHeaders -TimeoutSec 10
        $messagesData = Unwrap-Data -Payload $messagesResp.data
        $actionsData = Unwrap-Data -Payload $actionsResp.data
        $messagesCount = if ($messagesResp.ok) { ($messagesData | Measure-Object).Count } else { -1 }
        $actionsCount = if ($actionsResp.ok) { ($actionsData | Measure-Object).Count } else { -1 }
        $messagesEmpty = $messagesResp.ok -and ($messagesCount -eq 0)
        $actionsEmpty = $actionsResp.ok -and ($actionsCount -eq 0)
        $tenantIsolationDetail.raw.messages = $messagesResp.data
        $tenantIsolationDetail.raw.actions = $actionsResp.data
        $tenantIsolationDetail.ok = ($messagesEmpty -and $actionsEmpty)
        $tenantIsolationDetail.status = if ($messagesResp.ok) { $messagesResp.status } else { $messagesResp.status }
        $tenantIsolationDetail.url = $messagesResp.url
        $tenantIsolationDetail.responseBody = if ($messagesResp.responseBody) { $messagesResp.responseBody } else { $actionsResp.responseBody }
        $tenantIsolationDetail.responseHeaders = if ($messagesResp.responseHeaders) { $messagesResp.responseHeaders } else { $actionsResp.responseHeaders }
        if (-not $tenantIsolationDetail.ok) {
          $errors += "tenantIsolation"
        }

        Write-Section "Tenant RBAC check: $backendBase/api/admin/overview"
        $rbacResp = Invoke-JsonRequest -Url "$backendBase/api/admin/overview" -Method "GET" -Session $session -Headers $rbacHeaders -TimeoutSec 10
        $tenantRbacDetail = [ordered]@{
          ok = ($rbacResp.status -eq 403)
          status = $rbacResp.status
          url = $rbacResp.url
          responseBody = $rbacResp.responseBody
          responseHeaders = $rbacResp.responseHeaders
          raw = $rbacResp.data
        }
        if (-not $tenantRbacDetail.ok) {
          $errors += "tenantRbac"
        }

        $switchBackBody = @{ tenantId = $tenantAId } | ConvertTo-Json -Compress
        $switchBackResp = Invoke-JsonRequest -Url "$backendBase/api/tenants/switch" -Method "POST" -Body $switchBackBody -Session $session -Headers $rbacHeaders -TimeoutSec 10
        $tenantSwitchDetail.raw.back = $switchBackResp.data
        if ($switchBackResp.ok) {
          $tenantId = $tenantAId
        } else {
          $tenantSwitchDetail.ok = $false
          $tenantSwitchDetail.status = $switchBackResp.status
          $tenantSwitchDetail.url = $switchBackResp.url
          $tenantSwitchDetail.responseBody = $switchBackResp.responseBody
          $tenantSwitchDetail.responseHeaders = $switchBackResp.responseHeaders
          $errors += "tenantSwitch"
        }
      }
    }
  }
}

$results.steps.adminOverview = $adminOverviewDetail
$results.steps.adminUsers = $adminUsersDetail
$results.steps.adminRole = $adminRoleDetail
$results.steps.adminAudit = $adminAuditDetail
$results.steps.adminTenantSwitch = $adminTenantSwitchDetail
$results.steps.tenantBootstrap = $tenantBootstrapDetail
$results.steps.tenantSwitch = $tenantSwitchDetail
$results.steps.tenantIsolation = $tenantIsolationDetail
$results.steps.tenantRbac = $tenantRbacDetail

$headers = @{}
if ($tenantId) { $headers["X-Tenant-Id"] = $tenantId }

$uploadDetail = [ordered]@{}
$uploadUnauthDetail = [ordered]@{}
if ($webBase) {
  $tmpDir = Join-Path $PSScriptRoot "tmp"
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
  $tmpFile = Join-Path $tmpDir "smoke-upload.txt"
  "smoke test $(Get-Date -Format o)" | Out-File -Encoding ascii $tmpFile
  $uploadUrl = "$webBase/api/upload"

  Write-Section "Upload unauth: $uploadUrl"
  $curlAvailable = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curlAvailable) {
    $unauthHeaderPath = Join-Path $tmpDir "smoke-upload-unauth-headers.txt"
    $unauthBodyPath = Join-Path $tmpDir "smoke-upload-unauth-response.txt"
    if (Test-Path $unauthHeaderPath) { Remove-Item -Force $unauthHeaderPath }
    if (Test-Path $unauthBodyPath) { Remove-Item -Force $unauthBodyPath }
    $unauthStatusText = & curl.exe -s -D $unauthHeaderPath -o $unauthBodyPath -w "%{http_code}" -F "file=@$tmpFile" $uploadUrl
    $unauthExitCode = $LASTEXITCODE
    $unauthResponseBody = $null
    $unauthHeadersRaw = $null
    if (Test-Path $unauthBodyPath) { $unauthResponseBody = Get-Content -Raw $unauthBodyPath }
    if (Test-Path $unauthHeaderPath) { $unauthHeadersRaw = Get-Content -Raw $unauthHeaderPath }
    $unauthResponseBody = Truncate-Body -Body $unauthResponseBody
    $unauthHeaders = Convert-CurlHeaders -HeaderText $unauthHeadersRaw
    $unauthStatusCode = $null
    $unauthParsedStatus = 0
    if ([int]::TryParse(($unauthStatusText | Out-String).Trim(), [ref]$unauthParsedStatus)) {
      $unauthStatusCode = $unauthParsedStatus
    }
    $unauthJson = ConvertFrom-JsonSafe -Text $unauthResponseBody
    $unauthExpected = $false
    if ($unauthStatusCode -eq 401) {
      if ($unauthJson -and $unauthJson.error -eq "Unauthorized") {
        $unauthExpected = $true
      } elseif ($unauthResponseBody -match '"error"\s*:\s*"Unauthorized"') {
        $unauthExpected = $true
      }
    }

    if ($unauthExitCode -ne 0 -or -not $unauthStatusCode) {
      $uploadUnauthDetail = [ordered]@{
        ok = $false
        status = $unauthStatusCode
        url = $uploadUrl
        error = "curl.exe failed (exit $unauthExitCode)"
        responseBody = $unauthResponseBody
        responseHeaders = $unauthHeaders
      }
      $errors += "uploadUnauth"
    } elseif ($unauthExpected) {
      $uploadUnauthDetail = [ordered]@{
        ok = $true
        status = $unauthStatusCode
        url = $uploadUrl
        data = $unauthJson
        responseBody = $unauthResponseBody
        responseHeaders = $unauthHeaders
      }
    } else {
      $uploadUnauthDetail = [ordered]@{
        ok = $false
        status = $unauthStatusCode
        url = $uploadUrl
        error = "Expected 401 Unauthorized"
        responseBody = $unauthResponseBody
        responseHeaders = $unauthHeaders
      }
      $errors += "uploadUnauth"
    }
  } else {
    try {
      $unauthResp = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uploadUrl -Form @{ file = Get-Item $tmpFile } -TimeoutSec 30
      $unauthResponseBody = Truncate-Body -Body $unauthResp.Content
      $unauthJson = ConvertFrom-JsonSafe -Text $unauthResp.Content
      $unauthExpected = $unauthResp.StatusCode -eq 401 -and $unauthJson -and $unauthJson.error -eq "Unauthorized"
      if ($unauthExpected) {
        $uploadUnauthDetail = [ordered]@{
          ok = $true
          status = $unauthResp.StatusCode
          url = $uploadUrl
          data = $unauthJson
          responseBody = $unauthResponseBody
          responseHeaders = Get-ResponseHeaders -Headers $unauthResp.Headers
        }
      } else {
        $uploadUnauthDetail = [ordered]@{
          ok = $false
          status = $unauthResp.StatusCode
          url = $uploadUrl
          error = "Expected 401 Unauthorized"
          responseBody = $unauthResponseBody
          responseHeaders = Get-ResponseHeaders -Headers $unauthResp.Headers
        }
        $errors += "uploadUnauth"
      }
    } catch {
      $responseBody = Truncate-Body -Body (Get-ResponseBody $_)
      $responseHeaders = $null
      if ($_.Exception -and $_.Exception.Response -and $_.Exception.Response.Headers) {
        $responseHeaders = Get-ResponseHeaders -Headers $_.Exception.Response.Headers
      }
      $uploadUnauthDetail = [ordered]@{
        ok = $false
        status = Get-StatusCode $_
        url = $uploadUrl
        error = $_.Exception.Message
        responseBody = $responseBody
        responseHeaders = $responseHeaders
      }
      $errors += "uploadUnauth"
    }
  }

  $unauthStatusLabel = if ($uploadUnauthDetail.status) { $uploadUnauthDetail.status } else { "n/a" }
  $unauthSnippet = Format-BodySnippet -Body (Get-BodyText -Detail $uploadUnauthDetail) -MaxLen 200
  Write-Section ("Unauth upload: " + $unauthStatusLabel + " " + $unauthSnippet)

  $uploadHeaders = @{}
  $uploadAuthType = "none"
  if ($authToken) {
    $uploadHeaders["Authorization"] = "Bearer $authToken"
    $uploadAuthType = "bearer"
  } elseif ($authCookie) {
    $uploadHeaders["Cookie"] = $authCookie
    $uploadAuthType = "cookie"
  }
  if ($tenantId) { $uploadHeaders["X-Tenant-Id"] = $tenantId }
  Write-Section "Upload: $uploadUrl"
  $curlAvailable = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curlAvailable) {
    $headerPath = Join-Path $tmpDir "smoke-upload-headers.txt"
    $bodyPath = Join-Path $tmpDir "smoke-upload-response.txt"
    if (Test-Path $headerPath) { Remove-Item -Force $headerPath }
    if (Test-Path $bodyPath) { Remove-Item -Force $bodyPath }
    $curlArgs = @(
      "-s",
      "-D", $headerPath,
      "-o", $bodyPath,
      "-w", "%{http_code}"
    )
    if ($uploadHeaders["Authorization"]) {
      $curlArgs += @("-H", "Authorization: $($uploadHeaders["Authorization"])")
    }
    if ($uploadHeaders["Cookie"]) {
      $curlArgs += @("-H", "Cookie: $($uploadHeaders["Cookie"])")
    }
    if ($uploadHeaders["X-Tenant-Id"]) {
      $curlArgs += @("-H", "X-Tenant-Id: $($uploadHeaders["X-Tenant-Id"])")
    }
    $curlArgs += @("-F", "file=@$tmpFile", $uploadUrl)

    $statusText = & curl.exe @curlArgs
    $exitCode = $LASTEXITCODE
    $responseBody = $null
    $responseHeadersRaw = $null
    if (Test-Path $bodyPath) { $responseBody = Get-Content -Raw $bodyPath }
    if (Test-Path $headerPath) { $responseHeadersRaw = Get-Content -Raw $headerPath }
    $responseBody = Truncate-Body -Body $responseBody
    $responseHeaders = Convert-CurlHeaders -HeaderText $responseHeadersRaw
    $statusCode = $null
    $parsedStatus = 0
    if ([int]::TryParse(($statusText | Out-String).Trim(), [ref]$parsedStatus)) {
      $statusCode = $parsedStatus
    }
    $uploadJson = ConvertFrom-JsonSafe -Text $responseBody

    if ($exitCode -ne 0 -or -not $statusCode) {
      $uploadDetail = [ordered]@{
        ok = $false
        status = $statusCode
        url = $uploadUrl
        error = "curl.exe failed (exit $exitCode)"
        responseBody = $responseBody
        responseHeaders = $responseHeaders
        authType = $uploadAuthType
      }
      $errors += "upload"
    } elseif ($statusCode -ge 200 -and $statusCode -lt 300) {
      $uploadDetail = [ordered]@{
        ok = $true
        status = $statusCode
        url = $uploadUrl
        data = $uploadJson
        responseBody = $responseBody
        authType = $uploadAuthType
        responseHeaders = $responseHeaders
      }
    } else {
      $uploadDetail = [ordered]@{
        ok = $false
        status = $statusCode
        url = $uploadUrl
        error = "Upload failed with status $statusCode"
        responseBody = $responseBody
        responseHeaders = $responseHeaders
        authType = $uploadAuthType
      }
      $errors += "upload"
    }
  } else {
    try {
      $uploadResp = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uploadUrl -Form @{ file = Get-Item $tmpFile } -WebSession $session -Headers $uploadHeaders -TimeoutSec 30
      $uploadResponseBody = Truncate-Body -Body $uploadResp.Content
      $uploadJson = ConvertFrom-JsonSafe -Text $uploadResp.Content
      $uploadDetail = [ordered]@{
        ok = $true
        status = $uploadResp.StatusCode
        url = $uploadUrl
        data = $uploadJson
        responseBody = $uploadResponseBody
        authType = $uploadAuthType
        responseHeaders = Get-ResponseHeaders -Headers $uploadResp.Headers
      }
    } catch {
      $responseBody = Truncate-Body -Body (Get-ResponseBody $_)
      $responseHeaders = $null
      if ($_.Exception -and $_.Exception.Response -and $_.Exception.Response.Headers) {
        $responseHeaders = Get-ResponseHeaders -Headers $_.Exception.Response.Headers
      }
      $uploadDetail = [ordered]@{
        ok = $false
        status = Get-StatusCode $_
        url = $uploadUrl
        error = $_.Exception.Message
        responseBody = $responseBody
        responseHeaders = $responseHeaders
        authType = $uploadAuthType
      }
      $errors += "upload"
    }
  }

  if ($uploadDetail.ok) {
    $uploadId = $uploadDetail.data?.id
    $uploadFileUrl = $uploadDetail.data?.url
    $uploadSize = $uploadDetail.data?.size
    $uploadType = $uploadDetail.data?.type
    Write-Section ("Auth upload: " + $uploadDetail.status + " id=" + $uploadId + " url=" + $uploadFileUrl + " size=" + $uploadSize + " type=" + $uploadType)
  }
}
$results.steps.upload = $uploadDetail
$results.steps.uploadUnauth = $uploadUnauthDetail

$agentDetail = [ordered]@{}
if ($authDetail.ok) {
  $eventBody = @{ event_type = "payment_received"; context = @{ amount = 19.99; currency = "EUR"; page = "/smoke"; title = "smoke test" } } | ConvertTo-Json -Compress
  Write-Section "Agent event: $backendBase/api/agent/events"
  $eventResp = Invoke-JsonRequest -Url "$backendBase/api/agent/events" -Method "POST" -Body $eventBody -Session $session -Headers $headers -TimeoutSec 15
  $eventData = Unwrap-Data -Payload $eventResp.data
  $eventId = $null
  $eventCorrelationId = $null
  if ($eventData) {
    $eventId = $eventData.eventId
    $eventCorrelationId = $eventData.correlationId
  }
  if (-not $eventId -and $eventResp.data -and $eventResp.data.data) {
    $eventId = $eventResp.data.data.eventId
    $eventCorrelationId = $eventResp.data.data.correlationId
  }
  $agentDetail.event = [ordered]@{
    ok = ($eventResp.ok -and $eventId)
    status = $eventResp.status
    url = $eventResp.url
    eventId = $eventId
    correlationId = $eventCorrelationId
    responseBody = $eventResp.responseBody
    responseHeaders = $eventResp.responseHeaders
    raw = $eventResp.data
  }

  if ($eventResp.ok -and $eventId) {
    $dispatchBody = @{ eventId = $eventId } | ConvertTo-Json -Compress
    Write-Section "Agent dispatch: $backendBase/api/agent/dispatch"
    $dispatchResp = Invoke-JsonRequest -Url "$backendBase/api/agent/dispatch" -Method "POST" -Body $dispatchBody -Session $session -Headers $headers -TimeoutSec 20
    $dispatchData = Unwrap-Data -Payload $dispatchResp.data
    $dispatchCorrelationId = $null
    if ($dispatchData) {
      $dispatchCorrelationId = $dispatchData.correlationId
    }
    if (-not $dispatchCorrelationId -and $dispatchResp.data -and $dispatchResp.data.data) {
      $dispatchCorrelationId = $dispatchResp.data.data.correlationId
    }
    $agentDetail.dispatch = [ordered]@{
      ok = ($dispatchResp.ok -and $dispatchCorrelationId)
      status = $dispatchResp.status
      url = $dispatchResp.url
      correlationId = $dispatchCorrelationId
      responseBody = $dispatchResp.responseBody
      responseHeaders = $dispatchResp.responseHeaders
      raw = $dispatchResp.data
    }
    if (-not $agentDetail.dispatch.ok) {
      $errors += "agentDispatch"
    } else {
      $corrId = $dispatchCorrelationId
      $messagesUrl = "$backendBase/api/agent/messages?correlationId=$corrId"
      $actionsUrl = "$backendBase/api/agent/actions?correlationId=$corrId"
      Write-Section "Agent messages: $messagesUrl"
      $messagesResp = Invoke-JsonRequest -Url $messagesUrl -Method "GET" -Session $session -Headers $headers -TimeoutSec 10
      Write-Section "Agent actions: $actionsUrl"
      $actionsResp = Invoke-JsonRequest -Url $actionsUrl -Method "GET" -Session $session -Headers $headers -TimeoutSec 10
      $agentDetail.messages = [ordered]@{
        ok = $messagesResp.ok
        status = $messagesResp.status
        url = $messagesResp.url
        responseBody = $messagesResp.responseBody
        responseHeaders = $messagesResp.responseHeaders
        data = Unwrap-Data -Payload $messagesResp.data
      }
      $agentDetail.actions = [ordered]@{
        ok = $actionsResp.ok
        status = $actionsResp.status
        url = $actionsResp.url
        responseBody = $actionsResp.responseBody
        responseHeaders = $actionsResp.responseHeaders
        data = Unwrap-Data -Payload $actionsResp.data
      }
      if (-not $messagesResp.ok) { $errors += "agentMessages" }
      if (-not $actionsResp.ok) { $errors += "agentActions" }
    }
  } else {
    $errors += "agentEvent"
  }
} else {
  $agentDetail = @{ ok = $false; reason = "auth failed" }
}

$results.steps.agent = $agentDetail

$financialDetail = [ordered]@{}
if ($authDetail.ok) {
  $financialBody = @{ type = "payment_received"; amount = 12.34; currency = "EUR"; tags = @("smoke", "payment_received"); source = "smoke-agent-e2e" } | ConvertTo-Json -Compress
  Write-Section "Financial event: $backendBase/api/events/financial"
  $financialResp = Invoke-JsonRequest -Url "$backendBase/api/events/financial" -Method "POST" -Body $financialBody -Session $session -Headers $headers -TimeoutSec 15
  $financialDetail = [ordered]@{
    ok = $financialResp.ok
    status = $financialResp.status
    url = $financialResp.url
    responseBody = $financialResp.responseBody
    responseHeaders = $financialResp.responseHeaders
    raw = $financialResp.data
  }
  if (-not $financialResp.ok) {
    $errors += "financialEvent"
  }
} else {
  $financialDetail = [ordered]@{ ok = $false; reason = "auth failed" }
}

$results.steps.financialEvent = $financialDetail

} catch {
  $unexpectedError = $_
}

$summaryUpload = [ordered]@{
  unauth = [ordered]@{
    status = $uploadUnauthDetail.status
    ok = $uploadUnauthDetail.ok
    body = Get-BodyText -Detail $uploadUnauthDetail
  }
  auth = [ordered]@{
    status = $uploadDetail.status
    ok = $uploadDetail.ok
    id = $uploadDetail.data?.id
    url = $uploadDetail.data?.url
    size = $uploadDetail.data?.size
    type = $uploadDetail.data?.type
  }
}

$durationMs = [int]((Get-Date) - $startTime).TotalMilliseconds

if ($unexpectedError) {
  $exitCode = 12
  $failedStep = "unexpected"
  $errors += "unexpected"
  $results.unhandled = [ordered]@{
    message = $unexpectedError.Exception.Message
    detail = Truncate-Body -Body ($unexpectedError | Out-String)
  }
} else {
  $authLoginOk = $authDetail.ok -eq $true
  $authMeOk = $authDetail.me -and $authDetail.me.ok -eq $true
  $adminOverviewOk = $adminOverviewDetail.ok -eq $true
  $adminUsersOk = $adminUsersDetail.ok -eq $true
  $adminRoleOk = $adminRoleDetail.ok -eq $true
  $adminAuditOk = $adminAuditDetail.ok -eq $true
  $tenantBootstrapOk = $tenantBootstrapDetail.ok -eq $true
  $tenantSwitchOk = $tenantSwitchDetail.ok -eq $true
  $tenantIsolationOk = $tenantIsolationDetail.ok -eq $true
  $tenantRbacOk = $tenantRbacDetail.ok -eq $true
  $uploadUnauthOk = $uploadUnauthDetail.ok -eq $true
  $uploadOk = $uploadDetail.ok -eq $true
  $agentEventOk = $agentDetail.event -and $agentDetail.event.ok -eq $true
  $agentDispatchOk = $agentDetail.dispatch -and $agentDetail.dispatch.ok -eq $true
  $agentMessagesOk = $agentDetail.messages -and $agentDetail.messages.ok -eq $true
  $agentActionsOk = $agentDetail.actions -and $agentDetail.actions.ok -eq $true
  $financialOk = $financialDetail.ok -eq $true

  if (-not $health.ok) {
    $exitCode = 2
    $failedStep = "health"
  } elseif (-not $authLoginOk) {
    $exitCode = 3
    $failedStep = "auth-login"
  } elseif (-not $authMeOk) {
    $exitCode = 4
    $failedStep = "auth-me"
  } elseif (-not $adminOverviewOk) {
    $exitCode = 13
    $failedStep = "admin-overview"
  } elseif (-not $adminUsersOk) {
    $exitCode = 14
    $failedStep = "admin-users"
  } elseif (-not $adminRoleOk) {
    $exitCode = 15
    $failedStep = "admin-role"
  } elseif (-not $adminAuditOk) {
    $exitCode = 16
    $failedStep = "admin-audit"
  } elseif (-not $tenantBootstrapOk) {
    $exitCode = 20
    $failedStep = "tenant-bootstrap"
  } elseif (-not $tenantSwitchOk) {
    $exitCode = 21
    $failedStep = "tenant-switch"
  } elseif (-not $tenantIsolationOk) {
    $exitCode = 22
    $failedStep = "tenant-isolation"
  } elseif (-not $tenantRbacOk) {
    $exitCode = 23
    $failedStep = "tenant-rbac"
  } elseif (-not $uploadUnauthOk) {
    $exitCode = 5
    $failedStep = "upload-unauth"
  } elseif (-not $uploadOk) {
    $exitCode = 6
    $failedStep = "upload-auth"
  } elseif (-not $agentEventOk) {
    $exitCode = 7
    $failedStep = "agent-event"
  } elseif (-not $agentDispatchOk) {
    $exitCode = 8
    $failedStep = "agent-dispatch"
  } elseif (-not $agentMessagesOk) {
    $exitCode = 9
    $failedStep = "agent-messages"
  } elseif (-not $agentActionsOk) {
    $exitCode = 10
    $failedStep = "agent-actions"
  } elseif (-not $financialOk) {
    $exitCode = 11
    $failedStep = "financial-event"
  } else {
    $exitCode = 0
    $failedStep = $null
  }
}

$errors = $errors | Select-Object -Unique
if (-not $errors) { $errors = @() }

$results.durationMs = $durationMs
$results.exitCode = $exitCode
$results.failedStep = if ($exitCode -eq 0) { $null } else { $failedStep }

$summary = [ordered]@{
  ok = ($exitCode -eq 0)
  errors = $errors
  upload = $summaryUpload
}
$results.summary = $summary

$results | ConvertTo-Json -Depth 12 | Out-File -Encoding ascii $ResultPath

if ($exitCode -ne 0) {
  $failureDetail = switch ($failedStep) {
    "health" { $health }
    "auth-login" {
      if ($authDetail.register -and $authDetail.via -eq "register") { $authDetail.register } else { $authDetail.login }
    }
    "auth-me" { $authDetail.me }
    "admin-overview" { $adminOverviewDetail }
    "admin-users" { $adminUsersDetail }
    "admin-role" { $adminRoleDetail }
    "admin-audit" { $adminAuditDetail }
    "tenant-bootstrap" { $tenantBootstrapDetail }
    "tenant-switch" { $tenantSwitchDetail }
    "tenant-isolation" { $tenantIsolationDetail }
    "tenant-rbac" { $tenantRbacDetail }
    "upload-unauth" { $uploadUnauthDetail }
    "upload-auth" { $uploadDetail }
    "agent-event" { $agentDetail.event }
    "agent-dispatch" { $agentDetail.dispatch }
    "agent-messages" { $agentDetail.messages }
    "agent-actions" { $agentDetail.actions }
    "financial-event" { $financialDetail }
    default { @{ status = "n/a"; responseBody = $results.unhandled?.detail } }
  }
  Write-FailLine -StepName $failedStep -Detail $failureDetail -LogPath $ResultPath
  exit $exitCode
}

Write-Section ("PASS (took " + $durationMs + "ms) Log: " + $ResultPath)
exit 0
