# Internal TMS Quote Flow

Internal operator app for submitting quote requests, calling carrier APIs, storing normalized results, and loading persisted quote history in the frontend.

## Apps

- `apps/frontend`: Vite + React operator UI
- `apps/backend`: Express API, auth, carrier orchestration, and SQL Server persistence
- `packages/shared`: shared request/response types

## Quick Start

1. Install dependencies with `npm install`
2. Copy `.env.example` values into your shell or backend env file and configure SQL Server Express
3. Run `npm run dev`

The backend seeds four carrier adapters. If no carrier endpoint is configured, each adapter falls back to simulated responses so the full request -> store -> display flow still works.

To use live 3PL Systems rating, set the customer-specific `THREE_PL_CLIENT_ID` and `THREE_PL_CLIENT_SECRET` generated from the customer profile's API Keys page. The backend obtains and caches an OAuth client-credentials token from `/connect/token`, resolves configured services through `/api/v1/accessorial`, requests rates from `/api/v1/rating`, and stores every returned carrier quote. `THREE_PL_BASE_URL` can be changed when the integrating brokerage provides a different Brokerware URL. When these credentials are present, the simulated adapters are replaced by the live 3PL Systems adapter.

To use Priority1 v2 LTL rating, set `PRIORITY1_API_KEY` and optionally `PRIORITY1_CUSTOMER_ID`. The backend sends normalized shipment data to `/v2/ltl/quotes/rates` with the required `X-API-KEY` header and stores valid and invalid carrier responses. Additional UI service labels can be mapped to Priority1 accessorial codes through `PRIORITY1_ACCESSORIAL_MAP`, a JSON object such as `{"Inside Pickup":"CUSTOM_CODE"}`.

To use the Roadrunner SOAP Rate Quote V2 service, set the issued `ROADRUNNER_APPLICATION_ID` and `ROADRUNNER_API_KEY`. The adapter maps these values to the WSDL's `UserName` and `Password` SOAP authentication fields respectively. Set `ROADRUNNER_ACCOUNT` only when rating with a related sub-account; this selects the `RateQuoteByAccountV2` operations. `ROADRUNNER_SITE` is optional. Selecting Guaranteed Service on Create Quote automatically uses the corresponding `WithGuarV2` operation. Additional UI labels can be mapped to Roadrunner's three-character service codes with `ROADRUNNER_ACCESSORIAL_MAP`.

To use WWEX Speedship V4 production, set `WWEX_CLIENT_ID` and `WWEX_CLIENT_SECRET`. The backend obtains and caches an OAuth client-credentials token using the configured audience, submits LTL quotes to `/svc/shopFlow`, and stores each returned carrier offer. The default auth and API URLs point to WWEX production and can be overridden with `WWEX_AUTH_URL` and `WWEX_API_BASE_URL`. WWEX hazmat rating is rejected until the quote form collects its required hazard-identification and emergency-contact fields.

To use Forward Air Expedited LTL rating, set `FORWARD_AIR_USER`, `FORWARD_AIR_PASSWORD`, `FORWARD_AIR_CUSTOMER_ID`, and `FORWARD_AIR_BILL_TO_NUMBER`. The adapter submits the documented XML quote payload to the Forward Air v2 REST endpoint and stores the returned total, transit days, and raw charge details. `FORWARD_AIR_SHIPPER_NUMBER` defaults to the bill-to account. The production API is used by default; set `FORWARD_AIR_BASE_URL=https://test-api.forwardair.com` for test credentials. Additional UI labels can be mapped to three-character service codes with `FORWARD_AIR_PICKUP_ACCESSORIAL_MAP` and `FORWARD_AIR_DELIVERY_ACCESSORIAL_MAP`.

All application data is stored in SQL Server. On startup, the backend creates the quote, carrier quote, and quote-number sequence tables when they do not exist. The `LTLTms` database itself must already exist.

Demo quotes are disabled by default. Set `SEED_DEMO_DATA=true` only in a disposable development database.

## SQL Server Express setup

Import ZIP reference data into the local SQL Server instance. This also creates the `LTLTms` database when necessary:

```powershell
.\scripts\import-us-zips.ps1 -CsvPath 'C:\path\to\uszips.csv'
```

Set `SQL_SERVER_CONNECTION_STRING` when SQL Server is not the default local `LTLTms` database on `.\SQLEXPRESS`. Look up a ZIP with `GET /api/locations/:zipCode`:

```http
GET /api/locations/90210
```

The response contains `cityName`, `stateCode`, `zipCode`, and `countryCode`. On the quote form, entering a five-digit pickup or delivery ZIP automatically fills the matching city, state, and country.

## Migrate existing SQLite quote history

Stop the backend before migrating, make a backup of both databases, and run the idempotent migration once:

```powershell
npm run migrate:sqlite -- --file "C:\path\to\tms.sqlite"
```

The migration inserts missing quote requests and carrier quotes, preserves their IDs and timestamps, and advances SQL Server quote-number sequences so new quote IDs do not collide. Existing SQL Server rows are left unchanged. After verifying the migrated row counts, remove `DB_FILE` from older environment files. `LEGACY_SQLITE_FILE` is optional and is used only by the migration command.
