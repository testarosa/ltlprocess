import sql from "mssql/msnodesqlv8.js";
import type { LocationLookup } from "@tms/shared";
import { getSqlPool } from "./db.js";

type LocationRow = LocationLookup;

export function isValidUsZipCode(zipCode: string): boolean {
  return /^\d{5}$/.test(zipCode);
}

export async function getLocationByZipCode(zipCode: string): Promise<LocationLookup | null> {
  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("zipCode", sql.VarChar(5), zipCode)
    .query<LocationRow>(`
      SELECT
        city_name AS cityName,
        state_code AS stateCode,
        zip_code AS zipCode,
        country_code AS countryCode
      FROM dbo.USZipCodes
      WHERE zip_code = @zipCode
    `);

  return result.recordset[0] ?? null;
}
