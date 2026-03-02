# ops/night-loop.ps1
# Keep backend running + run autopilot ticks (service-token) in loop

$ErrorActionPreference = "Continue"
$ROOT = "C:\Users\user\portal-global"
Set-Location $ROOT

$TENANT = "demo"
$TOKEN  = "dev-local-token"
$TENANT_HEADER = "x-tenant-id"
$TICK_EVERY_MIN = 30

$LOG_DIR = Join-Path $ROOT "logs"
$LOG = Join-Path $LOG_DIR "night-loop.log"
New-Item -ItemType Directory -Force $LOG_DIR | Out-Null

function Log($msg){
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $msg
  $line | Tee-Object -FilePath $LOG -Append
}

function IsUp($url){
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $url).StatusCode -eq 200 } catch { $false }
}

function Start-Backend(){
  Log "Starting Backend (dev:backend) with AUTOPILOT_SERVICE_TOKEN..."
  Start-Process pwsh -WorkingDirectory $ROOT -ArgumentList @(
    "-NoProfile","-ExecutionPolicy","Bypass",
    "-Command", "cd "$ROOT"; $env:AUTOPILOT_SERVICE_TOKEN="$TOKEN"; npm run dev:backend"
  ) | Out-Null
}

function Ensure-Backend(){
  if (-not (IsUp "http://127.0.0.1:3000/api/health")) { Start-Backend; Start-Sleep -Seconds 2 }
  for($i=0; $i -lt 30; $i++){
    if (IsUp "http://127.0.0.1:3000/api/health") { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Autopilot-Call([string]$url, [hashtable]$body){
  Add-Type -AssemblyName System.Net.Http
  $client=[System.Net.Http.HttpClient]::new()
  $client.DefaultRequestHeaders.Clear()
  $client.DefaultRequestHeaders.Add("x-service-token", $TOKEN)
  $client.DefaultRequestHeaders.Add($TENANT_HEADER, $TENANT)

  # include tenant in body ALWAYS
  if(-not $body.ContainsKey("tenantId")){ $body["tenantId"] = $TENANT }
  if(-not $body.ContainsKey("tenant")){ $body["tenant"] = $TENANT }

  $json = ($body | ConvertTo-Json -Compress)
  $content=[System.Net.Http.StringContent]::new($json,[System.Text.Encoding]::UTF8,"application/json")

  $resp = $client.PostAsync($url, $content).Result
  $text = $resp.Content.ReadAsStringAsync().Result
  $client.Dispose()
  return @{ status="$($resp.StatusCode) $($resp.StatusCode.value__)"; body=$text }
}

function Autopilot-Tick(){
  try {
    Log "Enable autopilot (tenant=$TENANT, header=$TENANT_HEADER)..."
    $en = Autopilot-Call "http://127.0.0.1:3000/api/autopilot/enable" @{ enabled = $true }
    Log ("Enable: {0} body={1}" -f $en.status, $en.body)

    Log "Tick autopilot..."
    $tk = Autopilot-Call "http://127.0.0.1:3000/api/autopilot/tick" @{}
    Log ("Tick: {0} body={1}" -f $tk.status, $tk.body)
  } catch {
    Log "Tick failed: $($_.Exception.Message)"
  }
}

Log "=== NIGHT LOOP START (header=$TENANT_HEADER) ==="
while($true){
  if (Ensure-Backend) { Autopilot-Tick } else { Log "Backend not healthy; will retry." }
  Log "Sleeping $TICK_EVERY_MIN minutes..."
  Start-Sleep -Seconds ($TICK_EVERY_MIN*60)
}
