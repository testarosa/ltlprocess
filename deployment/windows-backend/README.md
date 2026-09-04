# Windows backend deployment kit

These files install the LTLTms Node backend as a Windows service. The scripts do not contain production passwords and do not migrate local demo quotes.

## Files

- `backend.env.example`: production environment template
- `preflight.ps1`: checks Node.js, npm, NSSM, ODBC, project files, `.env`, and SQL TCP connectivity
- `install-backend.ps1`: installs dependencies, builds, tests, installs or updates the NSSM service, and waits for a healthy API
- `verify-backend.ps1`: checks the Windows service, health endpoint, and a live SQL-backed ZIP lookup
- `iis-web.config`: IIS ARR reverse proxy and React Router fallback rules
- `create-package.ps1`: creates a clean ZIP without secrets, dependencies, build output, Git data, or local SQLite data

## 1. Create the package locally

From the repository root:

```powershell
.\deployment\windows-backend\create-package.ps1
```

The output is:

```text
artifacts\LTLTms-backend-deploy.zip
```

Copy this ZIP to the VM through an RDP redirected drive and extract it:

```powershell
New-Item -ItemType Directory -Force C:\Apps\LTLTms

Expand-Archive `
  -LiteralPath C:\Deploy\LTLTms-backend-deploy.zip `
  -DestinationPath C:\Apps\LTLTms `
  -Force
```

## 2. Create the production environment

On the VM:

```powershell
Copy-Item `
  C:\Apps\LTLTms\deployment\windows-backend\backend.env.example `
  C:\Apps\LTLTms\.env

notepad C:\Apps\LTLTms\.env
```

Replace every placeholder. Keep `SEED_DEMO_DATA=false`, use the restricted `ltltms_app` SQL login, and do not use `sa` as the application identity. When IIS and the backend share a server, leave `VITE_API_BASE_URL` empty so browser API calls use the IIS `/api` proxy. Set the `VITE_ENTRA_*` values before building the frontend.

Protect the finished file:

```powershell
icacls C:\Apps\LTLTms\.env /inheritance:r
icacls C:\Apps\LTLTms\.env /grant:r "Administrators:F" "SYSTEM:R"
```

If the service is later changed to a dedicated Windows account, grant that account read permission on `.env` and the application directory.

## 3. Install prerequisites

Install:

- Node.js 24 LTS x64 at `C:\Program Files\nodejs`
- Microsoft ODBC Driver 17 for SQL Server
- NSSM at `C:\Tools\nssm\nssm.exe`

IIS requires URL Rewrite and Application Request Routing when it will proxy `/api` to the backend.

## 4. Run preflight and installation

Use an elevated PowerShell window on the VM:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

Set-Location C:\Apps\LTLTms

.\deployment\windows-backend\preflight.ps1
.\deployment\windows-backend\install-backend.ps1
.\deployment\windows-backend\verify-backend.ps1
```

The backend listens only on:

```text
http://127.0.0.1:4000
```

Do not create a public firewall rule for port 4000.

## 5. Configure IIS

After building the frontend, copy the included IIS configuration into its published directory:

```powershell
Set-Location C:\Apps\LTLTms
& "C:\Program Files\nodejs\npm.cmd" run build --workspace @tms/frontend

Copy-Item `
  C:\Apps\LTLTms\deployment\windows-backend\iis-web.config `
  C:\Apps\LTLTms\apps\frontend\dist\web.config `
  -Force
```

At the IIS server level, enable ARR proxy. Bind the IIS site to HTTPS and point its physical path to `C:\Apps\LTLTms\apps\frontend\dist`.

For a combined IIS/backend server, leave the included `/api` rewrite target as `http://127.0.0.1:4000`. The backend intentionally listens only on loopback and does not require a public firewall rule.

## Updating an existing installation

Back up `.env`, extract the new clean ZIP over the application directory, and rerun:

```powershell
.\deployment\windows-backend\install-backend.ps1
.\deployment\windows-backend\verify-backend.ps1
```

The installer stops the existing service before replacing dependencies and build output, then restarts it and performs a health check.
