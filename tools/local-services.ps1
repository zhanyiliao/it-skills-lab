param([Parameter(Mandatory=$true)][string]$ControlEvent)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$project=Split-Path $PSScriptRoot -Parent
$runtime=Join-Path $project '.local-runtime'
$node=Join-Path $runtime 'node\node.exe'
$maria=Join-Path $runtime 'mariadb-11.4.10-winx64'
$dbServer=Join-Path $maria 'bin\mariadbd.exe'
$data=Join-Path $runtime 'data'
$utf8=[Text.UTF8Encoding]::new($false)
$stop=[Threading.EventWaitHandle]::OpenExisting($ControlEvent)
$web=$null
$db=$null
$result=0
function Write-Utf8($Path,$Content) { [IO.File]::WriteAllText($Path,$Content,$utf8) }
function Port-Open([int]$Port) {
    $client=New-Object Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1',$Port); return $true } catch { return $false } finally { $client.Dispose() }
}
function Stop-Services {
    if ($web -and !$web.HasExited) {
        Stop-Process -Id $web.Id
        if (!$web.WaitForExit(5000)) { throw 'Node server did not stop.' }
    }
    if ($db -and !$db.HasExited) {
        & (Join-Path $maria 'bin\mariadb-admin.exe') "--defaults-extra-file=$runtime\client.ini" shutdown
        if ($LASTEXITCODE -ne 0) { throw 'Database shutdown failed.' }
        if (!$db.WaitForExit(15000)) { throw 'Database did not finish shutting down.' }
    }
}
try {
    if ($stop.WaitOne(0)) { return }
    if ((Port-Open 3307) -or (Port-Open 8080)) { throw 'Port 3307 or 8080 is already in use. Existing services were left running.' }
    $null=New-Item -ItemType Directory -Force -Path $runtime
    & (Join-Path $PSScriptRoot 'install-node.ps1')
    if (!(Test-Path -LiteralPath $dbServer)) {
        $zip=Join-Path $runtime 'mariadb.zip'
        $sums=Join-Path $runtime 'mariadb-sha256sums.txt'
        if (!(Test-Path -LiteralPath $sums)) { Invoke-WebRequest -UseBasicParsing 'https://archive.mariadb.org/mariadb-11.4.10/winx64-packages/sha256sums.txt' -OutFile $sums }
        if (!(Test-Path -LiteralPath $zip)) { Invoke-WebRequest -UseBasicParsing 'https://archive.mariadb.org/mariadb-11.4.10/winx64-packages/mariadb-11.4.10-winx64.zip' -OutFile $zip }
        $line=Get-Content $sums | Where-Object { $_ -match '\s\*?(?:\./)?mariadb-11\.4\.10-winx64\.zip$' }
        if (!$line -or (Get-FileHash $zip -Algorithm SHA256).Hash -ne ($line -split '\s+')[0]) { throw 'MariaDB checksum mismatch.' }
        Expand-Archive -LiteralPath $zip -DestinationPath $runtime -Force
        Remove-Item -LiteralPath $zip,$sums -Force
    }
    $clientIni=@"
[client]
host=127.0.0.1
port=3307
user=root
password=password
protocol=tcp
"@
    Write-Utf8 (Join-Path $runtime 'client.ini') $clientIni
    if (!(Test-Path -LiteralPath (Join-Path $data 'mysql'))) {
        & (Join-Path $maria 'bin\mariadb-install-db.exe') "--datadir=$data" '--password=password' '--port=3307'
        if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed.' }
    }
    if ($stop.WaitOne(0)) { return }
    $dbArgs=@("--defaults-file="+[char]34+"$data\my.ini"+[char]34,'--bind-address=127.0.0.1','--port=3307','--character-set-server=utf8mb4','--collation-server=utf8mb4_unicode_ci','--console')
    $db=Start-Process -FilePath $dbServer -ArgumentList $dbArgs -WorkingDirectory $maria -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'database.log') -RedirectStandardError (Join-Path $runtime 'database-error.log')
    Write-Utf8 (Join-Path $runtime 'database.pid') ([string]$db.Id)
    $ready=$false
    for ($attempt=0;$attempt -lt 60;$attempt++) {
        if ($stop.WaitOne(0)) { return }
        if ($db.HasExited) { throw 'Database exited. Check .local-runtime/database-error.log.' }
        if (Port-Open 3307) { $ready=$true; break }
        if ($stop.WaitOne(500)) { return }
    }
    if (!$ready) { throw 'Database did not become ready.' }
    & $node (Join-Path $project 'src\setup.js') --demo
    if ($LASTEXITCODE -ne 0) { throw 'Node database setup failed.' }
    if ($stop.WaitOne(0)) { return }
    if (Port-Open 8080) { throw 'Port 8080 is already in use.' }
    $web=Start-Process -FilePath $node -ArgumentList @([char]34+"$project\src\server.js"+[char]34) -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'web.log') -RedirectStandardError (Join-Path $runtime 'web-error.log')
    Write-Utf8 (Join-Path $runtime 'web.pid') ([string]$web.Id)
    $ready=$false
    for ($attempt=0;$attempt -lt 30;$attempt++) {
        if ($stop.WaitOne(0)) { return }
        if ($web.HasExited) { throw 'Node exited. Check .local-runtime/web-error.log.' }
        if (Port-Open 8080) { $ready=$true; break }
        if ($stop.WaitOne(300)) { return }
    }
    if (!$ready) { throw 'Node server did not become ready.' }
    Write-Host ''
    Write-Host 'RUNNING - http://127.0.0.1:8080/' -ForegroundColor Green
    Write-Host 'Keep this terminal open. Press Ctrl+C or close it to stop both services.'
    Write-Host 'Node.js + Express: 127.0.0.1:8080 | MariaDB: 127.0.0.1:3307'
    while (!$stop.WaitOne(250)) {
        if ($web.HasExited -or $db.HasExited) { throw 'A local service exited unexpectedly. Both services will be stopped.' }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $result=1
} finally {
    Write-Host 'Stopping local services...'
    try { Stop-Services } catch { [Console]::Error.WriteLine($_.Exception.Message); $result=1 }
    foreach ($name in @('web','database')) {
        $pidFile=Join-Path $runtime "$name.pid"
        if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
    }
    $stop.Dispose()
    Write-Host 'STOPPED - website and database are closed.'
}
exit $result
