# Mindkeep

Spazio personale self-hosted per idee, progetti, password, account e documenti — con **fascicoli** che li collegano tra loro. Gira interamente sul tuo computer o server, dentro Docker: nessun dato lascia la tua macchina.

## Cosa contiene

- **Note** — libere, con tag, `#hashtag` e checklist spuntabile
- **Progetti** — stato (da fare / in corso / fatto), checklist, scadenza, persone/contatti e budget, in una Bacheca kanban
- **Vault password** — voci cifrate (AES-256-GCM), con **import da CSV**
- **Abbonamenti** — account digitali o abbonamenti cartacei/fisici, con campi propri per ciascuno e data di rinnovo
- **Drive** — upload documenti, organizzati in cartelle, con nome personalizzato, anteprima (immagini e PDF) e scadenza opzionale
- **Cartelle** — collegano insieme note, progetti, voci del vault, abbonamenti, documenti e scadenze sullo stesso tema
- **Scadenze e Calendario** — elenco piatto o vista mensile, con notifiche push opzionali (anche ad app chiusa) quando una scadenza arriva a termine
- **Ricerca globale** — cerca in tutte le sezioni insieme
- **Cestino** — eliminazione soft con possibilità di ripristino
- **Backup** — esporta un file .zip con database e documenti caricati

## Requisiti

Solo **Docker Desktop** (Windows/macOS) o **Docker Engine + Docker Compose** (Linux). Nient'altro — Node.js, database o altre dipendenze vengono gestiti automaticamente dentro il container.

- Scarica Docker Desktop: https://docs.docker.com/get-docker/
- Assicurati che sia **avviato** prima di procedere (l'icona della balena nella barra delle applicazioni/menu bar).

## Avvio rapido

1. Scarica questo repository (`Code → Download ZIP` su GitHub, oppure `git clone`) ed estrailo.
2. Apri un terminale nella cartella del progetto ed esegui lo script adatto al tuo sistema:

   **Linux / macOS**
   ```bash
   ./setup.sh
   ```

   **Windows (PowerShell)**
   ```powershell
   .\setup.ps1
   ```

Lo script controlla che Docker sia installato e avviato, crea automaticamente il file `.env` con dei segreti generati in modo casuale (non devi scrivere nulla a mano), **verifica se la porta 3000 è libera e, se è occupata, ne sceglie automaticamente un'altra libera**, avvia il container e ti avvisa quando l'app è pronta — mostrandoti l'indirizzo esatto da aprire.

3. Apri il browser all'indirizzo che lo script ti indica (di norma **http://localhost:3000**, oppure un'altra porta se la 3000 era occupata). Al primo accesso ti verrà chiesto di creare il tuo username e la password.

> Se lo script segnala un permesso negato su Linux/macOS, rendilo eseguibile con `chmod +x setup.sh` e rilancialo.

### Avvio manuale (alternativa allo script)

`.env` è **facoltativo**: se non lo crei, Mindkeep genera da solo `SESSION_SECRET` ed `ENCRYPTION_KEY` al primo avvio e li salva in `data/.secrets.env` (sopravvivono a riavvii e rebuild, esattamente come il database). Quindi basta:

```bash
docker compose up -d --build
```

Serve un `.env` solo se vuoi personalizzare qualcosa (porta, durata sessione, o portarti dietro tue chiavi):

```bash
cp env.example .env
# modifica i valori che ti interessano
docker compose up -d --build
```

## Installazione su CasaOS

**Senza terminale** (più rapida): dal pannello CasaOS apri **App Store** → icona **"Installa un'app personalizzata"** → scheda **Docker Compose** → incolla il contenuto di [`casaos-compose.yml`](casaos-compose.yml) → **Installa**. CasaOS scarica l'immagine già pronta (nessuna compilazione sul NAS) e crea da solo le cartelle dati sotto `/DATA/AppData/`. Al primo accesso ti verrà chiesto di creare username e password, esattamente come nell'avvio rapido.

> CasaOS non legge nome e icona dai file installati in questo modo (li assegna solo alle app del suo catalogo ufficiale): l'app comparirà con un nome generato a caso e un'icona generica. Puoi correggerli a mano dalla card dell'app appena installata, nelle sue impostazioni.

**Da terminale** (SSH o l'app "Terminale" di CasaOS): CasaOS è basato su Debian con Docker già installato, quindi vale la stessa procedura descritta in "Avvio rapido":

```bash
git clone https://github.com/katergaris/MindKeep.git
cd MindKeep
./setup.sh
```

> Se manca `git`, installalo prima con `sudo apt-get update && sudo apt-get install -y git`.

## Dati e persistenza

- `./data/mindkeep.db` — database SQLite (idee, progetti, metadati vault/account/documenti/fascicoli)
- `./data/.secrets.env` — **solo se non hai creato un `.env` tu stesso**: `SESSION_SECRET` ed `ENCRYPTION_KEY` generati automaticamente al primo avvio
- `./uploads/` — file caricati nel Drive

Entrambe le cartelle sono montate come volumi Docker: i dati sopravvivono a riavvii e rebuild del container. Fanne comunque un backup periodico (vedi sotto) e **non cancellare mai `./data`** (ne' `.env`, se lo hai creato tu) — è lì che si trova la chiave con cui sono cifrate le password nel vault.

**Salvare gli allegati altrove (es. un HDD esterno):** di default `./uploads` sta nella stessa cartella del progetto. Per usare un disco diverso, imposta `UPLOADS_DIR=/percorso/del/tuo/disco` nel `.env` e riavvia (`docker compose up -d`) — non serve toccare `docker-compose.yml`. Su CasaOS (installazione da "App personalizzata"), lo stesso si fa dal selettore di percorso che CasaOS mostra per ogni volume durante l'installazione: puoi puntarlo direttamente a un disco esterno collegato al NAS.

## Durata dell'accesso

Di default **l'accesso non scade mai**: una volta entrato resti dentro finché non premi "Esci", anche dopo un riavvio del container.

Se preferisci che l'accesso scada, imposta `SESSION_DAYS` nel file `.env` con il numero di giorni desiderato e riavvia (`docker compose up -d`):

```bash
SESSION_DAYS=0    # non scade mai (predefinito)
SESSION_DAYS=7    # scade dopo 7 giorni in cui non apri mai Mindkeep
```

Il conteggio riparte a ogni utilizzo: con `SESSION_DAYS=7`, se apri Mindkeep almeno una volta a settimana non ti verrà mai richiesta la password. All'avvio il container scrive nei log quale impostazione è attiva.

> Con `SESSION_DAYS=0` chiunque usi quel browser entra senza password. Se il computer è condiviso, imposta un numero di giorni oppure ricordati di premere "Esci".

## Dal telefono

L'interfaccia si adatta agli schermi piccoli: al posto del menu laterale compare una **barra in basso su due righe** con quasi tutte le sezioni, mentre "Altro" apre un elenco con tutte le sezioni più "Esporta backup" ed "Esci". La ricerca sta dietro l'icona della lente e si apre al tocco.

Puoi anche **aggiungerlo alla schermata home** e usarlo come un'app, senza barra del browser: dal telefono apri l'indirizzo di Mindkeep e scegli "Aggiungi a schermata Home" (Safari) o "Installa app" / "Aggiungi a schermata Home" (Chrome). Serve che il telefono raggiunga il server: stessa rete di casa, oppure una VPN.

## Verifica in due passaggi (Google Authenticator)

Facoltativa, si attiva da **Sicurezza** nel menu laterale. Una volta attiva, per entrare servono la password *e* un codice a 6 cifre generato dal telefono.

1. Premi "Attiva con QR": Mindkeep mostra un codice QR.
2. Apri **Google Authenticator** (vanno bene anche Aegis, 1Password, Authy, Bitwarden: è lo standard TOTP, non un meccanismo proprietario di Google) e inquadralo. Se la fotocamera non collabora, nell'app scegli "Inserisci chiave di configurazione" e digita il segreto scritto sotto al QR.
3. Scrivi il codice a 6 cifre che compare nell'app per confermare, e **salva gli 8 codici di recupero** che ti vengono mostrati: sono l'unica via di rientro se perdi il telefono, si vedono una volta sola e ognuno funziona una volta sola.

Il QR viene disegnato dal tuo server e i codici sono calcolati dall'ora corrente: **non serve connessione a internet** e nessun dato viene inviato a Google o a chiunque altro.

**Se perdi il telefono:** scrivi uno dei codici di recupero al posto delle 6 cifre nella schermata di accesso. Se hai perso anche quelli, dal computer dove gira Mindkeep:

```bash
docker compose exec mindkeep node server/disable-2fa.js
```

> La verifica in due passaggi protegge l'*accesso all'app*, non i dati sul disco: chi ha in mano il file `.env` e il database può comunque decifrare il vault. Serve contro chi indovina o ruba la password, non contro chi ha accesso fisico al server.

## Backup

Dal menu laterale, "Esporta backup" scarica uno `.zip` con il database e tutti i documenti del Drive. Conservalo, insieme a una copia del file `.env`, in un posto sicuro e separato dal server.

## Import CSV nel vault

Nella sezione Vault, "Importa CSV" accetta file con intestazioni comuni (esportazioni da browser o altri password manager):

| Campo riconosciuto | Intestazioni accettate |
|---|---|
| Sito | `site`, `name`, `title` |
| Username | `username`, `login`, `email`, `user` |
| Password | `password`, `pass` |
| URL | `url`, `link`, `website` |
| Note | `notes`, `note`, `comment` |

Sono obbligatorie almeno le colonne per sito e password. Le righe incomplete vengono saltate e segnalate a fine import.

## Risoluzione dei problemi

**Lo script dice che Docker non è avviato**
Apri Docker Desktop e attendi che l'icona nella barra indichi "Running", poi rilancia lo script.

**La porta 3000 è già occupata**
Se usi `setup.sh` o `setup.ps1`, non devi fare nulla: lo script se ne accorge da solo e sceglie automaticamente la prima porta libera successiva, aggiornando `HOST_PORT` in `.env`. Se invece avvii tutto a mano, modifica `HOST_PORT` in `.env` (es. `HOST_PORT=3001`) e rilancia `docker compose up -d --build` — non serve toccare `docker-compose.yml`.

**`docker compose` non è riconosciuto**
Su installazioni più datate il comando è `docker-compose` (con il trattino). Gli script di setup lo rilevano automaticamente; se lanci i comandi a mano, usa quello disponibile sul tuo sistema.

**Ho perso il file `.env` / la ENCRYPTION_KEY**
Le password salvate nel vault non sono più recuperabili senza la chiave originale: è una conseguenza della cifratura, non un bug. Per questo lo script ti avvisa di conservarne una copia. Il resto dei dati (idee, progetti, account, documenti, fascicoli) non viene toccato.

**Voglio vedere cosa succede durante l'avvio**
```bash
docker compose logs -f
```

**Voglio ripartire da zero**
```bash
docker compose down
rm -rf data uploads   # attenzione: cancella tutti i dati salvati
./setup.sh
```

## Sicurezza — cosa sapere

- Le password del vault sono cifrate con AES-256-GCM; la chiave deriva dalla `ENCRYPTION_KEY` che imposti tu (o che lo script genera per te) e non viene mai salvata nel database.
- L'accesso all'app è protetto da un singolo utente (username + password, hash bcrypt) con sessione via cookie, e facoltativamente da una verifica in due passaggi con app di autenticazione (TOTP).
- Dopo 10 tentativi di accesso falliti dallo stesso indirizzo, il login si blocca per 15 minuti.
- Questo è uno strumento pensato per uso personale su una rete che controlli (rete domestica, VPN, NAS). Non ha avuto un audit di sicurezza professionale: per password particolarmente critiche, valuta di affiancare uno strumento dedicato e verificato come Vaultwarden, usando Mindkeep per il resto.
- Se esponi Mindkeep su internet, mettilo dietro HTTPS (es. reverse proxy con Caddy/Traefik/Nginx) e considera un livello aggiuntivo di autenticazione (es. VPN).

## Struttura del progetto

```
mindkeep/
├── setup.sh / setup.ps1   # installazione guidata (Linux-macOS / Windows)
├── docker-compose.yml
├── Dockerfile
├── env.example
├── LICENSE
├── package.json
├── server/
│   ├── index.js            # server Express, autenticazione, sessioni, health check
│   ├── db.js                # connessione SQLite e schema
│   ├── crypto.js             # cifratura AES-256-GCM del vault
│   ├── auth.js                 # setup utente, login, middleware
│   ├── totp.js                  # verifica in due passaggi (TOTP, RFC 6238)
│   ├── disable-2fa.js            # disattiva il 2FA da riga di comando (telefono perso)
│   ├── session-store.js           # sessioni salvate su SQLite (sopravvivono ai riavvii)
│   └── routes/                  # API REST per ogni sezione
└── public/                       # frontend (HTML/CSS/JS, nessuna build richiesta)
    ├── manifest.webmanifest   # aggiunta alla schermata home del telefono
    └── icon.svg / icon-*.png   # icone dell'app
```

## Licenza

Distribuito con licenza MIT — vedi [LICENSE](LICENSE). Puoi usarlo, modificarlo e ridistribuirlo liberamente.
