[CmdletBinding()]
param([string]$BaseUrl = "http://127.0.0.1:4000")

$ErrorActionPreference = "Stop"

$health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 10
if ($health.ok -ne $true) {
  throw "Unexpected backend health response."
}

$location = Invoke-RestMethod -Uri "$BaseUrl/api/locations/90210" -TimeoutSec 15
if ($location.zipCode -ne "90210") {
  throw "SQL-backed ZIP lookup failed."
}

Write-Host "Backend health passed." -ForegroundColor Green
Write-Host "ZIP 90210: $($location.cityName), $($location.stateCode)" -ForegroundColor Green
