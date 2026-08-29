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

## Prossimi passi (Fase 3, non iniziata)

Fase 2 è completa (vedi sopra). Dal piano, Fase 3 — Calendario + notifiche
push PWA — è l'unica parte con vero lavoro backend nuovo: dipendenza
`web-push`, coppia di chiavi VAPID generata al primo avvio (stessa
convenzione di `SESSION_SECRET`/`ENCRYPTION_KEY` in `.secrets.env`), nuova
migrazione per una tabella `push_subscriptions` + colonna `notified_at` su
`reminders`, nuove rotte `/api/push` subscribe/unsubscribe, handler
`push`/`notificationclick` in `sw.js`, un job a intervalli da zero (non
esiste nulla di simile oggi — nessun `node-cron`/`setInterval` per i
promemoria) che controlla le scadenze dovute e invia le notifiche, una
finestra Calendario a griglia mensile (solo frontend, riusa l'API
reminders già esistente), flusso di richiesta permesso frontend. **Da
verificare subito quando si inizia questa fase**: le notifiche push
richiedono un contesto sicuro HTTPS — probabilmente ok su `localhost` in
sviluppo, ma va riverificato sul LAN IP del Raspberry Pi prima di darlo per
scontato, e servirà il certificato TLS vero una volta spostato sul dominio
Aruba.

Poi Fase 4 (drag&drop reale sulla Bacheca — oggi le card si spostano solo
con le frecce ←/→, i due gap backend trovati durante l'esplorazione
originale — `reminders` non collegabile a una cartella, `documents` senza
`updated_at` — persistenza posizione/dimensione finestre se risulta
mancare dopo aver vissuto con il reset a cascata di oggi, gesto swipe-up
per il menu Avvio su mobile).

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
