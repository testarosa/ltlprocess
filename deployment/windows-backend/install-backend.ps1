[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$ServiceName = "LTLTmsBackend",
  [string]$NodePath = "C:\Program Files\nodejs\node.exe",
  [string]$NssmPath = "C:\Tools\nssm\nssm.exe",
  [string]$LogDirectory = "C:\ProgramData\LTLTms\logs",
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  # Merge native stderr into normal output so non-fatal npm warnings do not
  # become terminating ErrorRecords when this installer runs through WinRM.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $commandOutput = & $FilePath @Arguments 2>&1
    $commandExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $commandOutput | ForEach-Object { Write-Host $_ }
  if ($commandExitCode -ne 0) {
    throw "Command failed with exit code ${commandExitCode}: $FilePath $($Arguments -join ' ')"
  }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated PowerShell window."
}

$npmPath = Join-Path (Split-Path $NodePath) "npm.cmd"
$backendEntry = Join-Path $RepoRoot "apps\backend\dist\index.js"
$envFile = Join-Path $RepoRoot ".env"

foreach ($requiredPath in @($NodePath, $npmPath, $NssmPath, $envFile, (Join-Path $RepoRoot "package.json"))) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required file is missing: $requiredPath"
  }
}

$environmentLines = Get-Content -LiteralPath $envFile
if (-not ($environmentLines -match '^SQL_SERVER_CONNECTION_STRING=.+')) {
  throw "The production .env is missing SQL_SERVER_CONNECTION_STRING."
}
if (-not ($environmentLines -match '^SEED_DEMO_DATA=false$')) {
  throw "Production requires SEED_DEMO_DATA=false in .env."
}

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService -and $existingService.Status -ne "Stopped") {
  Write-Host "Stopping $ServiceName..." -ForegroundColor Cyan
  Stop-Service -Name $ServiceName -Force
  (Get-Service -Name $ServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
}

Push-Location $RepoRoot
try {
  Write-Host "Installing Node dependencies..." -ForegroundColor Cyan
  Invoke-External $npmPath "ci"

  Write-Host "Building shared package and backend..." -ForegroundColor Cyan
  Invoke-External $npmPath "run" "build" "--workspace" "@tms/shared"
  Invoke-External $npmPath "run" "build" "--workspace" "@tms/backend"

  if (-not $SkipTests) {
    Write-Host "Running backend tests..." -ForegroundColor Cyan
    Invoke-External $npmPath "test"
  }
}
finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $backendEntry)) {
  throw "Backend build output was not created: $backendEntry"
}

if (-not $existingService) {
  Write-Host "Installing Windows service $ServiceName..." -ForegroundColor Cyan
  Invoke-External $NssmPath "install" $ServiceName $NodePath $backendEntry
}

Invoke-External $NssmPath "set" $ServiceName "Application" $NodePath
Invoke-External $NssmPath "set" $ServiceName "AppParameters" "`"$backendEntry`""
Invoke-External $NssmPath "set" $ServiceName "AppDirectory" $RepoRoot
Invoke-External $NssmPath "set" $ServiceName "AppStdout" (Join-Path $LogDirectory "backend-out.log")
Invoke-External $NssmPath "set" $ServiceName "AppStderr" (Join-Path $LogDirectory "backend-error.log")
Invoke-External $NssmPath "set" $ServiceName "AppRotateFiles" "1"
Invoke-External $NssmPath "set" $ServiceName "AppRotateBytes" "10485760"
Invoke-External $NssmPath "set" $ServiceName "AppExit" "Default" "Restart"
Invoke-External $NssmPath "set" $ServiceName "Start" "SERVICE_AUTO_START"

Write-Host "Starting $ServiceName..." -ForegroundColor Cyan
Start-Service -Name $ServiceName

$healthUri = "http://127.0.0.1:4000/api/health"
$deadline = [DateTime]::UtcNow.AddSeconds(45)
$healthy = $false
while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 3
    if ($health.ok -eq $true) {
      $healthy = $true
      break
    }
  }
  catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $healthy) {
  Write-Host "Backend error log:" -ForegroundColor Yellow
  Get-Content -LiteralPath (Join-Path $LogDirectory "backend-error.log") -Tail 50 -ErrorAction SilentlyContinue
  throw "The backend did not become healthy at $healthUri."
}

Write-Host "$ServiceName is installed, running, and healthy." -ForegroundColor Green
Write-Host "Configure its Log On account in services.msc if a dedicated service identity is required." -ForegroundColor Yellow
