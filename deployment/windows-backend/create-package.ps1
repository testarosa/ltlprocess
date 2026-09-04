[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$OutputPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path "artifacts\LTLTms-backend-deploy.zip")
)

$ErrorActionPreference = "Stop"
$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path $outputFullPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

if (Test-Path -LiteralPath $outputFullPath) {
  Remove-Item -LiteralPath $outputFullPath -Force
}

Push-Location $RepoRoot
try {
  & tar.exe `
    --exclude=.git `
    --exclude=.env `
    --exclude=.env.local `
    --exclude=.codex-run `
    --exclude=node_modules `
    --exclude=tmp `
    --exclude=artifacts `
    --exclude=apps/backend/data `
    --exclude=apps/backend/dist `
    --exclude=apps/frontend/dist `
    --exclude=packages/shared/dist `
    -a -c -f $outputFullPath .
  if ($LASTEXITCODE -ne 0) {
    throw "tar.exe failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

$archive = Get-Item -LiteralPath $outputFullPath
Write-Host "Created deployment package:" -ForegroundColor Green
Write-Host $archive.FullName
Write-Host ("Size: {0:N2} MB" -f ($archive.Length / 1MB))
