<#
.SYNOPSIS
  Print URLs for accessing The Delegation from other devices.
  No admin required. Tailscale cannot be installed without admin on Windows.
#>

$Port = 3000
$Path = '/the-delegation/'

Write-Host '=== The Delegation - share on the same network ===' -ForegroundColor Cyan
Write-Host ''
Write-Host '1. On this PC:  npm run dev'
Write-Host '   (already binds 0.0.0.0 - reachable if firewall allows)'
Write-Host ''

$ips = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'
} | Sort-Object InterfaceAlias)

if ($ips.Count -eq 0) {
  Write-Host 'No usable LAN IP found. Connect to Wi-Fi first.' -ForegroundColor Yellow
  exit 1
}

Write-Host '2. On another phone/laptop on the SAME Wi-Fi, open:' -ForegroundColor Green
foreach ($ip in $ips) {
  Write-Host ("   http://{0}:{1}{2}  ({3})" -f $ip.IPAddress, $Port, $Path, $ip.InterfaceAlias)
}

Write-Host ''
Write-Host 'Chat and image generation run on THIS PC (Ollama :11434, ComfyUI :8188).'
Write-Host 'Other devices must use one of the URLs above — Vite proxies /ollama and /comfyui.'
Write-Host 'Keep `npm run dev`, Ollama, and ComfyUI running here while they use the app.'
Write-Host ''
Write-Host 'If that fails: Windows Firewall is blocking inbound TCP 3000.'
Write-Host 'Without admin you cannot open the firewall or install Tailscale.'
Write-Host 'Ask IT to either:'
Write-Host '  - allow inbound TCP 3000 for Node/Vite, or'
Write-Host '  - install Tailscale for your account'
Write-Host ''
Write-Host 'Optional no-admin public tunnel (internet, not just LAN):'
Write-Host '  npx --yes localtunnel --port 3000'
Write-Host '  then open the printed URL + /the-delegation/'
