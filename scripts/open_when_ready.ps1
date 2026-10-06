param(
    [int]$Port = 8509,
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
$uri = "http://127.0.0.1:$Port/openapi.json"
$deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $TimeoutSeconds))

while ([DateTime]::UtcNow -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $openApi = $response.Content | ConvertFrom-Json
            if ($openApi.info.title -eq 'Lottery Stats API') {
                Start-Process "http://localhost:$Port"
                return
            }
        }
    } catch {
        # The server is still starting, or another app owns the port; retry until the bounded deadline.
    }
    Start-Sleep -Milliseconds 250
}

Write-Error "The Lottery Stats API at $uri did not become ready within $TimeoutSeconds seconds."
exit 1
