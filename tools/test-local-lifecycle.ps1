$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$runtime=Join-Path $project '.local-runtime'
$script=Join-Path $PSScriptRoot 'local.ps1'
$key=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($project).ToUpperInvariant()))).Replace('-','').Substring(0,24)
$eventName='Local\ITSkillsLabRuntimeStop-'+$key
function Listening([int]$Port) {
    $client=New-Object Net.Sockets.TcpClient
    try {$client.Connect('127.0.0.1',$Port);return $true} catch {return $false} finally {$client.Dispose()}
}
function Check($Condition,$Message) { if(!$Condition){throw $Message} }
function Start-HostProcess($Label) {
     $created=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$script`"") -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime "$Label.log") -RedirectStandardError (Join-Path $runtime "$Label-error.log")
    # Retain the process handle so Windows PowerShell can read ExitCode after exit.
    $null=$created.Handle
    return $created
}
function Wait-Ready($Process) {
    for($attempt=0;$attempt -lt 150;$attempt++) {
        $Process.Refresh()
        if($Process.HasExited){throw "Supervisor exited early ($($Process.ExitCode)). Check lifecycle test logs."}
        if(Listening 8080){return}
        Start-Sleep -Milliseconds 100
    }
    throw 'Service startup timed out.'
}
function Wait-Closed {
    for($attempt=0;$attempt -lt 100;$attempt++) {
        if(!(Listening 8080) -and !(Listening 3307)){return}
        Start-Sleep -Milliseconds 100
    }
    throw 'A service port was left open.'
}
function Signal-Stop {
    $event=[Threading.EventWaitHandle]::OpenExisting($eventName)
    try {$event.Set() | Out-Null} finally {$event.Dispose()}
}
Check (!(Listening 8080) -and !(Listening 3307)) 'Stop existing services before running this test.'
$hostProcess=$null
$duplicate=$null
$listener=$null
try {
    $hostProcess=Start-HostProcess 'lifecycle-normal'
    Wait-Ready $hostProcess
    $response=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8080/'
    Check ($response.StatusCode -eq 200) 'Homepage failed.'
    $duplicate=Start-HostProcess 'lifecycle-duplicate'
    Check ($duplicate.WaitForExit(10000)) 'Duplicate launcher did not return.'
    Check ($duplicate.ExitCode -eq 1) 'Duplicate launcher was accepted.'
    Check (Listening 8080) 'Duplicate launcher interrupted the active server.'
    Write-Output 'PASS foreground lifetime, homepage and duplicate-launch protection'
    Signal-Stop
    Check ($hostProcess.WaitForExit(20000)) 'Graceful stop timed out.'
    Check ($hostProcess.ExitCode -eq 0) 'Graceful stop returned an error.'
    Wait-Closed
    Check (!(Test-Path (Join-Path $runtime 'web.pid')) -and !(Test-Path (Join-Path $runtime 'database.pid'))) 'PID files were not cleaned up.'
    Write-Output 'PASS graceful service shutdown and PID cleanup'

    $hostProcess=Start-HostProcess 'lifecycle-forced-close'
    Wait-Ready $hostProcess
    $webId=[int](Get-Content (Join-Path $runtime 'web.pid'))
    $dbId=[int](Get-Content (Join-Path $runtime 'database.pid'))
    Stop-Process -Id $hostProcess.Id -Force
    Check ($hostProcess.WaitForExit(10000)) 'Forced supervisor exit timed out.'
    Wait-Closed
    Check (!(Get-Process -Id $webId,$dbId -ErrorAction SilentlyContinue)) 'A service survived the supervisor.'
    Write-Output 'PASS forced terminal-owner termination leaves no Node or database process'

    $hostProcess=Start-HostProcess 'lifecycle-recovery'
    Wait-Ready $hostProcess
    $response=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8080/'
    Check ($response.StatusCode -eq 200) 'Restart after forced close failed.'
    Signal-Stop
    Check ($hostProcess.WaitForExit(20000)) 'Recovery stop timed out.'
    Wait-Closed
    Write-Output 'PASS database recovery and restart after forced terminal closure'

    $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,8080)
    $listener.Start()
    $hostProcess=Start-HostProcess 'lifecycle-startup-failure'
    Check ($hostProcess.WaitForExit(20000)) 'Startup failure did not terminate the supervisor.'
    Check ($hostProcess.ExitCode -eq 1) 'Occupied web port was not reported.'
    Check (!(Listening 3307)) 'Database was left running after web startup failed.'
    Check (Listening 8080) 'The launcher stopped the unrelated port owner.'
    $listener.Stop();$listener=$null
    Write-Output 'PASS partial-startup failure closes only its own services'
} finally {
    if($listener){$listener.Stop()}
    if($hostProcess -and !$hostProcess.HasExited) {
        try {Signal-Stop} catch {}
        if(!$hostProcess.WaitForExit(20000)){Stop-Process -Id $hostProcess.Id -Force}
    }
}
Wait-Closed
Write-Output 'All lifecycle tests passed; local services are stopped.'