[CmdletBinding()]
param(
  [string]$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$NodePath = "C:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = "Stop"
$npmPath = Join-Path (Split-Path $NodePath) "npm.cmd"
$backendEntry = Join-Path $AppRoot "apps\backend\dist\index.js"
$envFile = Join-Path $AppRoot ".env"
$envTemplate = Join-Path $AppRoot "deployment\nodejs\backend.env.example"

foreach ($path in @($NodePath, $npmPath, $backendEntry, (Join-Path $AppRoot "package-lock.json"))) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required deployment file is missing: $path"
  }
}

$nodeMajor = [int]((& $NodePath --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) {
  throw "Node.js 22 or newer is required. Node.js 24 LTS is recommended."
}

if (-not (Test-Path -LiteralPath $envFile)) {
  Copy-Item -LiteralPath $envTemplate -Destination $envFile
  Write-Host "Created $envFile from the template." -ForegroundColor Yellow
  Write-Host "Edit every placeholder in .env, then run this script again." -ForegroundColor Yellow
  exit 2
}

$environmentLines = Get-Content -LiteralPath $envFile
if ($environmentLines -match 'REPLACE_WITH_|tms\.yourcompany\.com') {
  throw "The .env file still contains deployment placeholders."
}
if (-not ($environmentLines -match '^SEED_DEMO_DATA=false$')) {
  throw "Production requires SEED_DEMO_DATA=false."
}

Push-Location $AppRoot
try {
  Write-Host "Installing production Node.js dependencies..." -ForegroundColor Cyan
  & $npmPath "ci" "--omit=dev" "--workspace" "@tms/backend" "--workspace" "@tms/shared"
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

Write-Host "Production dependencies installed." -ForegroundColor Green
Write-Host "Start with: .\deployment\nodejs\start-backend.ps1" -ForegroundColor Green
