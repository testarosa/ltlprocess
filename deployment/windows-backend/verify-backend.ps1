[CmdletBinding()]
param(
  [string]$ServiceName = "LTLTmsBackend",
  [string]$BaseUrl = "http://127.0.0.1:4000",
  [string]$LogDirectory = "C:\ProgramData\LTLTms\logs"
)

$ErrorActionPreference = "Stop"

$service = Get-Service -Name $ServiceName -ErrorAction Stop
Write-Host "Service: $($service.Name) / $($service.Status)" -ForegroundColor Cyan
if ($service.Status -ne "Running") {
  throw "$ServiceName is not running."
}

$health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 10
if ($health.ok -ne $true) {
  throw "Backend health endpoint returned an unexpected response."
}
Write-Host "[PASS] Health endpoint" -ForegroundColor Green

$location = Invoke-RestMethod -Uri "$BaseUrl/api/locations/90210" -TimeoutSec 15
if ($location.zipCode -ne "90210") {
  throw "ZIP lookup returned an unexpected response."
}
Write-Host "[PASS] SQL Server ZIP lookup: $($location.cityName), $($location.stateCode)" -ForegroundColor Green

$errorLog = Join-Path $LogDirectory "backend-error.log"
if ((Test-Path -LiteralPath $errorLog) -and (Get-Item -LiteralPath $errorLog).Length -gt 0) {
  Write-Host "The error log is not empty; review its latest entries:" -ForegroundColor Yellow
  Get-Content -LiteralPath $errorLog -Tail 20
}

Write-Host "Backend verification passed." -ForegroundColor Green
