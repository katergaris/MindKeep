# Continua da qui — Mindkeep, redesign Windows 95

Se stai leggendo questo file all'inizio di una nuova chat: questo documento ti dà
tutto il contesto per continuare esattamente da dove si era interrotto. Leggi
anche i file collegati sotto, poi procedi.

## Stato attuale (29/08/2026)

- **Branch**: `redesign-retro-ui` (già pushato su `origin`). PR non ancora aperta:
  https://github.com/katergaris/MindKeep/pull/new/redesign-retro-ui
- **Fase 1 completata, verificata con Playwright reale, e committata** (shell
  a finestre, menu Avvio, cattura veloce — commit `85dfb90`).
- **Fase 2 completata, verificata con Playwright reale, e committata** (4
  commit, uno per pezzo): Vault come foglio elettronico (`b189ae3`), Cartelle
  come Esplora Risorse a icone (`2f0696c`), checklist per le Note (`f128c66`),
  rifinitura visiva Bacheca — progress bar/scadenza concreta/budget/contatti
  (`38ffd8d`). L'utente ha chiesto di procedere senza fermarsi a chiedere
  conferma ad ogni passo (commit + push automatici a fine pezzo).
- **Fase 3 completata, verificata con Playwright reale e 34/34 test del
  server, e committata** (`e71719e`, + `6e2f601` per README/env.example):
  Calendario (griglia mensile) e notifiche push per le scadenze. Vedi
  sezione dedicata sotto per i dettagli — **non verificata la consegna
  reale di una notifica push end-to-end** (richiede HTTPS, non testabile
  in locale).
- **Fase 4 completata (tutti e 4 i pezzi opzionali, scelti dall'utente),
  verificata con Playwright reale, e committata** (4 commit, uno per
  pezzo): `documents.updated_at` (`1df158c`), persistenza posizione/
  dimensione finestre (`80b0dea`), gesto swipe-up per il menu Avvio su
  mobile (`76d386c`), drag&drop reale delle card in Bacheca (`8b818f9`).
  L'incongruenza "reminders non collegabile a una cartella" segnalata nel
  piano originale risultava già risolta, nessuna modifica necessaria li'.
  **Il redesign Windows 95 è ora completo end-to-end** (Fasi 1-4): resta
  solo la verifica delle notifiche push su HTTPS reale (vedi sotto) e
  l'apertura della PR quando l'utente lo riterrà pronto.
- Il piano completo (Fase 1 dettagliata + roadmap Fase 2-4) è in
  `C:\Users\Salva\.claude\plans\clever-scribbling-toast.md` — **leggilo per i
  dettagli tecnici** (struttura di `wm.js`, decisioni su singleton-per-view,
  perché Flusso/Tabella/Orbita sono stati eliminati e non solo nascosti, ecc.).
  Il piano della Fase 2 (dettagli implementativi non coperti da quel file,
  perché scritti in corsa via `EnterPlanMode`) è in
  `C:\Users\Salva\.claude\plans\enchanted-spinning-clock.md` (solo il pezzo
  Vault — Cartelle/Note/Bacheca sono stati implementati direttamente senza
  un piano scritto separato, seguendo lo stesso stile).

## Cosa esiste oggi nel codice reale (non più mockup)

- `public/wm.js` — window manager nuovo: apertura/chiusura/trascinamento/
  ridimensionamento finestre, taskbar, focus/minimizza, split mobile.
- `public/app.js`, `public/index.html`, `public/style.css` — riscritti per la
  shell a finestre. Palette e chrome Windows 95 (titlebar sfumata, 3 pulsanti,
  bevel) definiti come variabili CSS in `:root` di `style.css` — il contenuto
  delle view esistenti eredita i nuovi colori senza che le regole dei singoli
  componenti siano state riscritte (radius impostati a 0 globalmente).
- `public/wallpapers/wp-tramonto.jpg` e `wp-palma.jpg` — sfondi vaporwave reali
  (dalle foto originali dell'utente in `risorse/`, non committata: sono solo
  sorgenti, non serve tenerle in git).
- Menu Avvio, cattura veloce ("Nuovo" in barra), Bacheca promossa a vera vista
  Progetti, Scadenze come finestra minima — tutto descritto nel piano.
- **Vault**: griglia stile foglio elettronico (intestazioni colonna, righe a
  griglia, selezione stile Excel), collassa a schede impilate su mobile.
  Logica reveal/TOTP/modifica/elimina/import CSV invariata.
- **Cartelle**: griglia a icone stile Esplora Risorse (livello radice = icone
  cartella, click entra e mostra gli elementi collegati con l'icona del loro
  tipo reale). Un solo livello di profondità, nessuna sotto-cartella.
- **Note**: supporto checklist (migrazione `009_idea_checklist.js`, colonna
  `checklist` su `ideas` come `projects.checklist`). A differenza di Progetti,
  spuntabile direttamente dalla card (click sulla checkbox → PUT immediato).
  Feedback di completamento non punitivo: nessuno sbiadimento/testo barrato,
  solo un badge ✓ (per l'ADHD dell'utente).
- **Bacheca**: barra di avanzamento sul checklist, scadenza come tempo
  concreto colorato per urgenza ("Scade tra 2 giorni" / "Scaduto da 3
  giorni" — funzione condivisa `daysUntil()`), budget e contatti ora
  visibili sulla card (prima raccolti dal modulo ma mai mostrati).
- **Calendario**: nuova voce di menu, griglia mensile (`views.calendar` in
  `app.js`), riusa `/api/reminders` e `reminderModal()` — stessi dati di
  Scadenze, che resta anche come elenco piatto (non sostituita). Click su
  un giorno vuoto = nuova scadenza con quella data precompilata, click su
  una voce = modifica.
- **Notifiche push**: `server/push.js` (invio via `web-push`, pulizia
  automatica delle sottoscrizioni scadute 404/410), `server/reminder-
  notifier.js` (job ogni 5 minuti + al boot, controlla `reminders` con
  `date <= oggi AND notified_at IS NULL` — non e' una coda di ritentativi,
  vedi commento nel file), `server/routes/push.js` (`/api/push/vapid-
  public-key`, `/subscribe`, `/unsubscribe`), sezione "Notifiche scadenze"
  in Sicurezza per attivare/disattivare dal browser. Chiavi VAPID generate
  al primo avvio in `server/secrets.js`, stessa convenzione di
  `SESSION_SECRET`/`ENCRYPTION_KEY`.

## Decisioni di naming/design da NON invertire senza motivo

- **"Windows 95", non "Windows 3.1"** — è stato chiamato "3.1" per errore per
  gran parte della conversazione originale; il design costruito (titlebar
  sfumata, 3 pulsanti finestra, menu Avvio + taskbar) è Windows 95 vero. Le
  skill di riferimento sono in `.claude/skills/windows-95-web-designer/` e
  `.claude/skills/windows-3-1-web-designer/` (usa la prima come riferimento).
- **"Fascicoli" → "Cartelle"**, **"Idee" → "Note"**: solo il testo utente è
  cambiato, le rotte/tabelle del server (`dossiers`, `ideas`) restano quelle.
- Icone: piene e colorate (stile Program Manager), NON il vecchio tratto
  monocromo a 8 bit — l'utente l'ha chiesto esplicitamente ("qualcosa di
  idoneo"). Vedi `APP_ICON_PATHS` in `app.js`.
- I Fascicoli/Cartelle NON sono stati assorbiti dai Progetti — restano un
  concetto separato (i Progetti hanno una "funzione ben sviluppata" a parte,
  cioè la Bacheca).
- Desktop: nessun limite di finestre aperte. Mobile: un'app a schermo intero
  di default, split a due SOLO se l'utente preme "Affianca" — mai automatico.
- L'utente ha l'ADHD: vedi la memoria `user-adhd` — tempo concreto (countdown,
  non solo date), stato sempre visibile (niente nascosto nei menu),
  cattura rapida sempre a un tocco, feedback di completamento mai punitivo
  (niente sbiadimento/testo barrato su un intero completato, solo un badge).
- Hosting finale: Aruba Linux; nel frattempo gira su un Raspberry Pi del
  proprietario, senza dominio ancora.

## Mockup visivo di riferimento (fuori dal repo)

Canvas Claude Design pubblicato con tutte le schermate validate prima di
scrivere il codice: https://claude.ai/code/artifact/d31cfc7a-3392-4f14-aa2c-2aa5c752c9e0
(Desktop, Bacheca, Vault a foglio elettronico, Note, Calendario, Sfondo,
viste mobile). Usalo come riferimento visivo per le fasi 2-3 ancora da
scrivere in codice.

## Sessione 29/08/2026 (dopo il redesign): bug fix su desktop/mobile

Segnalati dall'utente durante l'uso reale, non voci del piano originale:

- **Bug grave: nessuna icona/postit del desktop era cliccabile.**
  `.window-layer` (contenitore delle finestre, `z-index:2`) copriva l'intero
  desktop anche a vuoto e intercettava tutti i click prima che arrivassero a
  `.desktop-icons` (`z-index:1`) sotto. Risolto con lo stesso pattern gia'
  usato per `.desktop-icons`/`.desktop-icon`: `pointer-events:none` sul
  contenitore, `pointer-events:auto` sulle finestre vere (`.win-frame.window`)
  in `style.css`. Prima di questo fix, cliccare una cartella o una nota sul
  desktop non faceva letteralmente nulla, ne' su desktop ne' su mobile.
- **Note sul desktop: da "solo titolo, non cliccabile" a espandibili sul
  posto.** I postit mostravano solo il titolo troncato. Ora un tocco li
  allarga (posizione fissa, centrata, sopra tutto) mostrando titolo, corpo
  completo, checklist e tag; un tocco su un punto qualsiasi (compreso il
  postit stesso) o l'inizio di una nuova operazione li richiude. Vedi
  `expandPostit`/`collapsePostit`/`expandedPostit` in `app.js` — richiusura
  gestita da un listener globale su `document` che ignora i click dentro il
  nodo espanso. Stesso comportamento identico su desktop e mobile (prima il
  problema su mobile era lo stesso bug del window-layer, non qualcosa di
  specifico del tocco).
- **Icone desktop non si aggiornavano senza reload.** `buildDesktop()` veniva
  chiamata solo all'avvio e al cambio sfondo. Ora `render()` la richiama in
  automatico ogni volta che la vista `ideas` o `dossiers` si aggiorna (crea/
  modifica/elimina nota, checklist, cartella) — centralizzato in un unico
  punto invece che sparso nei singoli handler.
- **Testo lungo senza spazi (es. nome file originale in Drive) sfondava la
  finestra e la mandava in scroll orizzontale su mobile.** `.doc-original`
  non aveva `overflow-wrap:anywhere` nella media query mobile (a differenza
  di `.doc-name`/`.doc-meta`, che gia' lo avevano). Aggiunto, e come rete di
  sicurezza aggiunto anche `overflow-x:hidden` su `.win-content` cosi' che
  nessun singolo elemento possa piu' spingere una finestra fuori dai suoi
  margini, qualunque sia il contenuto.
- **Dalle Cartelle non si poteva creare un nuovo elemento, solo collegarne
  uno esistente.** Aggiunto bottone "+ Nuovo elemento" nella toolbar quando
  si e' dentro una cartella (non alla radice): apre la cattura veloce
  gia' pre-collegata a quella cartella (stesso meccanismo di `@cartella`
  gia' esistente in cattura veloce). Se la finestra Cartelle e' gia' aperta,
  si aggiorna da sola dopo il salvataggio (non viene pero' aperta se non lo
  era gia', per non spuntare finestre non richieste).
- Verificato tutto con Playwright reale (server isolato, DB temporaneo,
  utente di test), desktop e viewport mobile (390x844).
- Non ancora committato: chiedere conferma o procedere secondo la
  preferenza gia' nota dell'utente (commit/push senza fermarsi a ogni
  passo, una volta approvato l'insieme).

## Prossimi passi

Tutte le fasi pianificate (1-4) sono complete. Quello che resta non è più
"lavoro di redesign", è messa in produzione:
- **Verifica reale delle notifiche push su HTTPS**: funzionano su
  `localhost` in sviluppo ma vanno riverificate sul LAN IP del Raspberry
  Pi (probabilmente non basta, serve il certificato TLS vero una volta
  spostato sul dominio Aruba) prima di considerarle utilizzabili davvero
  dall'utente.
- **Apertura della PR** verso `main` quando l'utente lo riterrà pronto:
  https://github.com/katergaris/MindKeep/pull/new/redesign-retro-ui
  (branch già pushato, nessuna PR aperta finora).
- Da qui in poi, nuovo lavoro = nuove richieste dell'utente, non voci
  residue di un piano — non presumere altro da fare senza chiedere.

## Limiti noti della Fase 1 (non bloccanti, ma da tenere a mente)

- Le icone desktop (cartelle/note recenti) non si aggiornano da sole finché
  non si rientra nell'app.
- Solo le prime ~4 note e ~8 cartelle compaiono come icone, nessun "pin" vero.

## Come riprendere in una nuova chat

Basta dire "leggi questo file" indicando questo percorso
(`c:\Users\Salva\Documents\Dev\DarkNest\.claude\HANDOFF.md`) — poi, se serve
il dettaglio tecnico della Fase 1/2/3/4, leggi anche il piano indicato sopra.
Per rivedere l'app funzionante: `npm start` nella cartella del progetto,
poi http://localhost:3000 (nessun utente esiste ancora — il primo accesso
chiede di creare username e password).
