$ErrorActionPreference='Stop'
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'LocalRuntimeHost.cs')
    $code=[LocalRuntimeHost]::Run((Join-Path $PSHOME 'powershell.exe'),(Join-Path $PSScriptRoot 'local-services.ps1'),(Split-Path $PSScriptRoot -Parent))
    exit $code
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}