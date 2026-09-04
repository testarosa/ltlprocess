[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$SqlHost = "20.115.91.30",
  [int]$SqlPort = 1433,
  [string]$NodePath = "C:\Program Files\nodejs\node.exe",
  [string]$NssmPath = "C:\Tools\nssm\nssm.exe"
)

$ErrorActionPreference = "Stop"
$failures = [System.Collections.Generic.List[string]]::new()

function Test-RequiredPath {
  param([string]$Path, [string]$Label)
  if (Test-Path -LiteralPath $Path) {
    Write-Host "[PASS] $Label" -ForegroundColor Green
  }
  else {
    Write-Host "[FAIL] $Label - missing: $Path" -ForegroundColor Red
    $failures.Add($Label)
  }
}

Write-Host "LTLTms backend preflight" -ForegroundColor Cyan
Write-Host "Repository: $RepoRoot"

Test-RequiredPath -Path $NodePath -Label "Node.js"
Test-RequiredPath -Path (Join-Path (Split-Path $NodePath) "npm.cmd") -Label "npm"
Test-RequiredPath -Path $NssmPath -Label "NSSM"
Test-RequiredPath -Path (Join-Path $RepoRoot "package.json") -Label "Root package.json"
Test-RequiredPath -Path (Join-Path $RepoRoot "apps\backend\package.json") -Label "Backend workspace"
Test-RequiredPath -Path (Join-Path $RepoRoot "packages\shared\package.json") -Label "Shared workspace"
Test-RequiredPath -Path (Join-Path $RepoRoot ".env") -Label "Production .env"

$odbcDriver = Get-OdbcDriver -ErrorAction SilentlyContinue |
  Where-Object Name -Like "*ODBC Driver 17 for SQL Server*" |
  Select-Object -First 1
if ($odbcDriver) {
  Write-Host "[PASS] ODBC Driver 17 for SQL Server" -ForegroundColor Green
}
else {
  Write-Host "[FAIL] ODBC Driver 17 for SQL Server is not installed" -ForegroundColor Red
  $failures.Add("ODBC Driver 17")
}

$sqlConnection = Test-NetConnection -ComputerName $SqlHost -Port $SqlPort -WarningAction SilentlyContinue
if ($sqlConnection.TcpTestSucceeded) {
  Write-Host "[PASS] SQL Server TCP connection to ${SqlHost}:$SqlPort" -ForegroundColor Green
}
else {
  Write-Host "[FAIL] Cannot reach SQL Server at ${SqlHost}:$SqlPort" -ForegroundColor Red
  $failures.Add("SQL Server network")
}

if ($failures.Count -gt 0) {
  throw "Preflight failed: $($failures -join ', ')"
}

Write-Host "All backend prerequisites passed." -ForegroundColor Green
