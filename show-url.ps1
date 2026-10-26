Set-Location $PSScriptRoot
Remove-Item tunnel.log -ErrorAction SilentlyContinue
Remove-Item tunnel.out -ErrorAction SilentlyContinue

Write-Host "Starting Cloudflare tunnel..."
$p = Start-Process -FilePath ".\cloudflared.exe" `
    -ArgumentList "tunnel","--url","http://localhost:3000" `
    -RedirectStandardError "tunnel.log" `
    -RedirectStandardOutput "tunnel.out" `
    -PassThru -WindowStyle Hidden

$url = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path tunnel.log) {
        $m = Select-String -Path tunnel.log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
        if ($m) { $url = $m.Matches.Value; break }
    }
}

Write-Host ""
if ($url) {
    $url | Out-File -Encoding ASCII current-url.txt
    Write-Host "=================================================="
    Write-Host "  YOUR PUBLIC LINK (open this on your phone):"
    Write-Host ""
    Write-Host "    $url"
    Write-Host ""
    Write-Host "  (also saved in current-url.txt)"
    Write-Host "  On this laptop you can also use http://localhost:3000"
    Write-Host "=================================================="
} else {
    Write-Host "Could not detect the URL automatically."
    Write-Host "Check tunnel.log in this folder."
}

Write-Host ""
Write-Host "KEEP THIS WINDOW OPEN to stay online."
Write-Host "Close this window (or press Ctrl+C) to stop the tunnel."
Wait-Process -Id $p.Id
