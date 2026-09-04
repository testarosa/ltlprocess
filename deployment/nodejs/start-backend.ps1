[CmdletBinding()]
param(
  [string]$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$NodePath = "C:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = "Stop"
$backendEntry = Join-Path $AppRoot "apps\backend\dist\index.js"

if (-not (Test-Path -LiteralPath (Join-Path $AppRoot ".env"))) {
  throw "Missing production environment file: $AppRoot\.env"
}
if (-not (Test-Path -LiteralPath $backendEntry)) {
  throw "Missing compiled backend: $backendEntry"
}

Set-Location $AppRoot
& $NodePath $backendEntry
exit $LASTEXITCODE
