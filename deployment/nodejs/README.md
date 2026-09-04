# Prebuilt Node.js backend deployment

This package contains compiled JavaScript. TypeScript and source compilation are not required on the VM.

## VM prerequisites

- Node.js 24 LTS x64
- Microsoft ODBC Driver 17 for SQL Server
- Outbound TCP 1433 access to the SQL Server

## Install

Extract `LTLTms-nodejs-deploy.zip` to `C:\Apps\LTLTms`, then run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
Set-Location C:\Apps\LTLTms

.\deployment\nodejs\install-production.ps1
```

The first run creates `.env` and stops. Edit it:

```powershell
notepad C:\Apps\LTLTms\.env
```

Replace all placeholders, keep `SEED_DEMO_DATA=false`, and run installation again:

```powershell
.\deployment\nodejs\install-production.ps1
```

## Start and verify

Start interactively:

```powershell
.\deployment\nodejs\start-backend.ps1
```

In a second PowerShell window:

```powershell
.\deployment\nodejs\health-check.ps1
```

For a persistent Windows service, use the NSSM installer in `deployment\windows-backend\install-backend.ps1` from the full deployment kit.

The backend binds to `127.0.0.1:4000`. Do not expose port 4000 publicly.
