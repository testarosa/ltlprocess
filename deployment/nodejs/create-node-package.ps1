[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$OutputPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path "artifacts\LTLTms-nodejs-deploy.zip")
)

$ErrorActionPreference = "Stop"
$npmPath = "C:\Program Files\nodejs\npm.cmd"
$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path $outputFullPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

Push-Location $RepoRoot
try {
  & $npmPath "run" "build" "--workspace" "@tms/shared"
  if ($LASTEXITCODE -ne 0) { throw "Shared package build failed." }

  & $npmPath "run" "build" "--workspace" "@tms/backend"
  if ($LASTEXITCODE -ne 0) { throw "Backend build failed." }

  if (Test-Path -LiteralPath $outputFullPath) {
    Remove-Item -LiteralPath $outputFullPath -Force
  }

  & tar.exe -a -c -f $outputFullPath `
    package.json `
    package-lock.json `
    apps/backend/package.json `
    apps/backend/dist `
    packages/shared/package.json `
    packages/shared/dist `
    deployment/nodejs
  if ($LASTEXITCODE -ne 0) { throw "Deployment archive creation failed." }
}
finally {
  Pop-Location
}

$archive = Get-Item -LiteralPath $outputFullPath
Write-Host "Created prebuilt Node.js package:" -ForegroundColor Green
Write-Host $archive.FullName
Write-Host ("Size: {0:N2} MB" -f ($archive.Length / 1MB))
