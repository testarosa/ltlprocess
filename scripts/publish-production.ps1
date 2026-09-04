[CmdletBinding()]
param(
  [string]$ComputerName = "20.115.91.30",
  [string]$UserName = "adminpls",
  [string]$ArchivePath = ""
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
  $ArchivePath = Join-Path $repositoryRoot "artifacts\LTLTms-backend-deploy.zip"
}
$archiveFullPath = [System.IO.Path]::GetFullPath($ArchivePath)
$expectedArchiveDirectory = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot "artifacts"))
if ((Split-Path $archiveFullPath) -ne $expectedArchiveDirectory) {
  throw "The deployment archive must be inside $expectedArchiveDirectory."
}
if (-not (Test-Path -LiteralPath $archiveFullPath)) {
  throw "Deployment archive not found: $archiveFullPath"
}

function Read-EnvironmentValue {
  param([Parameter(Mandatory = $true)][string]$Key)

  $line = @(".env", ".env.local") |
    ForEach-Object {
      $path = Join-Path $repositoryRoot $_
      if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path }
    } |
    Where-Object { $_ -match "^$([regex]::Escape($Key))=" } |
    Select-Object -Last 1
  if (-not $line) { return $null }
  $value = ($line -split "=", 2)[1].Trim()
  if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
    return $value.Substring(1, $value.Length - 2)
  }
  return $value
}

$roadrunnerApplicationId = Read-EnvironmentValue -Key "ROADRUNNER_APPLICATION_ID"
$roadrunnerApiKey = Read-EnvironmentValue -Key "ROADRUNNER_API_KEY"
$priorityOneTimeoutMs = Read-EnvironmentValue -Key "PRIORITY1_TIMEOUT_MS"
$wwexAuthUrl = Read-EnvironmentValue -Key "WWEX_AUTH_URL"
$wwexApiBaseUrl = Read-EnvironmentValue -Key "WWEX_API_BASE_URL"
$wwexClientId = Read-EnvironmentValue -Key "WWEX_CLIENT_ID"
$wwexClientSecret = Read-EnvironmentValue -Key "WWEX_CLIENT_SECRET"
$wwexAudience = Read-EnvironmentValue -Key "WWEX_AUDIENCE"
if ([string]::IsNullOrWhiteSpace($roadrunnerApplicationId) -or [string]::IsNullOrWhiteSpace($roadrunnerApiKey)) {
  throw "Local Roadrunner credentials are not configured."
}
if ($priorityOneTimeoutMs -notmatch '^\d+$') {
  throw "Local Priority1 timeout is not configured correctly."
}
if (@($wwexAuthUrl, $wwexApiBaseUrl, $wwexClientId, $wwexClientSecret, $wwexAudience) |
    Where-Object { [string]::IsNullOrWhiteSpace($_) }) {
  throw "Local WWEX production configuration is incomplete."
}

$productionCredential = Get-Credential -UserName $UserName -Message "Enter the password for the LTL TMS production server."
$sessionOptions = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
$productionSession = New-PSSession -ComputerName $ComputerName -UseSSL -Authentication Negotiate -Credential $productionCredential -SessionOption $sessionOptions

try {
  $remoteArchive = "C:\Deploy\LTLTms-backend-deploy.zip"
  Invoke-Command -Session $productionSession -ScriptBlock {
    $deployDirectory = [System.IO.Path]::GetFullPath("C:\Deploy")
    if ($deployDirectory -ne "C:\Deploy") { throw "Unexpected deployment directory." }
    New-Item -ItemType Directory -Force -Path $deployDirectory | Out-Null
  }

  Copy-Item -LiteralPath $archiveFullPath -Destination $remoteArchive -ToSession $productionSession -Force

  Invoke-Command -Session $productionSession -ArgumentList $remoteArchive, $roadrunnerApplicationId, $roadrunnerApiKey, $priorityOneTimeoutMs, $wwexAuthUrl, $wwexApiBaseUrl, $wwexClientId, $wwexClientSecret, $wwexAudience -ScriptBlock {
    param($Archive, $RoadrunnerApplicationId, $RoadrunnerApiKey, $PriorityOneTimeoutMs, $WwexAuthUrl, $WwexApiBaseUrl, $WwexClientId, $WwexClientSecret, $WwexAudience)

    $ErrorActionPreference = "Stop"
    $appRoot = [System.IO.Path]::GetFullPath("C:\Apps\LTLTms")
    if ($appRoot -ne "C:\Apps\LTLTms") { throw "Unexpected application directory." }
    if (-not (Test-Path -LiteralPath $appRoot)) { throw "Production application directory is missing." }

    $environmentFile = Join-Path $appRoot ".env"
    if (-not (Test-Path -LiteralPath $environmentFile)) { throw "Production environment file is missing." }
    $backupPath = "C:\Deploy\LTLTms.env.backup-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))"
    Copy-Item -LiteralPath $environmentFile -Destination $backupPath

    Expand-Archive -LiteralPath $Archive -DestinationPath $appRoot -Force

    $environmentLines = [System.Collections.Generic.List[string]]::new()
    $environmentLines.AddRange([string[]](Get-Content -LiteralPath $environmentFile))
    function Set-EnvironmentLine {
      param([string]$Key, [string]$Value)
      $replacement = "$Key=`"$($Value.Replace('`"', '\`"'))`""
      $found = $false
      for ($index = 0; $index -lt $environmentLines.Count; $index++) {
        if ($environmentLines[$index] -match "^$([regex]::Escape($Key))=") {
          $environmentLines[$index] = $replacement
          $found = $true
        }
      }
      if (-not $found) { $environmentLines.Add($replacement) }
    }
    Set-EnvironmentLine -Key "ROADRUNNER_APPLICATION_ID" -Value $RoadrunnerApplicationId
    Set-EnvironmentLine -Key "ROADRUNNER_API_KEY" -Value $RoadrunnerApiKey
    Set-EnvironmentLine -Key "PRIORITY1_TIMEOUT_MS" -Value $PriorityOneTimeoutMs
    Set-EnvironmentLine -Key "WWEX_AUTH_URL" -Value $WwexAuthUrl
    Set-EnvironmentLine -Key "WWEX_API_BASE_URL" -Value $WwexApiBaseUrl
    Set-EnvironmentLine -Key "WWEX_CLIENT_ID" -Value $WwexClientId
    Set-EnvironmentLine -Key "WWEX_CLIENT_SECRET" -Value $WwexClientSecret
    Set-EnvironmentLine -Key "WWEX_AUDIENCE" -Value $WwexAudience
    Set-Content -LiteralPath $environmentFile -Value $environmentLines -Encoding UTF8

    & (Join-Path $appRoot "deployment\windows-backend\install-backend.ps1") -RepoRoot $appRoot
    if ($LASTEXITCODE -ne 0) { throw "Backend installation failed." }

    $npmPath = "C:\Program Files\nodejs\npm.cmd"
    Push-Location $appRoot
    try {
      & $npmPath run build --workspace @tms/frontend
      if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
    }
    finally {
      Pop-Location
    }

    Copy-Item -LiteralPath (Join-Path $appRoot "deployment\windows-backend\iis-web.config") -Destination (Join-Path $appRoot "apps\frontend\dist\web.config") -Force
    & (Join-Path $appRoot "deployment\windows-backend\verify-backend.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Backend verification failed." }
  }

  $publicHealth = Invoke-RestMethod -Uri "https://ltl.pls-solutionsinc.com/api/health" -TimeoutSec 20
  if ($publicHealth.ok -ne $true) { throw "Public health check failed." }
  Write-Host "Production deployment completed successfully." -ForegroundColor Green
}
finally {
  if ($productionSession) { Remove-PSSession $productionSession }
}
