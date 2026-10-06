$ErrorActionPreference = 'Stop'
$global:probeCount = 0
$global:browserOpenCount = 0
$global:probeUris = @()

function Invoke-WebRequest {
    param(
        [string]$Uri,
        [switch]$UseBasicParsing,
        [int]$TimeoutSec
    )
    $global:probeCount++
    $global:probeUris += $Uri
    if ($global:probeCount -eq 1) {
        throw 'fixture server not ready'
    }
    if ($global:probeCount -eq 2) {
        return [pscustomobject]@{
            StatusCode = 200
            Content = '{"info":{"title":"Unrelated API"}}'
        }
    }
    return [pscustomobject]@{
        StatusCode = 200
        Content = '{"info":{"title":"Lottery Stats API"}}'
    }
}

function Start-Sleep {
    param([int]$Milliseconds)
}

function Start-Process {
    param([string]$FilePath)
    if ($FilePath -ne 'http://localhost:9123') {
        throw "unexpected process target: $FilePath"
    }
    $global:browserOpenCount++
}

& (Join-Path $PSScriptRoot 'open_when_ready.ps1') -Port 9123 -TimeoutSeconds 3
if ($global:probeCount -ne 3) {
    throw "expected 3 readiness probes including unrelated HTTP 200; got $global:probeCount"
}
if ($global:probeUris | Where-Object { $_ -ne 'http://127.0.0.1:9123/openapi.json' }) {
    throw "unexpected readiness URI: $($global:probeUris -join ',')"
}
if ($global:browserOpenCount -ne 1) {
    throw "expected one browser launch after the app-specific response; got $global:browserOpenCount"
}
Write-Output 'PASS: readiness helper ignores unrelated HTTP 200 and opens once after the Lottery Stats API identity response'
