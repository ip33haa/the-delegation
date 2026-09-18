$ErrorActionPreference = 'Stop'

$port = if ($env:DB_PORT) { [int]$env:DB_PORT } else { 3307 }
$mysqlRoot = 'C:\xampp\mysql'
$dataDir = Join-Path $env:LOCALAPPDATA 'TheDelegation\mariadb-data'
$defaultsFile = Join-Path $dataDir 'my.ini'

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Host "[memory-db] MariaDB already listening on port $port"
  exit 0
}

if (-not (Test-Path (Join-Path $mysqlRoot 'bin\mysqld.exe'))) {
  throw 'XAMPP MariaDB was not found at C:\xampp\mysql.'
}

if (-not (Test-Path $defaultsFile)) {
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  & (Join-Path $mysqlRoot 'bin\mysql_install_db.exe') `
    "--datadir=$dataDir" "--port=$port" '--password=' '--default-user'
  if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the Delegation MariaDB data directory.' }
}

Start-Process `
  -FilePath (Join-Path $mysqlRoot 'bin\mysqld.exe') `
  -ArgumentList "--defaults-file=$defaultsFile", "--basedir=$mysqlRoot", '--bind-address=127.0.0.1', '--console' `
  -WindowStyle Hidden

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 500
  & (Join-Path $mysqlRoot 'bin\mysqladmin.exe') `
    --protocol=tcp --host=127.0.0.1 "--port=$port" --user=root --connect-timeout=2 ping 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[memory-db] MariaDB ready on port $port"
    exit 0
  }
}

throw "MariaDB did not become ready on port $port."
