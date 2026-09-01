# Continua da qui — Mindkeep, redesign Windows 95

Se stai leggendo questo file all'inizio di una nuova chat: questo documento ti dà
tutto il contesto per continuare esattamente da dove si era interrotto. Leggi
anche i file collegati sotto, poi procedi.

## Leggi prima questo: stato al 01/09/2026, fine sessione

- **Branch**: si lavora su `main` (non piu' `redesign-retro-ui`, mergiato —
  vedi nota sotto). Ultimo commit pushato: `ef753f1`. Nessuna PR in sospeso.
- **Il redesign Windows 95 (Fasi 1-4) e' completo da tempo**; da allora si
  sono susseguiti tanti piccoli giri di bug fix/rifiniture dall'uso reale
  dell'utente — vedi le sezioni "Sessione 30/08/2026 (N-esima parte)" e
  "Sessione 01/09/2026" sotto, in ordine cronologico, per il dettaglio di
  ciascuno. Non c'e' piu' un piano/roadmap residuo da seguire: nuovo
  lavoro = nuove richieste esplicite dell'utente.
- **Cosa fare appena riprendi, PRIMA di aggiungere altro**:
  1. L'utente deve ancora aggiornare il suo Raspberry Pi con gli ultimi
     commit (vedi "ottava parte" sotto: `git pull` poi `./setup.sh` o
     `docker compose up -d --build`). Se torna a parlarne, la schermata di
     login ora mostra "versione X.Y.Z · [hash commit]" in basso — usalo per
     confermare che il container sta girando sull'ultimo codice prima di
     indagare oltre su qualsiasi bug segnalato "dal vivo".
  2. **Notifiche push da riverificare**: l'utente ha segnalato una notifica
     generica (icona di Chrome, testo placeholder invece del contenuto
     vero) che "capita sempre". E' stato applicato un fix (corpo mai vuoto,
     tag per-scadenza — vedi "ottava parte") ma NON confermato risolutivo:
     probabile che il Pi girasse ancora su una build vecchia. Prossima
     volta che se ne riparla, verificare prima il punto 1, poi ritestare.
  3. **Card Progetti/Bacheca ridisegnata (01/09/2026)**: l'utente ha
     segnalato che la gestione progetti era illeggibile/difficile sia su
     desktop che mobile (card troppo densa, barra di progresso allo 0%
     che sembrava una riga random, 5 pulsanti di testo minuscoli che
     andavano a capo in modo imprevedibile, nessun target di tocco reale
     su mobile). Vedi sezione dedicata sotto per il dettaglio — non
     risulta ancora confermato dall'utente sull'uso reale, solo verificato
     con Playwright su un'istanza isolata (DB in-memory, non quella
     reale).
  4. Non risultano altre richieste esplicite in sospeso a fine sessione.

## Nota sul branch

`redesign-retro-ui` e' stato **mergiato in `main`** (commit `09b261e`, non da
questa sessione — trovato gia' fatto). Da questo punto in poi tutti i commit
di questo file di handoff vanno diretti su `main`; le sezioni sotto che
parlano ancora di `redesign-retro-ui` come branch di lavoro sono storiche.

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

## Sessione 30/08/2026: Vault icone, Drive cartella, orario scadenze

Altro giro di feedback dall'uso reale, dopo il giro di bug fix del 29/08:

- **Vault**: i quattro pulsanti testuali (Mostra/Modifica/Cartella/Elimina)
  sono diventati icone in stile Windows (occhio/matita/cartella/cestino,
  linea vettoriale coerente con `iconaLinea()` gia' usata per la ricerca —
  non emoji). Il pulsante "Codice" TOTP e' un'icona con "01" dentro (SVG con
  `<text>`, non un font emoji). L'hover blu pieno su tutta la riga (stile
  Excel) e' stato tolto: su schermi touch restava "incollato" dopo un tocco
  e sembrava una selezione casuale — segnalato dall'utente. Ora c'e' solo
  zebra striping (`:nth-child(even)`) piu' un hover leggero (tinta, non piu'
  inversione colore) attivo solo con mouse vero via `@media (hover: hover)
  and (pointer: fine)`.
- **Drive**: il vecchio campo "Cartella" era testo libero non collegato al
  vero sistema Cartelle (dossiers) — un secondo concetto di "cartella" mai
  spiegato, confuso con quello vero. Sostituito con un menu a tendina delle
  Cartelle reali sia in caricamento che in modifica; il collegamento risultante
  ora compare scritto sulla card del file stesso ("→ NomeCartella"), non solo
  entrando nella cartella da Cartelle. Vedi `setSingleDossierLink()` in
  `app.js` — tratta il collegamento come singolo anche se il modello dati
  sotto (`dossier_links`) permetterebbe piu' cartelle per lo stesso file.
  Il vecchio campo testuale `documents.folder` resta nel database e nella
  card per chi lo aveva gia' valorizzato, ma non e' piu' scrivibile dai form:
  soppiantato dal collegamento a cartella reale.
- **Scadenze/Calendario**: aggiunto un orario opzionale (nuova colonna
  `reminders.time`, migrazione `012_reminder_time.js`). Le scadenze senza
  orario si comportano esattamente come prima (dovute dall'inizio della
  giornata). Il controllo di `reminder-notifier.js` ora aspetta anche
  l'orario, quando c'e', prima di considerare la scadenza "dovuta" — vedi il
  commento nel file per la logica esatta (confronto tra ora locale e stringa
  HH:MM salvata, la parte "solo data" non e' stata toccata per non introdurre
  bug di fuso orario dove non serviva).
- **Progetti su mobile tagliavano il contenuto**: `.board-card-title` e
  `.card-sub` non avevano `overflow-wrap: anywhere` (a differenza di
  `.card-title`/`.card-body` altrove, che gia' lo avevano) — un titolo lungo
  senza spazi restava clippato invece di andare a capo. Stessa famiglia di
  bug del `.doc-original` di Drive risolto il 29/08. Aggiunto anche
  `min-width: 0` su `.board-col`/`.board-card` (necessario perche' i figli
  flex/grid si restringano davvero sotto la dimensione del contenuto).
- Verificato tutto con Playwright reale (server isolato, DB temporaneo).

## Sessione 30/08/2026 (seconda parte): taskbar, abbonamenti, cartelle

- **Bug grafico: la barra Windows in basso sembrava assente** — la classe
  `.raised` era referenziata in `index.html` (taskbar, pulsanti, menu Avvio,
  finestre) e in `wm.js` ma non era mai stata definita in `style.css`. Il
  contenitore `.taskbar` restava percio' trasparente (i singoli pulsanti si
  vedevano perche' hanno gia' il loro sfondo, ma la barra attorno no).
  Aggiunta come utility class in cima al foglio, cosi' le regole piu'
  specifiche gia' esistenti (`.win-frame`, `.taskbar-start`, ecc.) continuano
  a vincere dov'erano gia' definite, e `.raised` riempie solo il vuoto per chi
  non aveva un proprio sfondo (`.taskbar`, `.start-menu`).
- **Abbonamenti**: nuovo campo opzionale "Data di inizio" (data vera, storica).
  Il vecchio campo "Data di rinnovo/scadenza" (una data con anno) e' stato
  sostituito da un riferimento giorno+mese (due `<select>`, niente anno):
  la cadenza reale resta quella di "Frequenza di addebito" (settimanale...
  annuale), non diventa annuale solo perche' si esprime senza anno — vedi
  `BILLING_STEP`/`nextRenewalDate()` in `app.js` (duplicato lato server in
  `search.js` per l'endpoint `/search/reminders/upcoming`, mai consumato dal
  client ma tenuto coerente). Occhio se si ritocca: il calcolo ricrea la data
  da zero a ogni passo invece di sommare mese dopo mese sulla stessa istanza,
  altrimenti un giorno inesistente in un mese intermedio (es. 31 a settembre)
  trascina la ricorrenza su un altro giorno per tutte le occorrenze dopo.
  Migrazione `013_account_renewal_daymonth.js`: aggiunge `start_date`,
  `renewal_day`, `renewal_month`, e travasa automaticamente giorno/mese da
  chi aveva gia' un `renewal_date` impostato (colonna lasciata in tabella,
  non piu' scritta dai form). La vista Abbonamenti mostra un riquadro
  "Prossimo rinnovo" in cima (il piu' vicino tra tutti) e ordina la griglia
  di conseguenza.
- **Cartelle: aprire un elemento collegato mostrava l'intero elenco invece
  del solo elemento.** Ogni vista raggiungibile da una cartella (Note,
  Progetti, Vault, Abbonamenti, Drive, Scadenze) accetta ora `opts.only`
  (filtra alla sola voce) e `opts.fromDossier` (mostra un bottone "← Torna
  alla cartella" che riapre `dossiers` gia' dentro quella cartella — stesso
  meccanismo che il campo `highlight` di quella vista gia' usava per
  drillare subito nel fascicolo, non serve altro). Helper condivisi
  `onlyFilter()`/`backToDossierButtonHtml()`/`wireBackToDossier()` vicino a
  `TYPE_TO_VIEW`. La finestra resta la stessa singleton di sempre (nessuna
  nuova finestra "dettaglio"): cambia solo cosa viene mostrato dentro.
- Verificato tutto con Playwright reale (server isolato, DB temporaneo).

## Sessione 30/08/2026 (terza parte): rinnovo abbonamenti specifico per cadenza

Correzione al lavoro sugli abbonamenti di poco prima nella stessa sessione:
l'utente ha chiarito che il giorno+mese generico andava bene solo per
trimestrale/semestrale/annuale, non per tutte le cadenze — mantengono
"il carattere di essere con frequenze variabili dalla settimanale
all'annuale", ognuna con il proprio dato di riferimento:

- **Settimanale** → solo giorno della settimana (select `renewal_weekday`,
  1=Lunedi'...7=Domenica, stessa convenzione di `WEEKDAY_LABELS` del
  Calendario).
- **Mensile** → solo giorno del mese (select `renewal_monthday`, 1-31).
- **Trimestrale/semestrale/annuale** → giorno+mese di riferimento (invariato
  dal giro precedente).

Il form (`accountModal` in `app.js`) mostra/nasconde questi tre gruppi con
`data-billing-fields` + `syncBillingFields()`, stesso pattern gia' usato per
Digitale/Cartaceo (`data-type-fields`/`syncTypeFields()`). In salvataggio
(`renewalPayload()` dentro `views.accounts`) si legge il campo giusto in base
alla frequenza scelta e lo si manda sempre come `renewal_day`/`renewal_month`
al server (colonne DB invariate dalla migrazione precedente, `renewal_month`
resta NULL per settimanale/mensile). `nextRenewalDate()` (client, in
`app.js`) e `nextOccurrence()` (server, in `search.js`) diramano per
frequenza: settimanale cerca la prossima occorrenza di quel giorno ISO della
settimana, mensile la prossima occorrenza di quel giorno del mese, le altre
tre restano sul calcolo "ricrea la data da zero a ogni passo" gia' descritto
sopra. **Occhio**: in ogni punto dove si mostra il rinnovo (card, riquadro
"Prossimo rinnovo"), si usa sempre la data vera calcolata da `next`
(`next.getDate()`/`next.getMonth()`), mai `a.renewal_day`/`a.renewal_month`
grezzi — quei due campi hanno un significato diverso a seconda della
cadenza e non sono mai la data da mostrare direttamente.
- Verificato con Playwright reale: campi giusti mostrati per ciascuna
  cadenza, valori riletti correttamente in modifica, calcolo del prossimo
  rinnovo corretto per tutte e quattro le cadenze.

## Sessione 30/08/2026 (quarta parte): orologio taskbar in tema + data

L'utente ha mostrato uno screenshot di un vero orologio taskbar Windows
(sfondo grigio incassato, niente icona accanto — esplicitamente chiesto di
non aggiungerla) e chiesto anche la data, assente nell'originale.

- `.taskbar-clock` aveva `background: var(--surface)` (bianco): cambiato in
  `var(--win-face)` (grigio, come il resto della barra). Il bevel incassato
  c'era gia' (era corretto, solo lo sfondo stonava).
- Aggiunta la data su una seconda riga sotto l'ora (`tickClock()` in
  `wm.js` ora costruisce due `<span>`, `.taskbar-clock-time`/
  `.taskbar-clock-date`), formato `it-IT` coerente con `fmtDate()` altrove.
- Notata e sistemata anche `.sunken`: come `.raised` la settimana scorsa,
  era referenziata in `index.html` (proprio su `#taskbar-clock`) ma mai
  definita in `style.css` — non causava un bug visibile qui perche'
  `.taskbar-clock` ha gia' il proprio bevel esplicito, ma l'ho definita
  comunque (controparte di `.raised`) per non lasciare la stessa lacuna.

## Sessione 30/08/2026 (quinta parte): immagini in Drive, audit classi CSS orfane

L'utente ha segnalato che le immagini in Drive sfondavano il riquadro e ha
chiesto di non mostrarle finche' non si aprono, e di verificare se lo stesso
tipo di bug (classe usata in JS/HTML ma mai definita in CSS — gia' visto con
`.raised` e `.sunken`) fosse presente altrove.

- **Drive**: `.entry-doc`, `.entry-doc-thumb`, `.entry-doc-ext` non erano MAI
  state definite in `style.css` — l'`<img>` per le immagini si vedeva a
  dimensione naturale (poteva sfondare qualsiasi cosa) perche' non aveva
  ne' un contenitore ne' vincoli di taglia. Risolto rimuovendo del tutto
  l'anteprima eager nell'elenco: ora anche le immagini mostrano il badge
  estensione (`.entry-doc-ext`, riquadro 40x40 con bevel incassato) come
  qualsiasi altro file — l'immagine vera si vede solo aprendo l'anteprima
  (`openDocumentPreview()`, gia' esistente, invariata).
- **Audit sistematico**: script una tantum (non salvato, era solo per questa
  verifica) che confronta ogni classe usata in `app.js`/`wm.js`/`index.html`
  contro i selettori di `style.css`. Trovato un altro caso reale: i pulsanti
  delle finestre aperte in taskbar venivano creati in `wm.js` con classe
  `taskbtn`/`taskbtn-icon`/`taskbtn-label`, ma `style.css` definiva
  `.tasktn`/`.tasktn-label` (manca una "b" — probabile refuso mai notato).
  Risultato: quei pulsanti non avevano mai avuto `max-width` ne' l'ellissi
  sul titolo lungo. Rinominato in style.css per far combaciare i nomi.
  Altri scarti dell'audit (`.focused`, `.app`, `.preview-frame`,
  `.vault-sheet-body`, `.win-btn-min/-max/-split`) sono marcatori di stato o
  contenitori/ID gia' coperti altrove — non causano bug visibili, lasciati
  cosi'.
- Verificato con Playwright reale: riquadro icona Drive ora 40x40 con
  l'estensione (non l'immagine), l'anteprima si apre comunque al click,
  pulsanti taskbar delle finestre correttamente dimensionati.

## Sessione 30/08/2026 (sesta parte): multi-app mobile, icone file, lingua IT/EN

- **Taskbar mobile**: passare a un'altra app dalla taskbar (fuori dallo
  split) minimizzava... no, **chiudeva** del tutto le altre finestre. Ora le
  minimizza: restano in taskbar per un cambio rapido, esattamente come su
  desktop. Rifattorizzato `wm.js` attorno a `normalWindowCount()`
  (quante finestre sono davvero visibili adesso) invece del vecchio
  `openOrder` (quante ne sono mai state aperte, mai decrementato se non con
  una chiusura vera) — quel contatore andava gia' storto prima di questo
  cambio, il minimize-invece-di-close lo avrebbe reso ancora piu' evidente.
- **Drive**: icona per categoria file (immagine/documento/musica/video)
  accanto all'estensione, cosi' si riconosce il tipo senza leggere il testo.
- **Lingua IT/EN** — il pezzo grosso di questa sessione:
  - `public/i18n.js` (nuovo file, caricato prima di `wm.js`/`app.js`):
    dizionario piatto `STRINGS.it`/`STRINGS.en`, funzione `t(key, vars)` con
    interpolazione `{placeholder}`, lingua salvata in `localStorage`
    (dispositivo, come lo sfondo — si sceglie prima ancora che esista un
    account, non puo' vivere sul server).
  - Schermata di scelta lingua al primissimo avvio (prima della creazione
    account), sezione "Lingua"/"Language" in Sicurezza per cambiarla dopo.
    **Cambiare lingua ricarica sempre la pagina** (`location.reload()`): un
    sacco di costanti (`SECTIONS`, `MONTH_LABELS`, `WEEKDAY_LABELS`,
    `BILLING_LABELS`, `TYPE_LABELS`...) sono calcolate una volta sola
    all'avvio dello script, un semplice re-render non le aggiornerebbe.
  - **Tutte** le viste, modali, toast, conferme, stati vuoti sono tradotti.
    I messaggi di errore che arrivano dal *server* (es. "Il servizio e'
    obbligatorio") restano in italiano — tradurre anche quelli e' un lavoro
    separato (richiede toccare ogni file in `server/routes/`), non fatto qui.
  - **Occhio se aggiungi testo nuovo**: il modulo tiene un alias locale
    `tr` per `I18N.t` (NON si chiama `t`: quel nome era gia' preso ovunque
    nel file per "tag" nei `.map((t) => ...)` — usarlo avrebbe causato bug
    di shadowing silenziosi). Per l'HTML statico in `index.html` (schermata
    di login, taskbar, `<template>` di finestra/modale) si usano gli
    attributi `data-i18n` / `data-i18n-placeholder` / `data-i18n-aria-label`
    / `data-i18n-title`, applicati da `I18N.applyStaticTranslations(root)`.
    Il contenuto dentro `<template>` non e' nel DOM finche' non viene
    clonato: la funzione va richiamata sul nodo clonato subito dopo (vedi
    `openModal()` in `app.js` e `openWindow()` in `wm.js`), non basta
    chiamarla una volta su `document` all'avvio.
  - Verificato con Playwright reale in entrambe le lingue: titoli finestra,
    pulsanti taskbar, aria-label, form, toast, conferme — tutti confermati
    cambiare lingua correttamente dopo il reload.
- **Proposta in sospeso, NON ancora implementata**: l'utente ha descritto un
  redesign di ricerca e cattura veloce (icona lente accanto ad Avvio invece
  della barra sempre visibile; tasto "Nuovo" diventa "+"; il riquadro di
  cattura veloce si sposta in alto/al centro ed e' spostabile; un tasto
  "..." per scegliere un tipo diverso da nota, che poi apre la schermata
  di inserimento completa di quel tipo). Ho risposto riassumendo la mia
  comprensione e aspetto conferma prima di procedere — controlla la
  conversazione per la risposta dell'utente prima di iniziare.

## Sessione 30/08/2026 (settima parte): redesign ricerca e cattura veloce

Proposta confermata dall'utente (vedi sezione precedente) e implementata:

- **Ricerca**: da barra sempre visibile a icona lente in taskbar (accanto ad
  Avvio, `#search-toggle` — stesso id di prima, solo spostato dal topbar
  alla taskbar) che apre `#topbar` al tocco. Stessa barra desktop e mobile
  adesso, nessuna distinzione responsive: `.topbar { display:none }` di
  base, `.topbar.search-open { display:flex }` la mostra. La logica JS
  (`searchToggle`/`topbar` presi per id) non e' cambiata, funziona
  automaticamente col nuovo markup perche' gli id sono rimasti gli stessi.
- **Cattura veloce**: tasto "Nuovo" in taskbar ora e' solo "+". Il riquadro
  si apre in alto al centro (`top:70px; left:50%`) invece che vicino alla
  taskbar, ed e' trascinabile tramite una barretta in cima
  (`.qc-drag-handle`, stessa tecnica pointer-capture di `attachDrag()` in
  `wm.js` ma indipendente — non e' una finestra vera). La posizione
  trascinata non persiste: si torna sempre alla posizione di default alla
  riapertura (deciso cosi' per restare semplice, non e' stato chiesto di
  ricordarla).
- **Cambio tipo esplicito**: nuovo tasto "…" nella riga dei pulsanti apre
  lo stesso menu che prima compariva solo digitando "/" — refactoring:
  la logica "cosa fare quando scegli /doc, /scadenza, /progetto" e' ora in
  `applyTypeCommand(token)`, chiamata sia da testo digitato
  (`selectQcMenuItem`) sia dal tasto "…" (`qcMenuTrigger = {type:'button'}`
  poi la stessa `openQcMenu(QC_COMMANDS)`). Scegliere un tipo diverso da
  nota chiude la cattura veloce e apre la schermata di inserimento completa
  di quel tipo (gia' cosi' da prima per i comandi digitati — qui si e' solo
  aggiunto un secondo modo per arrivarci, la digitazione "/" resta attiva).
- Verificato con Playwright reale (desktop e mobile): apertura/chiusura
  ricerca, posizione e trascinamento della cattura veloce, menu "…" e
  apertura della schermata Drive scegliendo "/doc" da li'.

## Sessione 30/08/2026 (ottava parte): versione build reale, icone Drive, deploy

L'utente ha segnalato di NON vedere le ultime modifiche neanche in
incognito (quindi non e' cache del browser/service worker: e' proprio il
server sul Raspberry Pi a servire codice vecchio) — segno che il suo
`docker compose up -d --build` non aveva mai preso l'ultimo `git pull`, o
piu' probabilmente non aveva ancora rifatto il pull/build dopo gli ultimi
commit di questa sessione.

- **GIT_SHA ricollegato per davvero**: il `Dockerfile` gia' supportava
  l'ARG `GIT_SHA` da tempo, ma **nessuno script lo passava mai** —
  `docker-compose.yml` non aveva `build.args`, `setup.sh`/`setup.ps1`
  chiamavano `docker compose up -d --build` senza calcolare nulla. Il
  risultato era che la build mostrava sempre "dev", inutile per capire se
  un aggiornamento era andato a buon fine. Ora `docker-compose.yml` ha
  `build.args.GIT_SHA: ${GIT_SHA:-dev}` ed entrambi gli script calcolano
  `git rev-parse --short HEAD` e lo esportano prima del build. `/api/health`
  espone sia `version` (da `package.json`, quello che l'utente aveva chiesto
  di mostrare) sia `build` (il commit, mostrato solo se diverso da "dev") —
  la schermata di accesso ora mostra "versione 1.0.0 · a1b2c3d": dopo un
  aggiornamento, se lo sha non cambia, il container non ha preso l'ultimo
  codice.
- **Notifiche push**: l'utente conferma che il problema (notifica generica,
  icona di Chrome invece della nostra) "capita sempre" — non e' escluso che
  fosse proprio dovuto al Pi che girava su un'immagine vecchia da prima che
  esistesse il fix del corpo-mai-vuoto di poco fa. Da riverificare dopo un
  aggiornamento vero con lo sha visibile per confermare che sia la build
  giusta, prima di scavare oltre lato codice.
- **Icone file in Drive**: troppo piccole e con un riquadro visibile
  (bordo/sfondo incassato) che non piaceva. Tolto lo sfondo/bevel,
  ingrandita l'icona (17px → 26px) e il contenitore (40px → 48px): ora
  l'icona e l'estensione stanno semplicemente sopra lo sfondo della riga,
  senza margini visibili.

## Sessione 01/09/2026: ridisegno card Progetti/Bacheca

L'utente ha mandato uno screenshot della vista Progetti segnalando che la
gestione era illeggibile e difficile sia su desktop che mobile. Diagnosi
dal codice + screenshot: la card stipava titolo, una barra di progresso
allo 0% che sembrava una riga a caso (nessun bordo visibile), il testo
"X/Y completati", il chip scadenza e 5 pulsanti di solo testo minuscoli
(colore muto, quasi nessun contrasto) in una colonna larga ~220px — le
azioni andavano a capo in modo imprevedibile, e su mobile restavano lo
stesso stile senza un vero target di tocco (a differenza del Vault, che
già usa pulsanti a icona 40×40 su mobile).

- **Card riscritta** (`public/app.js`, `views.projects`): titolo e chip
  scadenza ora su una riga che va a capo in blocco se serve (mai più
  spezzata a metà parola); anteprima descrizione (2 righe, troncata);
  barra di progresso con bordo sempre visibile + percentuale numerica
  accanto (mai più ambigua a 0/N); colonne vuote mostrano ora
  "Ancora niente qui." invece di restare bianche.
- **Azioni come pulsanti a icona**, non più testo: frecce ← → (nuove
  icone SVG `frecciaSx`/`frecciaDx` in `VECTOR_ICONS`), poi
  matita/cartella/cestino — stesso pattern icone già usato nel Vault,
  raggruppate in due blocchi separati (spostamento a sinistra, resto a
  destra) così non si accavallano mai.
- **CSS** (`public/style.css`): generalizzata `.btn-icon` (prima era
  scoped solo a `.vs-actions`, ora è una classe base riusabile — stessa
  dimensione 27px desktop / 40px mobile di prima, nessun cambio
  visivo per il Vault); aggiunto `.btn:disabled` globale (prima lo stile
  disabilitato esisteva solo per i vecchi pulsanti di testo del board,
  ora serve anche alle nuove frecce a icona); card con più respiro
  (padding/gap aumentati).
- **Verificato con Playwright reale** su un'istanza isolata dell'app
  (server temporaneo su porta 3911, `DB_PATH=:memory:`, non il database
  reale dell'utente — vedi nota sotto) sia a 1280px che a 390px: nessun
  overlap, nessun a-capo imprevedibile, touch target da 40px su mobile.
  Suite server (34/34) invariata. **Non ancora confermato dall'utente
  sull'uso reale** — se ne riparla, verificare prima l'impressione a
  caldo prima di considerare la richiesta chiusa.
- Nota tecnica: per il test è stato lanciato un secondo processo
  `node server/index.js` con `DB_PATH=:memory:` e `SESSION_SECRET`/
  `ENCRYPTION_KEY` dummy, così da non toccare `data/mindkeep.db` né
  `data/.secrets.env` reali (verificato: mtime invariato). Il processo
  di test è stato terminato a fine verifica.

## Prossimi passi

Tutte le fasi pianificate (1-4) del redesign sono complete da tempo e gia'
in produzione (mergiate in `main`, nessuna PR in sospeso). Quello che resta
sono le voci diagnostiche gia' riassunte in cima a questo file ("Leggi
prima questo") — non ripeterle qui, tenerle aggiornate li'. Da qui in poi,
nuovo lavoro = nuove richieste esplicite dell'utente, non voci residue di
un piano — non presumere altro da fare senza chiedere.

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
