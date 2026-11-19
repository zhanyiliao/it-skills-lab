$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$runtime=Join-Path $project '.local-runtime'
$node=Join-Path $runtime 'node'
if (!(Test-Path -LiteralPath (Join-Path $node 'node.exe'))) {
    $version='v24.22.1'
    $filename="node-$version-win-x64.zip"
    $url="https://nodejs.org/dist/$version"
    $null=New-Item -ItemType Directory -Force -Path $runtime
    $archive=Join-Path $runtime $filename
    $sums=(Invoke-WebRequest -UseBasicParsing "$url/SHASUMS256.txt").Content
    $line=($sums -split '\r?\n') | Where-Object { $_ -match ('\s+'+[regex]::Escape($filename)+'$') } | Select-Object -First 1
    if (!$line) { throw 'Official Node checksum not found.' }
    Invoke-WebRequest -UseBasicParsing "$url/$filename" -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne ($line -split '\s+')[0]) { throw 'Node checksum mismatch.' }
    $staging=Join-Path $runtime ('node-extract-'+[guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    $source=[IO.Path]::GetFullPath((Join-Path $staging "node-$version-win-x64"))
    $target=[IO.Path]::GetFullPath($node)
    $boundary=[IO.Path]::GetFullPath($runtime)+[IO.Path]::DirectorySeparatorChar
    if (!$source.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase) -or !$target.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid Node installation path.' }
    Move-Item -LiteralPath $source -Destination $target
    Remove-Item -LiteralPath $archive -Force
    Remove-Item -LiteralPath $staging -Force
}
$env:Path=$node+[IO.Path]::PathSeparator+$env:Path
$lock=Join-Path $project 'package-lock.json'
$marker=Join-Path $runtime 'node-dependencies.sha256'
$hash=(Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
if (!(Test-Path -LiteralPath (Join-Path $project 'node_modules/express/package.json')) -or !(Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $hash) {
    & (Join-Path $node 'npm.cmd') ci --prefix $project
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    [IO.File]::WriteAllText($marker,$hash,[Text.UTF8Encoding]::new($false))
}
