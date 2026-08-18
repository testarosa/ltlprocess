# Internal TMS Quote Flow

Internal operator app for submitting quote requests, calling carrier APIs, storing normalized results, and loading persisted quote history in the frontend.

## Apps

- `apps/frontend`: Vite + React operator UI
- `apps/backend`: Express API, auth, carrier orchestration, SQLite persistence
- `packages/shared`: shared request/response types

## Quick Start

1. Install dependencies with `npm install`
2. Copy `.env.example` values into your shell or backend env file if you want persistent SQLite storage
3. Run `npm run dev`

The backend seeds four carrier adapters. If no carrier endpoint is configured, each adapter falls back to simulated responses so the full request -> store -> display flow still works.

To use live 3PL Systems rating, set `THREE_PL_CLIENT_ID` and `THREE_PL_CLIENT_SECRET`. The backend obtains and caches an OAuth token, requests rates from `/api/v1/rating`, and stores every returned carrier quote. When these credentials are present, the simulated adapters are replaced by the live 3PL Systems adapter.

To use Priority1 v2 LTL rating, set `PRIORITY1_API_KEY` and optionally `PRIORITY1_CUSTOMER_ID`. The backend sends normalized shipment data to `/v2/ltl/quotes/rates` with the required `X-API-KEY` header and stores valid and invalid carrier responses. Additional UI service labels can be mapped to Priority1 accessorial codes through `PRIORITY1_ACCESSORIAL_MAP`, a JSON object such as `{"Inside Pickup":"CUSTOM_CODE"}`.

Without `DB_FILE`, the backend uses in-memory SQLite for easier local startup. Set `DB_FILE` to a writable file path for persistent quote history.
