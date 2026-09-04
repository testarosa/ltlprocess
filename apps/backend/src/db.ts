import sql from "mssql/msnodesqlv8.js";
import { config } from "./config.js";

let poolPromise: Promise<sql.ConnectionPool> | undefined;

export function getSqlPool(): Promise<sql.ConnectionPool> {
  const connectionConfig = { connectionString: config.sqlServerConnectionString } as unknown as sql.config;
  poolPromise ??= new sql.ConnectionPool(connectionConfig).connect();
  return poolPromise;
}

export async function initializeDatabase(): Promise<void> {
  const pool = await getSqlPool();
  await pool.request().batch(`
    SET XACT_ABORT ON;

    IF OBJECT_ID(N'dbo.quote_requests', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.quote_requests (
        id nvarchar(50) NOT NULL CONSTRAINT PK_quote_requests PRIMARY KEY,
        operator_name nvarchar(200) NOT NULL,
        origin nvarchar(300) NOT NULL,
        destination nvarchar(300) NOT NULL,
        shipment_date varchar(10) NOT NULL,
        weight_lbs decimal(18, 2) NOT NULL,
        request_payload nvarchar(max) NOT NULL,
        status varchar(20) NOT NULL,
        created_at datetime2(3) NOT NULL,
        updated_at datetime2(3) NOT NULL
      );
    END;

    IF OBJECT_ID(N'dbo.carrier_quotes', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.carrier_quotes (
        id uniqueidentifier NOT NULL CONSTRAINT PK_carrier_quotes PRIMARY KEY,
        quote_request_id nvarchar(50) NOT NULL,
        carrier_key nvarchar(300) NOT NULL,
        carrier_name nvarchar(300) NOT NULL,
        status varchar(20) NOT NULL,
        rate_amount decimal(18, 2) NULL,
        currency varchar(10) NULL,
        service_level nvarchar(300) NULL,
        transit_days int NULL,
        raw_response nvarchar(max) NULL,
        error_message nvarchar(max) NULL,
        requested_at datetime2(3) NOT NULL,
        responded_at datetime2(3) NULL,
        updated_at datetime2(3) NOT NULL,
        CONSTRAINT FK_carrier_quotes_quote_requests
          FOREIGN KEY (quote_request_id) REFERENCES dbo.quote_requests(id) ON DELETE CASCADE
      );
    END;

    IF OBJECT_ID(N'dbo.quote_number_sequences', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.quote_number_sequences (
        [year] int NOT NULL CONSTRAINT PK_quote_number_sequences PRIMARY KEY,
        last_number int NOT NULL
      );
    END;

    IF OBJECT_ID(N'dbo.USZipCodes', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.USZipCodes (
        zip_code varchar(5) NOT NULL CONSTRAINT PK_USZipCodes PRIMARY KEY,
        city_name nvarchar(100) NOT NULL,
        state_code char(2) NOT NULL,
        country_code char(2) NOT NULL
      );
    END;

    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.carrier_quotes')
        AND name = N'IX_carrier_quotes_quote_request_id'
    )
    BEGIN
      CREATE INDEX IX_carrier_quotes_quote_request_id
        ON dbo.carrier_quotes (quote_request_id, carrier_name);
    END;

    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.quote_requests')
        AND name = N'IX_quote_requests_created_at'
    )
    BEGIN
      CREATE INDEX IX_quote_requests_created_at
        ON dbo.quote_requests (created_at DESC);
    END;
  `);
}

export async function closeDatabase(): Promise<void> {
  if (!poolPromise) return;
  const pool = await poolPromise;
  poolPromise = undefined;
  await pool.close();
}
