import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

const dbPath = config.dbFile === ":memory:" ? ":memory:" : resolve(config.dbFile);
if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS quote_requests (
    id TEXT PRIMARY KEY,
    operator_name TEXT NOT NULL,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    shipment_date TEXT NOT NULL,
    weight_lbs REAL NOT NULL,
    request_payload TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS carrier_quotes (
    id TEXT PRIMARY KEY,
    quote_request_id TEXT NOT NULL,
    carrier_key TEXT NOT NULL,
    carrier_name TEXT NOT NULL,
    status TEXT NOT NULL,
    rate_amount REAL,
    currency TEXT,
    service_level TEXT,
    transit_days INTEGER,
    raw_response TEXT,
    error_message TEXT,
    requested_at TEXT NOT NULL,
    responded_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id)
  );
`);

const quoteRequestColumns = db.prepare("PRAGMA table_info(quote_requests)").all() as Array<{ name: string }>;
if (!quoteRequestColumns.some((column) => column.name === "request_payload")) {
  db.exec("ALTER TABLE quote_requests ADD COLUMN request_payload TEXT");
}
