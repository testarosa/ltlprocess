param(
  [Parameter(Mandatory = $true)]
  [string]$CsvPath,
  [string]$Server = ".\SQLEXPRESS",
  [string]$Database = "LTLTms"
)

$ErrorActionPreference = "Stop"
$resolvedCsvPath = (Resolve-Path -LiteralPath $CsvPath).Path
$masterConnectionString = "Server=$Server;Database=master;Integrated Security=True;TrustServerCertificate=True"
$databaseConnectionString = "Server=$Server;Database=$Database;Integrated Security=True;TrustServerCertificate=True"

$masterConnection = [System.Data.SqlClient.SqlConnection]::new($masterConnectionString)
$masterConnection.Open()
try {
  $createDatabase = $masterConnection.CreateCommand()
  $createDatabase.CommandText = @"
IF DB_ID(@databaseName) IS NULL
BEGIN
  DECLARE @statement nvarchar(300) = N'CREATE DATABASE ' + QUOTENAME(@databaseName);
  EXEC sys.sp_executesql @statement;
END;
"@
  [void]$createDatabase.Parameters.Add("@databaseName", [System.Data.SqlDbType]::NVarChar, 128)
  $createDatabase.Parameters["@databaseName"].Value = $Database
  [void]$createDatabase.ExecuteNonQuery()
}
finally {
  $masterConnection.Dispose()
}

$connection = [System.Data.SqlClient.SqlConnection]::new($databaseConnectionString)
$connection.Open()
try {
  $setup = $connection.CreateCommand()
  $setup.CommandText = @"
IF OBJECT_ID('dbo.USZipCodes', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.USZipCodes (
    zip_code varchar(5) NOT NULL CONSTRAINT PK_USZipCodes PRIMARY KEY,
    city_name nvarchar(100) NOT NULL,
    state_code char(2) NOT NULL,
    country_code char(2) NOT NULL
  );
END;

IF OBJECT_ID('dbo.USZipCodes_Import', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.USZipCodes_Import (
    zip_code varchar(5) NOT NULL,
    city_name nvarchar(100) NOT NULL,
    state_code char(2) NOT NULL,
    country_code char(2) NOT NULL
  );
END;

TRUNCATE TABLE dbo.USZipCodes_Import;
"@
  [void]$setup.ExecuteNonQuery()

  $data = [System.Data.DataTable]::new()
  [void]$data.Columns.Add("zip_code", [string])
  [void]$data.Columns.Add("city_name", [string])
  [void]$data.Columns.Add("state_code", [string])
  [void]$data.Columns.Add("country_code", [string])

  foreach ($sourceRow in (Import-Csv -LiteralPath $resolvedCsvPath)) {
    $row = $data.NewRow()
    $row["zip_code"] = $sourceRow.zip
    $row["city_name"] = $sourceRow.city
    $row["state_code"] = $sourceRow.state_id
    $row["country_code"] = "US"
    $data.Rows.Add($row)
  }

  $bulkCopy = [System.Data.SqlClient.SqlBulkCopy]::new($connection)
  try {
    $bulkCopy.DestinationTableName = "dbo.USZipCodes_Import"
    $bulkCopy.BatchSize = 5000
    $bulkCopy.BulkCopyTimeout = 120
    foreach ($columnName in @("zip_code", "city_name", "state_code", "country_code")) {
      [void]$bulkCopy.ColumnMappings.Add($columnName, $columnName)
    }
    $bulkCopy.WriteToServer($data)
  }
  finally {
    $bulkCopy.Dispose()
  }

  $publish = $connection.CreateCommand()
  $publish.CommandText = @"
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DELETE FROM dbo.USZipCodes;
INSERT dbo.USZipCodes (zip_code, city_name, state_code, country_code)
SELECT zip_code, city_name, state_code, country_code
FROM dbo.USZipCodes_Import;
COMMIT TRANSACTION;
SELECT COUNT_BIG(*) FROM dbo.USZipCodes;
"@
  $rowCount = [long]$publish.ExecuteScalar()
  Write-Output "Imported $rowCount ZIP codes into [$Database].dbo.USZipCodes on $Server."
}
finally {
  $connection.Dispose()
}
