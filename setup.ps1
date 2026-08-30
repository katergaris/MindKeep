# Script di installazione guidata per Mindkeep (Windows PowerShell).
# Controlla i prerequisiti, prepara il file .env con segreti generati
# automaticamente, avvia il container e attende che sia pronto.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "== Mindkeep — installazione =="
Write-Host ""

# --- 1. Verifica Docker ---
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "x Docker non trovato."
  Write-Host "  Installa Docker Desktop: https://docs.docker.com/get-docker/"
  exit 1
}

try {
  docker info | Out-Null
} catch {
  Write-Host "x Docker non risulta avviato."
  Write-Host "  Apri Docker Desktop e riesegui questo script."
  exit 1
}

Write-Host "OK Docker trovato e avviato"

# --- 2. Prepara il file .env ---
# Il template puo' chiamarsi "env.example" o ".env.example": accettiamo entrambi.
$template = @("env.example", ".env.example") | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not (Test-Path ".env")) {
  if (-not $template) {
    Write-Host "x Non trovo il file di esempio (env.example): scaricalo insieme al resto del progetto."
    exit 1
  }
  Copy-Item $template ".env"
  Write-Host "OK Creato .env dal template ($template)"
} else {
  Write-Host "OK File .env già presente, lo riuso"
}

function New-RandomHex {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

$envContent = Get-Content ".env" -Raw

if ($envContent -match "cambiami-con-una-stringa-lunga-e-casuale") {
  $secret = New-RandomHex
  $envContent = $envContent -replace "cambiami-con-una-stringa-lunga-e-casuale", $secret
  Write-Host "OK Generato SESSION_SECRET automaticamente"
}

if ($envContent -match "cambiami-con-una-passphrase-lunga-e-segreta") {
  $key = New-RandomHex
  $envContent = $envContent -replace "cambiami-con-una-passphrase-lunga-e-segreta", $key
  Write-Host "OK Generato ENCRYPTION_KEY automaticamente"
  Write-Host "   IMPORTANTE: fai una copia del file .env e conservala altrove."
  Write-Host "   Senza ENCRYPTION_KEY le password salvate nel vault non sono recuperabili."
}

Set-Content ".env" $envContent -NoNewline

# --- 3. Trova una porta libera sul computer ---
function Test-PortFree($port) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    $listener.Start()
    $listener.Stop()
    return $true
  } catch {
    return $false
  }
}

$currentPort = 3000
$match = Select-String -Path ".env" -Pattern "^HOST_PORT=(.*)" -ErrorAction SilentlyContinue
if ($match) {
  # Il valore puo' portarsi dietro spazi o un ritorno a capo (file con fine riga
  # Windows): senza Trim() la conversione a intero faceva fallire lo script.
  $raw = $match.Matches[0].Groups[1].Value.Trim()
  if ($raw -match '^\d+$') { $currentPort = [int]$raw }
}

$candidatePort = $currentPort
$attempts = 0
while (-not (Test-PortFree $candidatePort) -and $attempts -lt 50) {
  $candidatePort++
  $attempts++
}

if ($attempts -ge 50) {
  Write-Host "x Non trovo una porta libera nell'intervallo $currentPort-$($currentPort + 50)."
  Write-Host "  Libera manualmente una porta oppure imposta HOST_PORT nel file .env e riprova."
  exit 1
}

if ($candidatePort -ne $currentPort) {
  Write-Host "! La porta $currentPort risulta occupata: uso la $candidatePort al suo posto."
  $envContent = Get-Content ".env" -Raw
  # (?m) e' indispensabile: senza, "^" trova solo l'inizio del file e HOST_PORT
  # (che non e' la prima riga) non veniva mai sostituito, ma duplicato in fondo.
  if ($envContent -match "(?m)^HOST_PORT=.*") {
    $envContent = $envContent -replace "(?m)^HOST_PORT=.*", "HOST_PORT=$candidatePort"
  } else {
    $envContent += "`nHOST_PORT=$candidatePort"
  }
  Set-Content ".env" $envContent -NoNewline
} else {
  Write-Host "OK Porta $candidatePort libera"
}
$port = $candidatePort

# --- 4. Avvia il container ---
# Il commit corrente diventa la versione mostrata in app (schermata di
# accesso): senza questo, un "up --build" rieseguito dopo aver scaricato
# nuovo codice non aveva modo di dimostrare di aver preso davvero l'ultimo
# aggiornamento invece di riusare un'immagine vecchia dalla cache.
try {
  $gitSha = (git rev-parse --short HEAD 2>$null)
} catch { $gitSha = $null }
if (-not $gitSha) { $gitSha = "dev" }
$env:GIT_SHA = $gitSha

Write-Host ""
Write-Host "Avvio Mindkeep (la prima volta può richiedere qualche minuto)..."
docker compose up -d --build

# --- 5. Attende che sia pronto ---
Write-Host ""
Write-Host "Attendo che Mindkeep risponda su http://localhost:$port ..."
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}

if ($ready) {
  Write-Host ""
  Write-Host "OK Mindkeep è pronto: http://localhost:$port"
  Write-Host "   Al primo accesso ti verrà chiesto di creare username e password."
} else {
  Write-Host ""
  Write-Host "Mindkeep non ha ancora risposto. Controlla i log con:"
  Write-Host "  docker compose logs -f"
}
