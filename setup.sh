#!/usr/bin/env bash
# Script di installazione guidata per Mindkeep (Linux / macOS).
# Controlla i prerequisiti, prepara il file .env con segreti generati
# automaticamente, avvia il container e attende che sia pronto.

set -euo pipefail
cd "$(dirname "$0")"

echo "== Mindkeep — installazione =="
echo ""

# --- 1. Verifica Docker ---
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ Docker non trovato."
  echo "  Installa Docker Desktop (https://docs.docker.com/get-docker/) e riesegui questo script."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "✗ Docker Compose non trovato."
  echo "  Aggiorna Docker Desktop, oppure installa docker-compose separatamente."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker non risulta avviato."
  echo "  Apri Docker Desktop (o avvia il servizio docker) e riesegui questo script."
  exit 1
fi

echo "✓ Docker trovato e avviato (userò: $COMPOSE)"

# --- 2. Prepara il file .env ---
# Il template puo' chiamarsi "env.example" o ".env.example": accettiamo entrambi.
TEMPLATE=""
for candidate in env.example .env.example; do
  if [ -f "$candidate" ]; then TEMPLATE="$candidate"; break; fi
done

if [ ! -f .env ]; then
  if [ -z "$TEMPLATE" ]; then
    echo "✗ Non trovo il file di esempio (env.example): scaricalo insieme al resto del progetto."
    exit 1
  fi
  cp "$TEMPLATE" .env
  echo "✓ Creato .env dal template ($TEMPLATE)"
else
  echo "✓ File .env già presente, lo riuso"
fi

# openssl e node non sono garantiti su una macchina con solo Docker installato:
# in loro assenza si ripiega su /dev/urandom.
random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v node >/dev/null 2>&1; then
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  else
    # od legge esattamente 32 byte e termina: niente SIGPIPE (che con
    # "set -o pipefail" farebbe abortire lo script).
    od -vN 32 -An -tx1 /dev/urandom | tr -d ' \n'
    echo ""
  fi
}

# Test della porta in bash puro (/dev/tcp): se la connessione riesce c'e' gia'
# qualcosa in ascolto. Prima serviva node, che spesso non e' installato: la
# funzione falliva sempre e lo script concludeva che nessuna porta era libera.
is_port_free() {
  if (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then
    exec 3<&- 3>&-
    return 1
  fi
  return 0
}

if grep -q "cambiami-con-una-stringa-lunga-e-casuale" .env; then
  SECRET="$(random_hex)"
  sed -i.bak "s#cambiami-con-una-stringa-lunga-e-casuale#${SECRET}#" .env && rm -f .env.bak
  echo "✓ Generato SESSION_SECRET automaticamente"
fi

if grep -q "cambiami-con-una-passphrase-lunga-e-segreta" .env; then
  KEY="$(random_hex)"
  sed -i.bak "s#cambiami-con-una-passphrase-lunga-e-segreta#${KEY}#" .env && rm -f .env.bak
  echo "✓ Generato ENCRYPTION_KEY automaticamente"
  echo "  IMPORTANTE: fai una copia del file .env e conservala altrove."
  echo "  Senza ENCRYPTION_KEY le password salvate nel vault non sono recuperabili."
fi

# --- 3. Trova una porta libera sul computer ---
CURRENT_HOST_PORT="$(grep '^HOST_PORT=' .env | tail -n 1 | cut -d '=' -f2 | tr -d '\r[:space:]')"
case "$CURRENT_HOST_PORT" in
  ''|*[!0-9]*) CURRENT_HOST_PORT=3000 ;;
esac
CANDIDATE_PORT="$CURRENT_HOST_PORT"
ATTEMPTS=0
while ! is_port_free "$CANDIDATE_PORT" && [ "$ATTEMPTS" -lt 50 ]; do
  CANDIDATE_PORT=$((CANDIDATE_PORT + 1))
  ATTEMPTS=$((ATTEMPTS + 1))
done

if [ "$ATTEMPTS" -ge 50 ]; then
  echo "✗ Non trovo una porta libera nell'intervallo ${CURRENT_HOST_PORT}-$((CURRENT_HOST_PORT + 50))."
  echo "  Libera manualmente una porta oppure imposta HOST_PORT nel file .env e riprova."
  exit 1
fi

if [ "$CANDIDATE_PORT" != "$CURRENT_HOST_PORT" ]; then
  echo "! La porta ${CURRENT_HOST_PORT} risulta occupata: uso la ${CANDIDATE_PORT} al suo posto."
  if grep -q '^HOST_PORT=' .env; then
    sed -i.bak "s#^HOST_PORT=.*#HOST_PORT=${CANDIDATE_PORT}#" .env && rm -f .env.bak
  else
    echo "HOST_PORT=${CANDIDATE_PORT}" >> .env
  fi
else
  echo "✓ Porta ${CANDIDATE_PORT} libera"
fi
PORT="$CANDIDATE_PORT"

# --- 4. Avvia il container ---
# Il commit corrente diventa la versione mostrata in app (schermata di
# accesso): senza questo, un "up --build" rieseguito dopo aver scaricato
# nuovo codice non aveva modo di dimostrare di aver preso davvero l'ultimo
# aggiornamento invece di riusare un'immagine vecchia dalla cache.
export GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"

echo ""
echo "Avvio Mindkeep (la prima volta può richiedere qualche minuto per scaricare e compilare le dipendenze)..."
$COMPOSE up -d --build

# --- 5. Attende che sia pronto ---
echo ""
echo -n "Attendo che Mindkeep risponda su http://localhost:${PORT} "
READY=0
for _ in $(seq 1 40); do
  if command -v curl >/dev/null 2>&1; then
    if curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then READY=1; break; fi
  else
    if node -e "require('http').get('http://localhost:${PORT}/api/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))" >/dev/null 2>&1; then READY=1; break; fi
  fi
  echo -n "."
  sleep 2
done
echo ""

if [ "$READY" = "1" ]; then
  echo ""
  echo "✓ Mindkeep è pronto: http://localhost:${PORT}"
  echo "  Al primo accesso ti verrà chiesto di creare username e password."
else
  echo ""
  echo "Mindkeep non ha ancora risposto. Può essere solo questione di qualche secondo in più,"
  echo "oppure qualcosa è andato storto. Controlla i log con:"
  echo "  $COMPOSE logs -f"
fi
