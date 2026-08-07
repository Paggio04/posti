# Roadmap — da app della comitiva a prodotto aperto

Questo file è il piano di lavoro di WeTransport: cosa vogliamo che diventi, in che ordine, e
quando ogni pezzo si può dire finito. Nasce dall'intervista del 24/07/2026.

Regola d'uso: un cantiere alla volta, su un branch, con il suo collaudo. Si aggiorna man mano.
Il *perché* delle scelte architetturali sta in `docs/adr/`; qui sta il *cosa manca*.

---

## Obiettivo

Portare WeTransport da **app privata di una comitiva** (oggi: online, funzionante, usata da
nessuno) a **prodotto utilizzabile da chiunque**, senza mai lasciare l'app esposta nel frattempo.

Due traguardi distinti, in quest'ordine:

| | Traguardo | Vuol dire |
|---|---|---|
| **T1** | **Pronta per la comitiva** | I miei amici si registrano e la usano per i passaggi veri, senza che io spieghi niente. Niente dati visibili a chi non c'entra. Posso pubblicare senza paura di rompere. |
| **T2** | **Aperta a chiunque** | Chiunque si registra, crea o entra in una comitiva, e può trovare passaggi anche fuori dal proprio gruppo. Con gli strumenti che servono quando si sale in macchina con sconosciuti. |

Non c'è scadenza. C'è un vincolo: **T1 completo prima di iniziare T2**, perché T2 apre l'app a
persone che non conosco e ogni buco aperto in quel momento è un problema reale, non teorico.

---

## Decisioni prese (intervista 24/07/2026)

| # | Decisione | Scelta | Alternative scartate |
|---|---|---|---|
| **D1** | Passaggi senza gruppo | **Spariscono.** Ogni passaggio, richiesta e commento appartiene a una comitiva. La ricerca "fuori dal mio gruppo" torna dopo, come funzione progettata (C9), non come effetto collaterale. | Bacheca pubblica subito; schema nuovo da zero |
| **D2** | Visibilità profili | **Solo chi condivide almeno un gruppo con me.** Quando arriverà C9, si estende a "…o chi guida un passaggio che posso vedere" — senza quella estensione l'app mostrerebbe passaggi senza nome. | Solo stessa auto (rompe la lista membri); lasciare aperto |
| **D3** | Catena di deploy | **Anteprima + test bloccanti + migrazioni numerate.** `main` resta il deploy, ma ci arriva solo roba già verificata su un'anteprima. Lo schema smette di essere un file copiato a mano. | Lasciare com'è; secondo progetto Supabase di staging (rimandato a C9, quando i dati sono di sconosciuti) |
| **D4** | Dove vive il piano | **Questo file.** Approvato una volta, eseguito cantiere per cantiere. | Issue GitHub; nessun piano |

Il database **non** viene riscritto: l'isolamento fra comitive esiste già (`groups`,
`group_members`, `is_member()`). Quello che manca è togliere le righe orfane e stringere due
policy troppo larghe.

---

## Dove siamo (05/08/2026)

**La Fase 7 è scritta per intero: tredici cantieri su quattordici, e il quattordicesimo (C29) è
stato scartato invece che rimandato.** Con loro le migrazioni `026`-`033`, verdi in CI e **da
applicare a mano** come tutte le altre. Non cambia però la frase che conta, che è la stessa del
27/07: quello che separa «T1 tecnico» da T1 non è codice, ed è sotto.

Due cose sono ferme e vanno dette qui, perché da sole non si sbloccano:

- **C13, le notifiche.** C28 e C30 accodano, e la coda non la svuota nessuno: mancano le chiavi
  VAPID, il deploy della Edge Function e `pg_cron`. Con la Fase 7 la coda ha adesso **cinque**
  tipi di evento invece di tre, quindi il valore di accendere C13 è cresciuto e il costo è
  rimasto lo stesso — mezz'ora di lavoro fuori dal repo.
- **Il collaudo a video.** Non è mai stato fatto, e adesso c'è più roba da guardare.

**Fasi 0-3 chiuse, e della Fase 4 mancano solo le chiavi delle notifiche.** `main` è al merge
della PR #9: le sei PR aperte in giornata sono state pubblicate tutte, e con loro le migrazioni
fino alla `017`. Ramo protetto da un ruleset versionato, e il sito vivo serve tutto quello che
segue:

| Cantiere | Stato |
|---|---|
| C12 PWA | fatto nel codice, icone `maskable` comprese, **da installare su un telefono vero** |
| C13 notifiche a scheda chiusa | **metà fatta**: coda, trigger, iscrizioni e interruttore ci sono e sono verificati in CI; restano le chiavi VAPID, il deploy della Edge Function e `pg_cron`, che il repo non può fare |
| C14 servizi esterni | **chiuso** (Web Share, `.ics`, navigazione sul punto vero) |
| C15 estetica | fatto al secondo tentativo, carattere compreso; il giudizio finale è di chi la usa. **L'accesso non era compreso**: rifatto in C39 il 05/08/2026, insieme alle regole di C15 rimaste inapplicate altrove |
| C18 standard dello Starter | **chiuso nei due versi**: il 27/07/2026 le lezioni sono tornate nello Starter del vault (`Permissions-Policy`, migrazioni numerate, ordine codice/schema, «provalo al contrario») |
| C21 coordinate nel payload | **fatto e applicato** (`015` + `016`), nell'ordine giusto |
| C22 la zona nel profilo | **scritto** (`018` + `019`), da pubblicare e applicare — è lo stesso buco di C21, sull'altra tabella |
| C23 permessi delle funzioni | **scritto** (`020`), da applicare — `grant execute to public` è il default di Postgres, e si vedeva solo andando a cercarlo |
| C24 codici invito indovinabili | **aperto, non affrontato**: la `020` chiude la parte che riguarda chi non ha un account, resta quella che riguarda chi ce l'ha. Si affronta dopo la Fase A. C38 ci si è appoggiato sopra e l'ha lasciato dov'era: il ragionamento sta nel suo cantiere |
| Fase 7, le funzioni della comitiva | **scritta il 05/08/2026**: tredici cantieri su quattordici, migrazioni `026`-`033` da applicare. La tabella cantiere per cantiere è nella Fase 7 |

**T1 è raggiunto sul piano tecnico.** Quello che manca per dire "pronta per la comitiva" non è
codice: è **gente vera che la usa**, e un collaudo a video che non è mai stato fatto. Sotto, cosa
esattamente.

### Il difetto peggiore della Fase 4, e perché nessun controllo lo vedeva

`Permissions-Policy: geolocation=()` teneva spenta la geolocalizzazione **anche per la pagina
stessa**. Quindi da quando C9 esiste, sul sito vivo: "Parto da qui" falliva sempre, nessun passaggio
poteva avere coordinate, `visibilita = 'zona'` era irraggiungibile perché il form la rifiuta senza
coordinate, e la zona sul profilo non si impostava. **Un cantiere intero, pubblicato e con i suoi
test verdi, inerte.** Lint, sintassi e test sullo schema non potevano trovarlo: un header non è né
codice né schema. Ora c'è uno smoke test che lo verifica in un browser.

### Cosa non è stato verificato da un essere umano

Tutto quello che segue è verificato **automaticamente** e da nessun altro. Serve un telefono e due
account veri in due comitive diverse:

- **C9:** "Parto da qui" con GPS vero; pubblicare in **zona**; un secondo account entro 25 km lo
  vede e uno fuori raggio no
- **C14:** il `.ics` si apre in Calendario **con l'ora giusta**; il link "Naviga al ritrovo" da
  dentro la comitiva e "Punto di ritrovo su Maps" da fuori (è la regola di `coordinateVisibili()`:
  il punto di partenza di una persona può essere casa sua)
- **C12:** installarla da iOS e da Android, avvio senza barra del browser, l'icona dentro la maschera
  circolare di Android (le `maskable` ora ci sono e la geometria è verificata, ma vederla ritagliata
  da un telefono vero è un'altra cosa), modalità aereo
- **C15:** la prova del nove — coperti logo e nome, si capisce che è questa app?
- **Fase 3 intera:** segnalazione (il segnalato non deve saperlo), blocco nei due sensi,
  sospensione, esportazione, e **la cancellazione di un account che possiede una comitiva**, che è
  il controllo più importante perché un errore lì danneggia gli altri
- **Fase 7 intera** (05/08/2026). Le viste nuove sono state rese in un browser vero con un finto
  Supabase — e quella passata ha trovato un difetto che nessun test aveva visto: in vista
  settimana restava «Metti la tua auto», che avrebbe pubblicato per il giorno di prima. Resta da
  guardare con gente vera: l'ospite (il posto deve risultare occupato **all'altro account**), la
  coppia andata/ritorno presa da un passeggero, il ritardo annunciato da un telefono e visto
  sull'altro **senza ricaricare**, e la quota proposta su un tragitto vero — è l'unico numero di
  questa fase che si può giudicare solo sapendo quanto costa davvero quella strada

### Le quattro cose che il repo non può fare da solo

| Cosa | Dove | Stato |
|---|---|---|
| Titolare del trattamento | `privacy.html` | **fatto** |
| Regione del progetto Supabase | Supabase → Settings → General | **fatto** — `eu-west-2`, cioè **Londra**: fuori dall'Unione, e l'informativa lo dice citando l'adeguatezza |
| Revocare il token Supabase del 24/07 | Supabase → Account → Access Tokens | **fatto** il 27/07/2026: nessun token attivo sull'account |
| Due account di prova + segreti `WT_TEST_*` | Supabase + GitHub Secrets | assenti |

### Tre lezioni pagate, che vale rispettare

1. **Le coordinate speculari si calcolano, non si scrivono.** Le ruote dell'auto erano fuori di 4px
   con quelle di sinistra tagliate dal bordo, le file non equidistanti, i tondi della navigazione
   posizionati a occhio. Ora c'è `specchia(x, w)` e le misure della barra sono variabili da cui si
   ricava tutto.
2. **Un controllo che misura la cosa sbagliata è peggio di nessun controllo**, perché autorizza a
   chiudere il caso. La mia misura del tondo diceva "centrato a 0.02px" ignorando un bordo da 4px;
   il difetto l'ha trovato l'occhio del proprietario. Lo stesso vale per uno `str.replace` muto: ha
   fatto credere per due commit che la versione della cache fosse salita.
3. **La CI ha avuto ragione tre volte di fila**, e due volte contro una mia diagnosi. Se un test è
   rosso e la spiegazione comoda è "il test è fragile", quasi sempre la spiegazione è sbagliata.

### L'ordine di pubblicazione, che alla 012-014 era l'opposto della 011 — *storia, e la regola che resta*

> Questa sezione descrive la pubblicazione della Fase 3, che è **già avvenuta** (male, vedi sotto).
> Le migrazioni 012-014 sono applicate dal 25/07/2026. Resta per la regola, non per le istruzioni.

**Andavano applicate prima del codice**, e non è andata così: il codice è stato pubblicato per
primo, quindi il sito è rimasto rotto — nome di tutti come prefisso dell'email, pubblicazione di
un'auto in errore — finché le tre migrazioni non sono state applicate a mano dal SQL editor. Danno
piccolo solo perché nessuno la stava usando.

Perché andavano prima: `profiles.sospeso`, `profiles.zona_lat`, `rides.visibilita` e la tabella
`user_reports` non esistevano, e il codice nuovo le legge al primo caricamento — `ensureProfile`
chiede `sospeso`, `loadBlocked` interroga `user_blocks`, la pubblicazione scrive `visibilita`.

Cosa succede davvero se si pubblica il codice prima (tracciato, non supposto): la pagina **si apre**
— supabase-js restituisce l'errore invece di sollevarlo — ma `ensureProfile` non trova il profilo,
ricade sul ripiego e **il nome di tutti torna a essere il prefisso dell'email**; soprattutto,
**pubblicare un'auto fallisce**, perche' l'insert contiene una colonna che non esiste. Non e' una
schermata bianca, e' di peggio: sembra funzionare e non fa la cosa per cui esiste.

Con la 011 la regola era il contrario, e non è una contraddizione: quella **restringeva** letture che
il codice vecchio non sapeva gestire, quindi andava dopo. Queste tre **aggiungono** cose che il
codice nuovo pretende, quindi vanno prima. La regola vera, che vale per entrambe:

> Si applica per prima la metà che l'altra non può ignorare. Una migrazione che toglie va dopo il
> codice che regge; una migrazione che aggiunge va prima del codice che se ne serve.

Applicarle mentre il sito vivo serve ancora l'app vecchia **non rompe niente**, ed è il motivo per
cui si può fare in quest'ordine: le colonne nuove hanno un default che conserva il comportamento di
oggi (`visibilita = 'gruppo'`), le tabelle nuove l'app vecchia non le guarda, e le restrizioni non
hanno su cosa mordere — nessun blocco, nessun sospeso, nessun passaggio aperto fuori dalla comitiva.

---

## Fase 0 — Rete di sicurezza (prima di toccare qualsiasi altra cosa)

Oggi ogni push su `main` è la pubblicazione, e gli smoke test girano **dopo**, contro il sito
vivo: se rompo qualcosa, lo rompo davanti a chi sta usando l'app. Tutto il resto della roadmap
tocca sicurezza e schema, cioè le cose dove sbagliare costa di più. Questa fase viene prima.

### C1 — Anteprima per ogni modifica, test che bloccano — *fatto e collaudato sulla PR #1*
- **Obiettivo:** poter provare una modifica a un indirizzo temporaneo prima che la vedano gli utenti.
- **Fatto:** il job `e2e-anteprima` aspetta lo stato di deploy che Netlify scrive sul commit della
  PR, ricava da lì l'indirizzo dell'anteprima e ci lancia Playwright; niente più `sleep 60` alla
  cieca. I test leggono l'indirizzo da `BASE_URL` (`playwright.config.js`) invece di averlo scritto
  dentro. Il vecchio job sul sito vivo resta come rete di sicurezza dopo la pubblicazione
  (`e2e-produzione`), ma non è più l'unica difesa.
- **I Deploy Preview su Netlify erano già attivi**: verificato sulla PR #1, che ne ha avuto uno.
- **Collaudato sulla PR #1** (24/07/2026): Netlify ha pubblicato l'anteprima, il job l'ha trovata
  dallo stato del commit in pochi secondi (non dal ripiego, che avrebbe atteso dieci minuti) e ha
  lanciato i tre smoke test contro `https://deploy-preview-1--wetransport.netlify.app`. Tutti verdi,
  **prima** di qualsiasi merge. Il job sul sito vivo è stato saltato, come previsto sulle PR.
- **Un difetto trovato dal primo giro di CI:** il workflow era fissato a Node 20, mentre
  html-validate 11 usa `fs.globSync`, che esiste da Node 22. In locale passava (Node 22), in CI no.
  Alzato a Node 24 e dichiarato `engines` in `package.json`.
- **Controlli obbligatori: fatti** (25/07/2026, ruleset `Claude`). `checks`, `schema` ed
  `e2e-anteprima` sono richiesti su `main`, insieme al divieto di cancellare il ramo e di
  riscriverne la storia; nessuna eccezione, nemmeno per il proprietario. La configurazione è
  copiata in `.github/rulesets/main.json` — vedi `.github/rulesets/README.md`. **C1 è chiuso.**
- Nota per la prossima volta: la PR #1 è stata pubblicata *prima* che la regola esistesse, quindi
  era verde per fortuna e non per costruzione. La rete di sicurezza va accesa prima di servirsene,
  non dopo.

### C2 — Migrazioni numerate al posto del file unico — *fatto e verificato*
- **Obiettivo:** sapere sempre quale schema è davvero applicato.
- **Fatto:** schema spezzato in 10 file in `supabase/migrations/`, ognuno ripetibile e registrato
  in `public.schema_migrations`. La CI (job `schema`) parte da un Postgres vuoto, applica tutto in
  ordine e poi riapplica tutto: se una delle due passate fallisce è rossa. Il perché in
  `docs/adr/002-migrazioni-numerate.md`.
- **Verificato su Postgres 16 vuoto:** le migrazioni ricreano il backend da zero e si possono
  rilanciare. Confronto con lo schema del vecchio file: 8 tabelle, 43 colonne, 9 funzioni, 5
  trigger, 14 indici **identici**, più una policy recuperata.
- **Due difetti trovati facendolo**, peggiori del doppione che cercavo:
  - `supabase-setup.sql` **non ricreava il backend da zero**, contrariamente a quanto dicevano
    README e ADR 001: alla riga 234 creava una policy su `ride_comments`, tabella definita alla
    riga 338. Su un database vuoto si fermava lì.
  - Conseguenza sulla ricostruzione da zero: la policy `admin all` su `ride_comments` non veniva
    mai creata. Ora c'è. (In produzione invece c'era: vedi la correzione qui sotto.)
- **Applicate in produzione il 24/07/2026**, tutte, in ordine. `schema_migrations` ne registra 11.
- **Una deduzione da correggere:** avevo scritto che l'amministratore non aveva mai potuto moderare
  i commenti. Falso sul database vivo: leggendo `pg_policies` prima di applicare, la policy
  `admin all` su `ride_comments` c'era già — era stata incollata a parte, dopo la creazione della
  tabella. Il difetto riguardava la ricostruzione da zero, non la produzione.

### C3 — Controlli locali accesi — *fatto*
- **Obiettivo:** `pre-volo.py` smette di saltare metà dei controlli.
- **Fatto:** `package.json` con ESLint e html-validate come dipendenze **di sviluppo** (il sito
  resta senza build: servono agli strumenti, non all'app). Le regole ESLint non sono più scritte
  dentro `ci.yml` e rigenerate a ogni build: stanno in `eslint.config.mjs`, versionate, stessa
  fonte in locale e in CI. Regole html-validate in `.htmlvalidate.json`.
- **`npm run check`** fa lint + validazione in un colpo; la CI ora chiama gli stessi comandi.
- **Validazione HTML ora bloccante** invece che informativa (`|| true`), perché è a zero errori.
  Le regole di puro stile sono spente (`void-style`, `no-inline-style`, `no-redundant-for`) e
  `no-implicit-button-type` resta come avviso: 20 bottoni senza `type` esplicito, roba da C7.
- **Tre difetti di accessibilità corretti** per arrivarci: la `<label>` della password teneva
  dentro anche il bottone dell'occhio (una etichetta per due controlli), il bottone del nome
  utente non aveva testo accessibile finché il JS non lo riempiva, il titolo del dialogo era un
  `<h3>` vuoto.
- **Collaudo fatto:** schermata di accesso resa in locale e confrontata pixel per pixel prima e
  dopo la modifica: **identica**. Alla prima passata non lo era — il campo password aveva perso il
  peso del carattere che ereditava dalla `<label>` — ed è stato sistemato.

---

## Fase 1 — Chiudere i due buchi (T1)

### C4 — Tutto dentro un gruppo *(decisione D1)* — *scritto e verificato sul database; resta il collaudo a video*
- **Obiettivo:** nessuna riga di dati senza una comitiva che la possiede.
- **Database** (`010_gruppo_obbligatorio.sql`): `group_id` obbligatorio su `rides` e
  `ride_requests`; policy e trigger senza i rami `is null` e senza i `coalesce(..., '000...')`;
  le righe orfane finiscono nelle tabelle `*_archivio_senza_gruppo` (RLS attiva, nessuna policy:
  restano nel database, invisibili dal client) e poi spariscono da quelle vive. **Niente si cancella
  senza essere prima copiato.**
- **Falla in più trovata e chiusa:** per pubblicare bastava dichiararsi guidatore. Chi conosceva
  l'id di un gruppo poteva pubblicarci dentro un'auto **senza esserne membro**. Ora la policy di
  scrittura richiede l'appartenenza — su auto, richieste, commenti e lista d'attesa.
- **App:** sparisce la pillola "Tutti"; al primo accesso o crei un gruppo o entri con un codice;
  la comitiva scelta si ricorda fra una sessione e l'altra; senza comitiva la Home mostra solo il
  benvenuto invece di una schermata vuota e inerte.
- **Incoerenza sanata:** con "Tutti" attivo, la Home mostrava solo i passaggi *senza gruppo*, mentre
  Storico e Statistiche mostravano *tutto il visibile*. Stessa pillola, tre significati diversi.
- **Verificato su Postgres 16** (`supabase/test/`, e ora in CI a ogni push):
  - Carla, che sta in un'altra comitiva, vede 0 auto, 0 prenotazioni e 1 solo gruppo (il suo);
  - Bruno, che è del gruppo, vede l'auto;
  - Carla **non riesce** a pubblicare nel gruppo di Ada;
  - un'auto senza comitiva **non si inserisce più**;
  - due persone sullo stesso sedile: ne passa una sola;
  - aggiornamento dal vecchio schema con dati orfani dentro: archivio pieno, dati del gruppo
    intatti, archivio invisibile al client.
- **Applicata in produzione il 24/07/2026.** Stato prima: 4 utenti, 1 gruppo con 0 membri, 1 auto
  senza comitiva. Dopo: quell'auto è nell'archivio, `group_id` è obbligatorio su `rides` e
  `ride_requests`, le policy nuove sono attive. Nessun dato perso.
- **Disallineamento chiuso il 25/07/2026**: la PR #1 è stata pubblicata (merge alle 02:01, CI verde
  su `main`, deploy Netlify andato, smoke sul sito vivo verdi). Fino a quel momento il database non
  accettava più passaggi senza comitiva mentre il sito serviva ancora l'app vecchia, quella con la
  pillola "Tutti": Home vuota e pubblicazione in errore. Con 0 membri nei gruppi non l'ha visto
  nessuno.
- **Collaudo a video: fatto da C8**, con due account veri in due comitive diverse. Restano da vedere
  da utente vero, non da test, le viste Storico e Statistiche.

### C5 — Profili chiusi *(decisione D2)* — *fatto, applicato in produzione*
- **Obiettivo:** smettere di mostrare nome e avatar di tutti a tutti.
- **Database** (`011_profili_chiusi.sql`): `profiles read using (true)` diventa "il mio profilo,
  più chi condivide con me almeno una comitiva, più l'amministratore". Il confronto passa da
  `condivide_gruppo()`, `security definer` per la stessa ragione di `is_member()`: senza, la policy
  su `profiles` interrogherebbe `group_members`, che ha le sue policy, e si andrebbe in ricorsione.
- **Un caso che prima non poteva esistere:** chi **lascia** una comitiva sparisce dai profili
  leggibili, ma le sue auto e le sue prenotazioni restano nello storico. L'app faceva
  `r.driver.display_name` in 14 punti senza rete: con il profilo nascosto l'incorporamento torna
  nullo e **la schermata andava in errore**. Ora tutti passano da `nomeDi()`, che mostra
  "Ex membro". Trovato leggendo il codice dopo aver scritto la policy, non da un test.
- **Verificato su Postgres 16** (nel test di isolamento, quindi anche in CI): chi sta in un'altra
  comitiva vede **un solo profilo, il proprio**; chi è nel gruppo vede sé, Ada e Dino, e **non**
  vede Carla; nessuno perde di vista il proprio profilo, che servirebbe all'app per sapere come ci
  si chiama.
- **Ordine di applicazione, importante:** la 011 va applicata in produzione **dopo** aver pubblicato
  questo ramo, non prima. Restringe letture che il codice vecchio non sa gestire: prima il codice
  che regge i profili nascosti, poi la regola che li nasconde.
- **Applicata in produzione**, nell'ordine giusto: il 25/07/2026 la funzione `condivide_gruppo`
  risponde sul progetto vivo, e la crea solo la 011. Con questa, `schema_migrations` registra tutte
  e 12 le migrazioni presenti nel repo. **Fase 1 chiusa.**
- **Collaudo a video:** account estraneo → home, storico, statistiche, commenti: nessun nome di
  gente fuori dalla propria comitiva, e nessun buco al posto di una persona.

---

## Fase 2 — Rinforzare quello che c'è (T1)

### C6 — Bug noti da chiudere — *fatto*
| Bug | Dove | Stato |
|---|---|---|
| Avatar Google bloccati dalla CSP | `netlify.toml`, `img-src 'self' data:` | **Chiuso.** Chi entrava con Google aveva un avatar che punta a `lh3.googleusercontent.com` e il browser lo bloccava: la funzione era scritta dal 21/07 e non si è mai vista. Aggiunto `https://*.googleusercontent.com` alla sola direttiva `img-src`. |
| `ride_waitlist` definita due volte | `supabase-setup.sql:260` e `:303` | **Chiuso da C2**: nelle migrazioni la lista d'attesa è definita una volta sola. |
| `meta description` mancante | `privacy.html` | **Chiusa.** |

**Collaudo della CSP, fatto col browser e non a occhio:** pagina servita in locale con
*esattamente* l'intestazione di `netlify.toml`, poi due immagini iniettate nel documento. Quella su
`lh3.googleusercontent.com` **non viene più bloccata**; quella su un dominio qualsiasi **continua a
esserlo**. La regola si è aperta quanto serviva e non un dito di più.

### C7 — Revisione integrale di `app.js` — *fatto*
- **Obiettivo:** trovare tutti i bug, non i primi che saltano fuori.
- **Fatto:** lettura riga per riga di tutte le 1334 righe in **una sola passata**, con tutte le
  classi di controllo insieme. Metodo imposto da `Regole.md`, e ha ripagato subito.

**La prima cosa trovata è stato un mio errore.** La passata di C5, fatta cercando i punti con
`grep`, ne aveva mancati **tre**: `Guida ${ride.driver.display_name}` sulla scheda dell'auto, il
testo di condivisione del singolo passaggio, e l'elenco "A bordo" del riepilogo di giornata. Tutti e
tre sarebbero andati in errore con un profilo nascosto — cioè proprio il caso che C5 introduceva.
È l'esempio di manuale del perché `Regole.md` vieta le passate incrementali.

**Difetti corretti**

| Cosa | Dove | Perché contava |
|---|---|---|
| Tre letture di profilo senza rete | scheda auto, condivisione, riepilogo | Errore in pagina con un profilo nascosto (regressione di C5) |
| `innerHTML` con l'indirizzo dell'avatar | `renderProfile` | `SECURITY.md` dichiara "nessun `innerHTML` con input utente": non era vero. L'indirizzo arriva dai metadati OAuth o dal profilo, modificabile via API; in una stringa HTML basta una virgoletta per uscire dall'attributo. Ora si costruisce col DOM |
| Sei operazioni che fallivano in silenzio | libera posto, annulla passaggio, esci dal gruppo, esci dalla lista, elimina commento | L'app diceva "fatto" anche quando il database rifiutava. Ora ognuna controlla l'errore e lo mostra |
| `clearMyRequest()` non attesa, due volte | pubblicazione auto, prenotazione posto | La cancellazione poteva arrivare **dopo** il ricaricamento: restavi fra chi "cerca un passaggio" pur essendo a bordo, fino al refresh dopo |
| Escape dei nomi solo su `<` | statistiche, "tocca a te guidare" | Una `&` nel nome rompeva il testo. Ora un solo `escapeHtml()` per entrambi |
| Codice morto di C4 | `renderWalkers`, `clearMyRequest`, riepilogo | Ramo "senza gruppo" irraggiungibile, e un ternario con i due rami identici |

**Trovati e lasciati stare, con motivo**
- La notifica "movimenti sui sedili" scatta anche per una propria azione, se la scheda è in
  secondo piano. Fastidio minimo, e la logica per distinguere costa più di quanto renda: se dà
  noia si risolve in C13, dove le notifiche vengono ripensate.
- Il conto alla rovescia "parte tra N minuti" è calcolato al disegno e non si aggiorna da solo.
  Un timer per tenerlo vivo è lavoro da C15, non un difetto di correttezza.
- La chiave `posti-howto-done` in `localStorage` porta ancora il vecchio nome del progetto.
  Rinominarla farebbe ricomparire il banner a chi l'aveva già chiuso: non vale il cambio.
- Il conteggio sul bottone dei commenti non si aggiorna dopo averne scritto uno, fino al
  ricaricamento successivo. Cosmetico.
- *(trovate durante C10, con un confronto fra le classi usate dal JS e quelle definite nel
  CSS)* Tre classi non esistono in `style.css`: `maps-link` sul link al ritrovo, che quindi
  resta un'ancora senza stile, e i due modificatori `fuel` e `waitlist-row`, che non
  cambiano niente rispetto alla classe di base. Nessuna rompe la pagina; darle uno stile e'
  lavoro di C15, dove l'aspetto si decide tutto insieme invece che un pezzo per volta.

**Collaudo:** lint e validazione verdi, schermata di accesso identica al riferimento pixel per
pixel. Le correzioni sui percorsi con utenti veri (posto liberato, passaggio annullato, uscita dal
gruppo) restano da vedere a video: sono esattamente i flussi che C8 deve coprire con i test.

### C8 — Test end-to-end sui flussi veri — *fatto*
- **Obiettivo:** gli smoke coprivano solo la schermata di accesso. Il cuore dell'app — pubblicare,
  prenotare, vedere l'aggiornamento in tempo reale — non era testato da niente.
- **Fatto:** `tests/flussi.spec.js`, un viaggio completo con **due utenti in due schede separate**:
  Ada crea la comitiva e pubblica l'auto → Bruno, che non è del gruppo, **non vede niente** →
  Bruno entra col codice e la vede → prenota un sedile → **Ada lo vede senza ricaricare** (realtime)
  → pulizia (passaggio annullato, entrambi escono dal gruppo). Zero errori in pagina, verificato.
- **Girato per davvero**, con due account veri sul Supabase di produzione, creati per l'occasione e
  **cancellati subito dopo**. È anche il collaudo a video che mancava a C4: l'isolamento fra comitive
  visto con due utenti, non solo dedotto dalle policy.
- **Ha trovato subito un bug vero, e non del test:** `render()` chiudeva con `switchView('home')`
  dopo una catena di attese (profilo, gruppi). **Chi tocca una scheda mentre l'app carica si vedeva
  annullare il tocco e riportare alla Home.** Su telefono lento quella finestra dura secondi. Ora la
  Home si impone solo se nessuna scheda è già aperta.
- **Verificata anche la verifica:** tolta la correzione, il test torna a fallire; rimessa, passa.
  Un test che non fallisce quando il bug c'è non serve a niente.
- **In CI** il flusso a due utenti gira sull'anteprima **solo se esistono i segreti**
  `WT_TEST_EMAIL_A`, `WT_TEST_EMAIL_B`, `WT_TEST_PASSWORD` (due account di prova già confermati).
  Senza, si salta e restano gli smoke: nessun falso rosso su chi clona il repo.
- **Resta da fare a mano:** creare i due account di prova stabili e metterne le credenziali nei
  segreti del repo, se si vuole quel test a ogni PR. Nell'ultima PR i tre segreti erano vuoti e il
  flusso a due utenti si è saltato: `1 skipped, 3 passed`. Il ripiego funziona come previsto, ma il
  cuore dell'app in CI resta scoperto.

---

## Fase 3 — Aprire al pubblico (T2)

Da qui in poi l'app la usano persone che non conosco. Nessuno di questi cantieri parte prima che
la Fase 1 sia chiusa.

### C9 — Passaggi in zona *(la D dell'intervista)* — *fatto, da collaudare a video*
- **Obiettivo:** trovare un passaggio da qualcuno che sta in zona ma non è della mia comitiva.
- **Fatto** (`014_passaggi_in_zona.sql` + interfaccia): campo `visibilita` sul passaggio
  (`gruppo` / `zona` / `pubblico`), coordinate di partenza e arrivo, zona sul profilo, e
  l'estensione di D2 — si legge il nome di chi guida un passaggio che si vede, e di chi ci è
  a bordo.
- **Il default non cambia niente.** Un passaggio nasce `gruppo`, cioè esattamente com'era prima:
  chi vuole uscire dalla comitiva lo deve dire. È l'unico modo di aggiungere un'apertura senza
  aprire retroattivamente quello che c'è già.
- **Tre scelte, nessuna obbligata:**
  - **Niente geocodifica di terzi.** D6 dice API native del browser: le coordinate vengono da
    `navigator.geolocation`, cioè dal telefono di chi pubblica, e il nome del luogo resta il testo
    libero di prima. Un geocoder sarebbe una voce in più nella CSP e un terzo che vede dove vanno
    gli utenti.
  - **La zona è un punto più un raggio (25 km)**, non un comune: i confini amministrativi non
    dicono niente su quanto è comodo un passaggio, e servirebbe un elenco da mantenere. Il raggio
    sta in `raggio_zona_km()`, una riga sola da cambiare.
  - **Il gruppo resta obbligatorio anche per i passaggi pubblici** (D1). Un passaggio pubblico è di
    una comitiva che si lascia guardare da fuori, non un passaggio senza padrone: archiviazione e
    regole di scrittura restano quelle. Si può aprire il proprio passaggio, non pubblicarne uno in
    casa d'altri.
- **La regola di visibilità sta in una funzione sola**, `passaggio_visibile()`, e non
  nell'espressione della policy: serve anche alla policy dei profili, che altrimenti dovrebbe
  riscriverla e prima o poi divergere. Le due sottoquery di `profiles read` leggono `rides` e
  `seat_claims` con le loro policy attive, quindi vedono esattamente il visibile: se la regola
  cambia, cambiano anche loro da sole.
- **Il blocco viene prima di tutto**, anche di `pubblico`: una persona bloccata non ricompare
  perché qualcuno ha aperto il proprio passaggio a chiunque.
- **Storico e Statistiche restano dentro la comitiva**, di proposito: servono a sapere di chi è il
  turno, e un passaggio preso fuori falserebbe la rotazione. Il sottotitolo di quelle viste lo dice
  già ("Gruppo: …").
- **Difetto trovato facendolo, e non era mio:** aggiungere una colonna a `rides` **rompeva la
  ripetibilità della 010**, che copia nell'archivio con `insert … select *`. Alla seconda passata
  l'insert trovava più colonne della destinazione e il job `schema` diventava rosso. Ora 014
  allinea anche l'archivio, e la regola è scritta lì: chi tocca `rides` tocca anche l'archivio.
- **Verificato:** `supabase/test/verifica-zona.sql`, in CI. Provato al contrario, sei mutazioni su
  sei fanno diventare rosso il test — compresa "raggio a 1000 km" e "il blocco non vince più su
  pubblico".
- **Fatto quando:** cerco un passaggio fuori dal mio gruppo, lo trovo, e continuo a non vedere
  niente dei gruppi a cui non appartengo. **Raggiunto**, ed è il controllo 6 del test.
- **Resta il collaudo a video:** due account veri in due comitive diverse, con la posizione vera del
  telefono. `navigator.geolocation` non si può collaudare da un test di database.

### C10 — Sicurezza delle persone — *fatto, da collaudare a video*
- **Obiettivo:** un'app dove sconosciuti salgono in macchina insieme e non c'è modo di segnalare
  nessuno non è pronta per il pubblico. Vale più di qualsiasi funzione.
- **Fatto** (`012_sicurezza_persone.sql` + interfaccia): tre cose distinte, che si confondono
  facilmente.
  - **Segnalazione**: motivo fra cinque, dettagli facoltativi, e la vedono solo chi la scrive e
    l'amministratore. Il segnalato **non sa di esserlo**: se lo sapesse, segnalare diventerebbe un
    modo per litigare invece che per farsi aiutare. Una sola aperta per coppia, altrimenti chi vuole
    molestare qualcuno lo fa riempiendo la coda dell'amministratore.
  - **Blocco**: decisione propria, immediata, senza passare da nessuno. Vale **nei due sensi** anche
    se lo decide uno solo: spariscono auto, commenti e richieste dell'altro, e non si sale in
    macchina insieme.
  - **Sospensione**: decisione dell'amministratore. Toglie la parola, non la vista — si legge tutto
    e si può ancora annullare quello che si era preso, perché liberare un posto toglie ingombro
    agli altri.
- **Due scelte non ovvie**, entrambe prese guardando cosa succede il giorno dopo:
  - **Il blocco non cancella niente.** L'auto di una persona bloccata sparisce *tranne* se ci sei
    già sopra: nasconderla lascerebbe una prenotazione invisibile e impossibile da annullare. Per la
    stessa ragione al contrario, i sedili occupati restano visibili — un posto preso che risultasse
    libero verrebbe prenotato e poi rifiutato dall'indice unico, con un errore senza spiegazione.
    Sparisce il nome, resta l'ingombro.
  - **Sul nome il blocco è asimmetrico.** Chi blocca continua a leggere il profilo di chi ha
    bloccato; chi subisce il blocco no. Senza, la lista dei bloccati sarebbe un elenco di
    sconosciuti e non si potrebbe più sbloccare nessuno. Resta dentro il vincolo di 011: fuori dalla
    comitiva condivisa non si legge comunque niente, quindi bloccare non è un modo per tenersi
    leggibile una persona.
- **Il punto meno ovvio è la lista d'attesa:** `promote_waitlist()` è `security definer`, quindi non
  passa da nessuna policy e avrebbe fatto salire un bloccato sull'auto di chi l'ha bloccato. La
  ferma un trigger che guarda **le righe**, non `auth.uid()`, perché lì chi scrive non è chi sale.
- **Difetto trovato scrivendo il test, ed è di C2/008:** *il primo amministratore non si poteva
  nominare.* L'update dal SQL editor lo rifiutava il trigger stesso — lì `auth.uid()` è nullo,
  quindi `is_admin()` è falso, quindi "non sei amministratore, non puoi nominarne uno". Non se n'era
  accorto nessuno perché un amministratore non è mai esistito: la coda delle segnalazioni sarebbe
  rimasta senza nessuno che la legge. Corretto in 012.
- **Verificato:** `supabase/test/verifica-sicurezza.sql`, in CI a ogni push, e **provato al
  contrario**: tolta una protezione alla volta, ogni mutazione fa diventare rosso il test. Le due
  che restano verdi sono cinture ridondanti, e nel file c'è scritto quali.
- **Fatto quando** *(criterio originale)*: posso segnalare, bloccare, e vedere le segnalazioni; un
  utente sospeso non entra più. **Con una precisazione presa qui:** sospeso *entra* ma non scrive.
  Il ban vero su `auth.users` richiederebbe una Edge Function con `service_role`, cioè una chiave
  che apre tutto messa in un servizio nuovo: superficie in più per una differenza che l'utente
  vede uguale.
- **Resta il collaudo a video**, che nessun test sostituisce: due account veri, segnalazione,
  blocco, e la coda vista da un amministratore.

### C11 — GDPR completo — *fatto, informativa compresa*
- **Obiettivo:** oggi `SECURITY.md` segna la conformità come parziale, e va bene finché siamo fra
  amici. Con iscritti sconosciuti diventa un obbligo.
- **Esportazione** — "Scarica i miei dati" nel Profilo: un JSON con profilo, comitive, auto, posti,
  richieste, commenti, liste d'attesa, segnalazioni fatte e persone bloccate. Si costruisce nel
  browser **con le query di tutti i giorni**: le policy decidono già cosa esce, quindi una funzione
  che deve solo restituire il visibile non ha bisogno di nessun permesso nuovo.
  - Le segnalazioni **ricevute** non ci sono, di proposito: contengono il racconto di un'altra
    persona, che non diventa esportabile perché parla di te.
- **Cancellazione** (`013_cancella_account.sql`) — "Elimina il mio account" chiama
  `elimina_account()`, `security definer`, **senza parametri**: sa cancellare una persona sola, chi
  la chiama. Dal client non si potrebbe fare altrimenti — l'API di amministrazione vuole la
  `service_role`, cioè la chiave che apre tutto, che nel browser non deve esistere. Questa funzione
  è l'opposto di dare quella chiave al client.
- **Il danno che si stava per fare agli altri:** `groups.owner_id` cascata su `profiles`, quindi la
  cancellazione avrebbe portato via **la comitiva intera**, con le auto e le prenotazioni di tutti
  gli altri membri. Ora il gruppo passa al membro più anziano rimasto; se non è rimasto nessuno, se
  ne va anche lui, perché un gruppo vuoto non è di nessuno. Verificato in
  `supabase/test/verifica-cancellazione.sql`, in CI, e provato al contrario: tolta l'eredità, il
  test diventa rosso su "DANNO AGLI ALTRI".
- **Informativa** riscritta: tabella dato → perché → base giuridica, chi vede cosa, responsabili
  (Supabase e Netlify), tempi di conservazione, i tre diritti che si esercitano da soli dall'app,
  reclamo al Garante, soglia dei 14 anni.
- **Le due cose che il codice non poteva mettere sono state messe**, e per un po' sono state
  riquadri rossi bene in vista invece che frasi plausibili inventate:
  - **il titolare del trattamento** — Elia Paggetti, a titolo personale, con un indirizzo di
    contatto dedicato: la casella personale non finisce su una pagina pubblica;
  - **la regione del progetto**, che l'API davvero non espone — provato, gli header danno solo
    `sb-project-ref`. Ed è la cosa che ha cambiato il paragrafo: `eu-west-2` è **Londra**, non
    Francoforte come dava per scontato l'esempio. I dati escono dall'Unione. È lecito senza nessuno
    strumento aggiuntivo perché il Regno Unito è un paese adeguato — decisione rinnovata il
    19/12/2025, valida fino al 27/12/2031 — ma tacerlo sarebbe stata l'omissione più grossa
    dell'informativa. Ora è scritto, con la fonte.
- **Fatto quando:** un utente esporta e cancella tutto da solo, e la cancellazione porta via anche
  auto, prenotazioni, richieste e commenti. **Raggiunto.** `SECURITY.md` segna la conformità GDPR
  come piena, e la prossima scadenza da guardare è il 27/12/2031, non prima.

---

## Fase 4 — Integrare

### C12 — PWA vera — *fatta nel codice, da installare su un telefono vero*
C'è `sw.js`, ci sono le icone PNG 192 e 512 (generate da `icon.svg`, senza aggiungere nessuna
libreria di conversione al progetto), e c'è `offline.html`.

**La decisione che conta è cosa resta fuori dalla cache**, e sta scritta anche in `sw.js`: tutto
quello che passa da Supabase, e tutto quello che non è `GET`. Sono dati di persone e token di
sessione — una copia in cache sarebbe una copia che nessuno ha chiesto, che "Scarica i miei dati"
non mostra e che "Elimina il mio account" non porta via. Sarebbe C11 al contrario. In cache va solo
il guscio: i file pubblici, identici per tutti.

Un dettaglio che si scopre solo provando: nella cache va messo anche **il modulo di Supabase preso
dal CDN**, perché è il primo `import` di `app.js`. Senza quello "si apre offline" è una promessa che
la prima riga smentisce, e l'app non parte affatto.

L'avviso di rete non è decorazione: da quando l'app si apre offline, una schermata che compare e non
si aggiorna **sembra rotta**. La barra rossa dice che è il segnale che manca, e al ritorno della rete
i passaggi si ricaricano da soli.

**L'icona per la maschera di Android c'è, dal 27/07/2026**, e non era un lavoro di disegno: era un
lavoro di misura. Android ritaglia l'icona dentro una forma che decide il produttore, e garantisce
solo il **cerchio** centrale di diametro 80%. Le PNG `purpose: "any"` restano quelle di prima; le due
`maskable` sono la stessa auto su fondo pieno — niente angoli arrotondati, ci pensa la maschera — e
ci sono voluti due aggiustamenti che a occhio non si vedono:

1. **il tracciato non era centrato nel suo riquadro.** Con lo spessore del tratto va da y 31,5 a
   y 78: il centro sta a 54,75, non a 50. Nell'icona quadrata non si nota, sotto un cerchio sì.
2. **il disegno sbordava dal cerchio sicuro dell'8%.** Quello che conta non è la larghezza ma la
   **mezza diagonale**, perché sono gli angoli a uscire per primi: senza ridurre, la maschera
   avrebbe mangiato l'orlo delle ruote.

Tutte e due le correzioni sono **misurate sui pixel del disegno**, non stimate dal tracciato — è la
prima delle tre lezioni di questo file, applicata invece che citata. Lo strumento che le genera sta
nel vault (`Strumenti/genera-icone-maskable.html`), non qui: è codice di studio, riusabile dalla
prossima PWA, e non deve finire fra i file pubblicati.

*Fatto quando:* installata dal telefono, si apre senza barra del browser e mostra qualcosa di utile
anche offline. **Il worker, la cache, la ricarica offline e ora la geometria delle icone sono
verificati**; la parte che manca è l'installazione su un telefono, che da qui non si può fare: icona
sulla home, avvio senza barra della URL, e la prova finale che l'auto nella maschera si veda intera.

### C13 — Notifiche a scheda chiusa
Oggi le notifiche esistono solo con la scheda aperta in secondo piano (`maybeNotify`).

**Deciso — tre eventi soli, quelli che cambiano i piani di chi li riceve:**

| Evento | A chi | Perché vale una vibrazione |
|---|---|---|
| Qualcuno prenota un posto nella tua auto | guidatore | Devi sapere chi carichi |
| Si libera un posto dove sei in lista d'attesa | in attesa | È l'unico modo per non perderlo |
| La tua auto parte fra un'ora | guidatore e passeggeri | Il promemoria che evita il buco |

**Esclusi di proposito**: commenti e auto pubblicate. Sono la maggior parte del traffico e
diventerebbero rumore: un'app che notifica troppo viene silenziata, e a quel punto non notifica
più niente. Se serviranno, saranno da attivare a mano, spente di default.

**Come:** Web Push standard (VAPID) sul service worker di C12, tabella delle iscrizioni, Edge
Function Supabase innescata dal database per i primi due eventi, `pg_cron` per il promemoria orario.
Nessun servizio di terzi. *Dipende da:* C12.

#### Dove sta adesso (27/07/2026): fatta la metà che si può verificare

**Il database non spedisce niente, e non è una limitazione: è la scelta.** Spedire una push vuole
una chiave privata e una richiesta HTTP verso un servizio di terzi dentro una transazione. Qui i
trigger **accodano** e basta (`017_notifiche.sql`); a spedire è una Edge Function che legge la coda
con la propria chiave. Se la spedizione è rotta — o non è ancora stata messa in piedi — prenotare un
posto continua a funzionare: l'evento resta in coda e nessuno se ne accorge.

| Pezzo | Stato |
|---|---|
| `push_subscriptions`, un'iscrizione **per dispositivo** (telefono e portatile sono due) | fatto, RLS: solo le proprie |
| Coda `notifiche_coda`, RLS accesa e **nessuna policy** — come l'archivio di 010 | fatto |
| Trigger «qualcuno prenota un posto nella tua auto» | fatto |
| «Sei salito dalla lista d'attesa», dentro `promote_waitlist` | fatto |
| «Parte fra un'ora», funzione chiamata dal cron | fatto |
| Interruttore nel Profilo + `push`/`notificationclick` nel service worker | fatto |
| Chiavi VAPID, deploy della Edge Function, `pg_cron` | **fuori dal repo**, istruzioni in `supabase/README.md` |

**Verificato** in `supabase/test/verifica-notifiche.sql`, in CI, provato al contrario: si accoda
quando deve, non si accoda per il proprio gesto, non si accoda due volte per lo stesso evento, e
dal client la coda non si legge.

**Due scelte prese scrivendolo:**

- **La chiave della coda decide cosa è «lo stesso evento».** Senza, scendere e risalire dalla stessa
  auto manderebbe due vibrazioni, e il cron che gira ogni dieci minuti ne manderebbe una a giro.
- **Il promemoria guarda l'istante di partenza, non il giorno.** Un'auto che parte alle 00:20 va
  avvisata alle 23:20 del giorno prima: filtrando per `ride_date = oggi` quella sarebbe l'unica ora
  in cui il promemoria non arriva — e il test sarebbe rosso una notte su dodici e verde per caso
  tutte le altre.

**Quello che resta è anche quello che non si può provare da qui:** la Edge Function non è mai stata
eseguita. Il primo giro va guardato nei log, e la prova vera è una notifica che arriva su un telefono
con l'app chiusa.

### C14 — Servizi esterni — *chiuso*
**Deciso — solo cose che il browser sa già fare, nessun SDK, nessuna voce nuova nella CSP:**

| Cosa | Come | Perché così | Stato |
|---|---|---|---|
| Invita al gruppo | Web Share API nativa (che sul telefono offre WhatsApp da sola) + copia del codice come ripiego | Zero dipendenze, funziona con tutte le app di messaggistica, non solo WhatsApp | **fatto**, `navigator.share` in tre punti di `app.js` |
| Passaggio nel calendario | File `.ics` generato dall'app | Nessun servizio esterno, funziona con Google, Apple e Outlook allo stesso modo | **fatto**, `testoIcs()` |
| Navigazione al ritrovo | Link Maps, con coordinate vere al posto del testo libero | Rimandato dentro C9, che è il cantiere dove nascono i luoghi veri | **fatto**, `linkRitrovo()` |

**Esclusi**: SDK di terzi, analytics, login social oltre a Google. Ogni SDK è codice altrui in
esecuzione dentro la mia pagina e una riga in più nella CSP.

**Navigazione al ritrovo — com'è finita.** C9 aveva creato `origin_lat`/`origin_lon` e lasciato il
link a cercare il testo libero, quindi il ritrovo poteva spostarsi di un chilometro: "piazza" trova
la piazza sbagliata. Ora il link apre il percorso (`maps/dir`) sul punto vero.

Non lo stesso link per tutti, però, e la ragione non è estetica: **la policy di 014 è di riga, non
di colonna.** Chi vede un passaggio `zona` o `pubblico` riceve la riga intera, coordinate comprese,
e il punto di partenza di una persona può essere casa sua al metro. Dentro la comitiva — o avendo un
posto su quell'auto — il punto esatto è quello che serve; da fuori resta la ricerca sul nome del
luogo, che dice la zona e non l'indirizzo. Vale anche per ogni passaggio pubblicato prima della 014,
che coordinate non ne ha.

Da C21 quella prudenza non è più solo del link: **il dato non arriva proprio**, e la decisione la
prende il database invece dell'interfaccia. `coordinateVisibili()` ora chiede una cosa sola — sono
arrivate le coordinate? — perché arrivare *è* il permesso.

**`dest_lat`/`dest_lon` restano colonne morte, e non per dimenticanza.** La 014 le ha create,
niente le scrive: le coordinate arrivano solo da `navigator.geolocation`, e alla destinazione non ci
sei. Riempirle vorrebbe dire un geocoder — che D6 esclude — o un selettore su mappa, cioè una
dipendenza nuova. Se un giorno servono, quella è la decisione da riaprire, non un bug da chiudere.

### C21 — Le coordinate esatte non devono uscire dalla comitiva — *fatto (27/07/2026)*
Sta qui perché è nato guardando C14, non perché appartenga a "Integrare": è un buco di 014, e come
tale viene prima delle cose nuove. Il buco vero che quel cantiere aveva solo smesso di offrire con
un click: `select('*')` su `rides` portava `origin_lat`/`origin_lon` a **chiunque** potesse vedere
il passaggio, compresi gli estranei che lo vedono perché è `pubblico`. Il link era prudente, il
payload no.

**Fatto in due migrazioni, e sono due perché tirano in direzioni opposte** — è la regola di
`supabase/README.md` applicata alla lettera, non una complicazione:

| | Cosa fa | Quando si applica |
|---|---|---|
| `015_coordinate_a_richiesta.sql` | aggiunge `coordinate_visibili()` e la funzione `coordinate_passaggi(ids)` | **prima** di pubblicare il codice, che la chiama |
| `016_coordinate_riservate.sql` | toglie il permesso di lettura su `origin_lat`, `origin_lon`, `dest_lat`, `dest_lon` | **dopo** la pubblicazione: rompe il `select('*')` del codice vecchio |

**Perché un permesso per colonna e non una vista.** Le due alternative sono state scartate per
motivi diversi. Un *campo calcolato* di PostgREST riceve la riga intera, e un riferimento a riga
intera in Postgres pretende il privilegio sulla tabella tutta: sarebbe incompatibile con la 016. Una
*vista* avrebbe funzionato, ma spostava tutte le query della Home su un oggetto nuovo — con
l'incorporamento di guidatore, sedili, commenti e lista d'attesa da riverificare in una volta sola,
su un sito che si pubblica facendo merge. Una funzione in più lascia intatto quello che già gira, e
se un giorno sparisse il link tornerebbe a cercare il nome del luogo: degrada, non rompe.

**Da qui in poi le colonne di `rides` si nominano** (`COLONNE_RIDE` in `app.js`): chi ne aggiunge
una la aggiunge anche lì, altrimenti nasce invisibile all'app. È lo stesso genere di vincolo che la
010 ha messo sull'archivio.

**Verificato** in `supabase/test/verifica-coordinate.sql`, in CI, e provato al contrario: togliendo
la chiamata a `blinda_coordinate()`, il controllo `is_member or ho_un_posto`, il primo
`passaggio_visibile` o la revoca dell'execute, il test diventa rosso — uno per ciascuno.

*Fatto quando:* un utente fuori comitiva che interroga l'API a mano riceve il passaggio senza le
coordinate. **Raggiunto**: da fuori `select *` viene rifiutato e `coordinate_passaggi` non torna
nessuna riga, mentre chi è dentro o ha un posto sull'auto continua ad avere il punto esatto.

### C22 — La zona non è un dato del profilo pubblico — *scritto il 27/07/2026, da pubblicare*

Nato dalla revisione integrale del 27/07: **C21 ha chiuso la porta di `rides` e ha lasciato aperta
quella di `profiles`**, che è la stessa porta. La 014 ha aggiunto al profilo `zona_lat`, `zona_lon`
e `zona_nome` — cioè il punto che il telefono misura quando premi "Sono qui", che per quasi tutti è
casa propria — e una policy RLS è di riga: decide *quali profili* si leggono, non *quali colonne*.
Quindi `GET /rest/v1/profiles?select=*` restituiva le coordinate di casa di chiunque condivida una
comitiva. E da C9 non serve nemmeno la comitiva: la 014 apre la lettura del profilo anche a chi vede
un passaggio `pubblico` guidato (o occupato) da quella persona — cioè **proprio l'estraneo a cui
C21 aveva appena tolto il punto di ritrovo poteva prendersi quello di casa dal profilo di chi
guida.** Insieme alle coordinate usciva `sospeso_motivo`, che è quello che l'amministratore ha
scritto sospendendo qualcuno: cosa fra due persone, non notizia da comitiva.

**Fatto in due migrazioni**, per la stessa ragione di C21 e con la stessa regola di ordine:

| | Cosa fa | Quando si applica |
|---|---|---|
| `018_profilo_a_richiesta.sql` | aggiunge `mio_profilo()`, che restituisce la propria riga intera | **prima** di pubblicare il codice, che la chiama |
| `019_zona_riservata.sql` | toglie il permesso di lettura su `zona_lat`, `zona_lon`, `zona_nome`, `sospeso_motivo` | **dopo** la pubblicazione: rompe il `select` del codice vecchio |

**`returns setof profiles` invece di un elenco di colonne**, ed è l'unica differenza rispetto a
`coordinate_passaggi`: lì le colonne da restituire erano due e non cambiano, qui sono tutte quelle
del profilo, che sono cambiate tre volte in tre settimane. Un elenco dentro la funzione sarebbe la
seconda copia da tenere allineata, e la prima colonna nuova nascerebbe invisibile all'app.

**Cosa resta leggibile, e perché non è una dimenticanza:** `display_name` e `avatar_url` sono il
motivo per cui i profili si leggono; `is_admin` dice chi modera; `sospeso` resta perché
l'interfaccia dell'amministratore lo mostra accanto alla segnalazione — è lo stato, non la
motivazione.

**Verificato** in `supabase/test/verifica-profilo.sql`, in CI, e provato al contrario: togliendo la
chiamata a `blinda_profilo()`, il filtro `p.id = auth.uid()` dentro `mio_profilo()`, la revoca di
`execute` o il `grant` ad `authenticated`, il test diventa rosso — uno per ciascuno.

*Fatto quando:* un utente che interroga l'API a mano riceve i profili che gli spettano **senza** le
coordinate della zona. Da verificare in produzione dopo aver applicato la `019`, con la stessa prova
di C21: `select=*` su `profiles` deve essere rifiutato, `select=display_name` no.

### C23 — Le funzioni interne non si chiamano da un browser — *scritto il 27/07/2026, da applicare*

Trovato nello stesso giro, guardando i **permessi delle funzioni** invece delle policy. In Postgres
una funzione nasce eseguibile da chiunque: `grant execute to public` è il default, e non è scritto
da nessuna parte. Le migrazioni se n'erano ricordate dove era evidente (`elimina_account`,
`accoda_notifica`, `blinda_coordinate`, `accoda_partenze_imminenti`) e non dove non lo era.

Due buchi veri, entrambi in `020_funzioni_riservate.sql`:

- **`bloccati_fra(a, b)`** è `security definer` e prende **due** id come parametri. Il commento
  della 012 dice che quelle funzioni «restano innocue perché non accettano scelte da chi chiama»:
  è vero per `si_bloccano(altro)` e `mi_ha_bloccato(altro)`, ancorate ad `auth.uid()`, ed è falso
  proprio per questa. Chiunque poteva chiedere «X e Y si sono bloccati?» su due persone che non lo
  riguardano, e gli id si leggono dal payload della Home. Il blocco è la cosa che la 012 nasconde
  perfino a chi lo subisce. Stessa forma per `sospeso(u)`, che dà lo stato di moderazione di
  chiunque a chiunque.
- **`create_group` / `join_group` erano chiamabili senza account.** Entrare non si riusciva — la
  chiave primaria di `group_members` rifiuta un `user_id` nullo — ma **l'errore cambia** a seconda
  che il codice esista o no: un oracolo per cercare i codici invito da fuori, cioè l'opposto di
  quello che `SECURITY.md` promette. Ora `anon` non le chiama, `authenticated` sì.

**Non ha un ordine di applicazione**, ed è l'unica delle tre a non averlo: non toglie niente che il
codice pubblicato usi. Verificato in `supabase/test/verifica-permessi.sql`, in CI, e il quarto
controllo è quello che tiene onesti gli altri tre — chiudere è facile, chiudere senza rompere
l'ingresso in comitiva no.

### C24 — I codici invito si indovinano, da autenticato — *aperto il 31/07/2026, non ancora affrontato*

Nato scrivendo la riga «Codici invito / enumerazione» di `SECURITY.md`, che prima prometteva una
cosa che non è vera. La `020` chiude la parte che riguarda chi **non** ha un account; resta quella
che riguarda chi ce l'ha, ed è la più seria delle due — perché a quel punto un codice indovinato non
si limita a rivelarsi.

**Quando.** Dopo la Fase A, cioè dopo che `018`, `019` e `020` sono applicate e la PR #11 è fusa.
Prima non ha senso: tocca lo stesso schema, e la Fase A è più urgente.

**Perché non adesso.** Cambia i codici che le persone si sono già scambiate a voce. È una decisione
del proprietario, non un fix da fare di iniziativa.

**I tre rimedi, in ordine di rapporto valore/costo.**

1. **Allungare il codice e allargarne l'alfabeto**, scartando i caratteri che si confondono
   leggendoli a voce. I codici già distribuiti restano validi: cambia il `default` della colonna,
   non le righe già scritte. Da sola rende le altre due un lusso.
2. **Uniformare l'errore** di `join_group`, così che i casi che oggi si distinguono rispondano allo
   stesso modo.
3. **Un limite di tentativi** per utente. È l'unico dei tre che aggiunge stato da mantenere, ed è il
   meno urgente se si fa la prima.

*Fatto quando*: il `default` della colonna `code` produce codici del formato nuovo, `join_group`
risponde uguale nei casi che oggi distingue, e la riga «Codici invito / enumerazione» di
`SECURITY.md` passa da ⚠️ a ✅ con accanto il comando che lo prova.

**La misura del buco, i numeri e il modo in cui si sfrutta non stanno qui**: sono nel vault, che è
privato. Questo repo è pubblico, e finché C24 è aperto quel dettaglio descrive una cosa che
funziona adesso.

---

## Fase 5 — Abbellire e ottimizzare

### C15 — Togliere l'aria di cosa generata — *impreziosita, non svuotata*

**Come è andata, perché vale più del risultato.** Il primo tentativo ha preso "sembra generata" e ha
risposto togliendo: via aurora, gradienti, ombre, schede, Inter, raggi grandi. Verdetto del
proprietario, giusto: *«fa schifo, sembra il sito di una casa di riposo, era meglio prima»*. Quel
commit è stato revertito (resta in `a94d1dc` se un giorno serve un pezzo). La lezione sta in una
riga: **la base era buona e andava impreziosita, non spogliata.** Togliere la decorazione senza
mettere niente al suo posto non dà carattere, dà povertà.

Secondo tentativo, in aggiunta. Vincoli dati: **navy resta il colore principale**, i **bordi restano
tondeggianti**, ricco ma sobrio. *(Vincoli di allora: C40 li ha sostituiti entrambi — la palette è
onyx e candy blue, e i raggi sono quattro e diversi fra loro.)*

1. **Il tondo della navigazione è di "dove sei", non della Home.** Era fisso sulla Home, rialzato,
   con un anello che pulsava. Ora è un elemento solo che **scivola** sulla colonna attiva, e l'icona
   di quella scheda sale dentro. La colonna la passa il codice al CSS leggendo l'ordine vero dei
   pulsanti, così l'elenco delle viste non vive in due posti che possono divergere. Verificato a
   390, 820 e 1440px: il centro del tondo cade sul centro della scheda entro 1px, in tutte e tre.
2. **Passare sopra anticipa il tocco.** Sulla scheda non attiva compare un tondo pallido dove
   arriverebbe quello pieno, e l'icona si alza di un soffio nella stessa direzione: non un bagliore,
   un'anteprima. Chiuso in `@media (hover: hover) and (pointer: fine)`, perché sul telefono `:hover`
   resta attaccato dopo il tocco e una scheda illuminata a vuoto sembra rotta. **Sul telefono basta
   l'animazione della tab attiva**, ed è esattamente quello che resta.
3. **Un secondo colore, l'ottone, e usato poco per scelta**: il tuo sedile, il tuo ruolo nello
   storico, il tuo codice del gruppo. Navy resta il colore dell'app; l'ottone è il colore di chi la
   sta usando. Prima "il mio sedile" era verde, cioè il colore di "va bene": ma quello non è una
   conferma, è l'unico posto che ti riguarda, e in un'auto da cinque deve trovarsi senza leggere le
   iniziali.
4. **L'auto è diventata un oggetto.** Lamiera con la luce che arriva dall'alto (un gradiente per
   ogni `--car-hue`, così funziona su qualsiasi tinta di guidatore), filo di luce sul bordo alto,
   riflesso di sbieco sul parabrezza, ombra a terra che la appoggia invece di lasciarla galleggiare,
   e una piega sul cuscino che fa leggere i sedili come imbottitura e non come tessere. Da
   `min(200px, 72%)` a `min(228px, 82%)`.
5. **Profondità vera invece di ombre grigie.** Due strati tinti del navy — una stretta che appoggia,
   una larga che stacca — più un filo di luce interno da 1px in cima alle superfici. È la differenza
   fra "pulito" e "curato", ed è un pixel.
6. **Finiture**: numeri tabellari su ore, posti e codici (una colonna di orari resta una colonna
   invece di ballare a ogni cifra), marchio con tracciatura strizzata, anello di focus disegnato.
7. **Il carattere, che per tre giorni è stato solo un'intenzione** (27/07/2026). I file di IBM Plex
   erano nel repo dal secondo tentativo, con un `README` che spiegava perché — ma `style.css`
   diceva `font-family: 'Inter'` e `index.html` caricava Inter da `fonts.googleapis.com`. Quindi:
   l'identità tipografica non esisteva, e ogni apertura dell'app faceva contattare Google al
   browser di chi la usa, mentre `privacy.html` elenca come destinatari **solo** Supabase e
   Netlify. Ora le `@font-face` sono in `style.css`, i quattro file stanno nel `GUSCIO` di `sw.js`
   e la CSP ha perso `fonts.googleapis.com` e `fonts.gstatic.com`: una regola che si stringe.
   **Trovato guardando le risorse della pagina viva in un browser**, non leggendo il repo — come
   la `Permissions-Policy` di C9, e per la stessa ragione: un file può essere presente e inerte.

**Fatto quando:** coperto il logo e il nome con un dito, si capisce che è questa app. Il pezzo che
risponde di più a quella prova è l'auto, che nessun altro ha. **Il giudizio finale resta tuo, su un
telefono in mano**: qui dentro il browser è girato per davvero, ma un'app che si usa di corsa in
piedi si valuta in piedi.

### C16 — Peso e velocità sul telefono — *misurato il 27/07/2026; il numero di arrivo manca ancora*
1287 righe di CSS e 1822 di JS senza build, più supabase-js da CDN. Misurare prima di ottimizzare, e
la misura ha già cambiato l'idea di dove sia il problema.

**Byte davvero sul filo** (compressione `br` di Netlify, sito vivo, prima schermata utile):

| Cosa | Sul filo | Note |
|---|---|---|
| `index.html` | 6,6 KB | comprende lo sprite delle icone e il JSON-LD |
| `style.css` | 10,7 KB | 1287 righe |
| `app.js` | 24,0 KB | 1822 righe |
| `rete.js` + `config.js` + `manifest.json` + `icon.svg` | 2,4 KB | |
| **guscio proprio** | **43,7 KB** | tutto quello che è scritto qui dentro |
| **supabase-js dal CDN** | **73,5 KB in 9 richieste** | `auth-js` da solo pesa 24,4 KB, cioè quanto tutta l'app |

**Il numero che conta è il secondo: la libreria pesa più di tutto il sito**, e arriva da un'altra
origine, quindi paga una connessione TLS in più prima ancora di scaricare. Il `+esm` di jsdelivr si
tira dietro `storage-js`, `functions-js`, `realtime-js`, `phoenix`, `iceberg-js` e `tslib`: di
questi, storage e functions questa app **non li usa affatto**. Ottimizzare `app.js` prima di aver
guardato quel numero sarebbe stato lavoro sulla metà più piccola.

**Query alla prima schermata: 8, in 4 attese incatenate** — profilo → persone bloccate → comitive →
(passaggi ‖ richieste ‖ coordinate ‖ i due della rotazione dei turni). Sono le quattro attese in
fila, non il numero di query, a fare il tempo su rete lenta.

*Fatto quando:* c'è un numero di partenza e uno di arrivo, non un'impressione. **Il numero di
partenza c'è** (43,7 + 73,5 KB, 8 query, 4 attese). Il numero di arrivo arriverà quando si sceglierà
cosa fare, e le tre strade sono già visibili: ospitare un bundle di supabase-js con dentro solo auth
+ postgrest + realtime, accorpare profilo/bloccati/comitive in una sola chiamata, e misurare il
tempo alla prima schermata con la rete strozzata invece che dalla fibra di casa.

### C17 — Spezzare `app.js`
L'ADR 001 dice di rivedere la scelta "un file solo" oltre le 2-3k righe di JS: **al 27/07/2026 sono
1822** — le Fasi 3 e 4 ne hanno aggiunte 500 — quindi la soglia bassa è vicina e quella alta no.
Quando si supera: moduli ES separati (auth, gruppi, passaggi, render), sempre senza build. **Non
prima**: dividere presto costa e non rende. Il conto si rifà qui, non a memoria:
`node -e "console.log(require('fs').readFileSync('app.js','utf8').split('\n').length)"`.

---

## Fase 6 — Allineare al resto dello studio

### C18 — Standard dello Starter — *fatto nel repo; resta il ritorno verso lo Starter*
Portare qui quello che la base dei siti ha già e questo repo no. Fatti: `robots.txt`,
`sitemap.xml`, dati strutturati (JSON-LD `WebApplication` in `index.html`), `404.html`, più i
`canonical` e i campi Open Graph che non c'erano.

Tre cose scoperte facendo, che non erano nell'elenco:

- **L'informativa risponde a due indirizzi.** `/privacy` e `/privacy.html` danno **entrambe 200**
  — è la riscrittura di Netlify — quindi per un motore di ricerca sono due pagine identiche e
  sceglie lui quale contare. Ora il canonico è dichiarato, ed è uno solo: quello nel sitemap e
  quello che l'app usa nei link.
- **`offline.html` non va indicizzata.** Trovata da una ricerca sembrerebbe un'app rotta.
- **Open Graph serviva e non era nell'elenco.** Da C14 l'app si condivide da dentro — invito,
  passaggio, giornata — e senza quei campi il link incollato in chat arriva come indirizzo nudo.

**La pagina cookie non serve, e non è una dimenticanza:** non ci sono cookie di profilazione da
dichiarare. Nessuna analytics, nessun SDK di terzi (D6), e la sessione di Supabase non è
profilazione. Se un giorno entrasse un servizio che profila, quella pagina nasce con lui.
`eslint.config.mjs` era già versionato dalla Fase 0 — quella riga dell'elenco era vecchia.

Nel sitemap ogni indirizzo elencato viene interrogato dal test: un sitemap con un 404 dentro è
peggio che non averlo, perché dice al motore di ricerca una cosa falsa.

**Resta il verso opposto**, che è l'altra metà di questo cantiere e non si può fare da questo
repo: quello che WeTransport ha imparato e lo Starter non sa ancora — l'ordine fra migrazioni e
codice, le migrazioni numerate che si registrano da sole, i test provati al contrario, e la
Permissions-Policy che spegne una funzione se l'allowlist è vuota.

### C19 — Vault e codice allineati — *fatto il 27/07/2026*
Mappa Graphify rigenerata, memoria tecnica aggiornata con le decisioni di questo file, nota
progetto che punta qui invece di duplicare.

Fatto, ed è servito a scoprire quanto fosse scaduta: la nota del vault raccontava una Fase 3 «sul
ramo, da collaudare» mentre era pubblicata da un giorno, e il clone locale era **44 commit**
indietro. Ora la nota progetto rimanda qui invece di ripetere, la memoria tecnica ha una regola
nuova su **come si legge lo stato vero** (repo, sito servito, schema applicato) invece di
ricordarlo, e `audit-vault.py` è pulito. La lezione che resta: *le note invecchiano in silenzio, il
sistema vivo no* — quindi si guarda quello per primo.

### C20 — Un nome solo
Oggi sono tre: repo `posti`, cartella `C:\Progetti\posti`, dominio `wetransport.netlify.app`.
Cercare "wetransport" su GitHub non trova niente.

**Deciso:**
- **Repo rinominato in `wetransport`.** GitHub tiene attivi i vecchi indirizzi, ma vanno comunque
  aggiornati a mano: il collegamento Netlify, il remoto del clone locale, la nota del vault, i
  percorsi negli script di `Strumenti/`. Da fare in un momento in cui non c'è altro a metà.
- **Dominio proprio: sì, ma a T2.** Finché lo usa la comitiva, `.netlify.app` va benissimo. Quando
  si apre al pubblico serve un dominio vero: è anche il biglietto da visita dello studio, e un
  `.netlify.app` in vetrina dice "esperimento". Costo ~10-15 € l'anno.

---

## Fase 7 — Le funzioni della comitiva (T1)

Quattordici cantieri decisi il **01/08/2026**, **tredici fatti il 05/08/2026**. Nascono da un
elenco di sedici idee, ognuna verificata contro il codice prima di proporla — il controllo
serviva, perché due delle prime proposte erano cose che esistevano già (le ricorrenze, che sono
il selettore «Ripeti» del modulo dell'auto, e la lista d'attesa, che ha la sua interfaccia
completa dal 006).

**Tre idee sono state scartate dal proprietario, e non tornano:**

- *i turni come moneta invece degli euro* — un secondo modo di saldare accanto a `pagamenti`,
  cioè due verità sullo stesso debito;
- *la pagina del giorno condivisibile senza account* — apre un confine verso l'esterno mentre
  C24 è ancora aperto;
- **C29, «è comparsa l'auto che avevi chiesto»** — scartato il 05/08/2026, prima di scriverlo.
  Era l'unico dei tre avvisi che nessuno aveva chiesto: gli altri due dicono che un piano è
  cambiato, questo dice che *potrebbe* esserci un'occasione. La differenza conta perché è la
  stessa che D5 usa per tenere fuori i commenti e le auto nuove — sono la maggior parte del
  traffico, e un'app che notifica troppo viene silenziata. Il numero del cantiere non si
  riusa: i cantieri sono nomi, non posti liberi.

**Il vincolo d'ordine di questa fase**: C28 e C30 scrivono nella coda ma **arrivano sul telefono
solo con C13 acceso**. La tabella `notifiche_coda` c'è dalla `017` e i trigger la riempiono, ma
`VAPID_PUBLIC_KEY` è vuota, `supabase/functions/notifiche/` non è mai stato eseguito, `pg_cron`
è spento, e nel client non c'è una riga che legga quella tabella. La coda si riempie e nessuno la
svuota. Non è un cantiere di questa fase: è il suo prerequisito, e finché manca i due cantieri
sono fatti a metà — la metà che il repo può fare. Il client lo dice invece di prometterlo: la
conferma di annullamento promette l'avviso soltanto se le chiavi esistono.

### Dove sono finiti, in una riga per cantiere

| Cantiere | Migrazione | Stato |
|---|---|---|
| C25 saldare tutto in un colpo | — | **fatto** |
| C26 il conto mostra da cosa nasce | — | **fatto** |
| C27 storico filtrato | — | **fatto** |
| C28 avviso di annullamento | `026` | **fatto**, arriva con C13 |
| ~~C29~~ | — | **scartato**, vedi sopra |
| C30 «sono in ritardo» | `027` | **fatto**, arriva con C13 |
| C31 andata e ritorno legati | `028` | **fatto** |
| C32 le fermate della comitiva | `029` | **fatto** |
| C33 l'auto ha un profilo | `030` | **fatto** |
| C34 la quota calcolata | — | **fatto** |
| C35 il posto per un ospite | `031` | **fatto** |
| C36 le regole della comitiva | `032` | **fatto** |
| C37 la settimana invece del giorno | — | **fatto** |
| C38 la comitiva a tempo | `033` | **fatto** |

**Le migrazioni `026`-`033` sono scritte e verdi in CI, ma vanno applicate a mano** come tutte le
altre: il SQL editor non è raggiungibile dal repo. Nessuna ha un ordine rispetto al deploy del
codice tranne quelle che **aggiungono** colonne che il codice nuovo legge — cioè `027`, `028`,
`030`, `031`, `032`, `033` — vanno **prima**. È la regola della Fase 3, quella che allora era
stata sbagliata: *si applica per prima la metà che l'altra non può ignorare*.

### Quello che si è imparato facendoli, e che vale più dei cantieri

1. **Un controllo che gira nel momento sbagliato non misura niente.** La CI applica le
   migrazioni **due** volte per verificarne la ripetibilità, e dalla `016` il permesso su `rides`
   è per colonna e viene ricalcolato da `blinda_coordinate()`: una colonna aggiunta dopo nasce
   invisibile al client, e la **seconda** passata rimediava. In produzione si applica una volta
   sola, e lì la Home sarebbe andata in errore per tutti con un `42501`. Misurato, non supposto.
   Ora `verifica-colonne-leggibili.sql` gira **fra la prima e la seconda passata**, che è l'unica
   posizione in cui misura lo stato che gli utenti vedrebbero.
2. **Ripartire dal file più vecchio riporta indietro i difetti già pagati.** La `check_claim`
   della `004` fa `select * into r`; la `016` aveva già tolto quel `select *` perché con le
   coordinate ristrette per colonna prenotare falliva per chiunque. Riscrivendola per C31 sono
   ripartito dalla `004`. L'ha ripreso `verifica-coordinate.sql`, come la prima volta.
3. **Un `null` in più attraversa mezzo schema, e i punti che rompe non danno errori.** Rendere
   `passenger_id` facoltativo (C35) ha reso false tre cose in silenzio: blocco e sospensione
   diventavano domande su nessuno, un evento restava senza attore, e il guidatore riceveva
   «qualcuno sale sulla tua auto». Un test che guardasse solo «l'ospite si siede» sarebbe stato
   verde.
4. **Cambiare la firma di una funzione rompe i posti che la nominano per firma.** `blinda_funzioni()`
   (`020`) richiude i permessi elencando `create_group(text)`: cancellata quella firma per C38,
   la prima cosa che la chiamava moriva. Un `revoke` è un riferimento come un altro, ma non
   assomiglia a un riferimento e non lo si va a cercare.
5. **La tentazione di raccogliere coordinate si ripresenta ogni volta.** Copiare
   `rides.origin_lat/lon` nelle fermate (C32) avrebbe dato a C34 i numeri gratis: è C21 e C22 per
   la terza volta, su una terza tabella. Il controllo 7 di `verifica-fermate.sql` non prova cosa
   la tabella fa, prova cosa non deve fare, e il messaggio nomina C21.

### C25 — Saldare tutti i conti in un colpo — *fatto (05/08/2026)*

Oggi si chiude un conto per volta, con un dialogo ciascuno. Con quattro persone in sospeso sono
quattro giri. Un comando che salda tutti gli aperti con una persona, e uno che li salda tutti,
sono N insert in `pagamenti`: nessuna migrazione, nessuna policy nuova.

*Fatto quando*: dal riquadro «Conti in sospeso» si azzera l'intero saldo con una conferma sola, e
il totale in cima torna a zero senza ricaricare.

**Fatto.** Le N righe vanno in `pagamenti` con **un** insert, non con N: o passano tutte o non
passa nessuna. Con una riga per volta un rifiuto a metà strada lascerebbe il saldo per aria,
cioè proprio lo stato che il bottone deve chiudere.

### C26 — Il conto mostra da cosa nasce — *fatto (05/08/2026)*

Adesso si legge «Sara · 6 passaggi · dal 28 giu · + 16,50 €» e ci si deve fidare. Manca l'unica
cosa che serve nel momento in cui qualcuno contesta la cifra, che è l'unico momento in cui un
conto conta davvero: **quali** passaggi, a quanto ciascuno, e quali pagamenti già segnati.

I dati sono **già tutti caricati** da `loadStats()`: è un pannello che si apre, non
un'interrogazione nuova.

*Fatto quando*: toccando una riga dei conti si aprono le voci che la compongono, e la loro somma è
esattamente l'importo mostrato sopra.

**Fatto.** «Esattamente» non è controllato: è vero **per costruzione**. Il segno di ogni voce si
prende nello stesso giro che produce il totale, quindi la somma *è* il netto e non un secondo
conto che può divergere dal primo.

### C27 — Lo storico filtrato — *fatto (05/08/2026)*

Lo storico è l'elenco indistinto di tutto il gruppo. Due interruttori — «solo i miei passaggi»,
«solo quando ho guidato io» — rispondono alla domanda che ci si fa davvero («quante volte ci ho
messo l'auto?») senza contare a mano. Filtro su dati già in memoria.

*Fatto quando*: i due interruttori esistono, si combinano, e lo stato scelto sopravvive al
cambio di vista.

**Fatto**, con due precisazioni. Lo stato sta in due variabili di modulo, che è l'unico modo
perché sopravviva al cambio di vista senza scriverlo da nessuna parte. E «solo i miei» comprende
i passaggi su cui si è portato un ospite (C35): il posto l'hai preso tu e nel conto risulta a te.

### C28 — Avviso di annullamento *(richiede C13)* — *fatto: `026`, la coda si riempie; arriva con C13*

Se chi guida cancella, **oggi il passaggio sparisce e basta**. I tipi previsti dalla `017` sono
`posto_prenotato`, `posto_libero` e `partenza_vicina`: l'annullamento non c'è. È l'evento con la
conseguenza più concreta di tutti — si resta sul portone alle 7:40 senza sapere perché — ed è
l'unico difetto vero di questa fase, non un miglioramento.

`eventi` (023) registra già `passaggio_annullato`: serve un quarto tipo di notifica e un trigger
sulla cancellazione, che avvisi chi aveva un posto e chi era in lista d'attesa.

*Fatto quando*: cancellando un passaggio con due passeggeri a bordo, quei due ricevono l'avviso, e
chi non c'entra no.

**Fatto nella `026`**, più due cose che il criterio non nominava e che si sono scoperte
scrivendolo. La lista d'attesa riceve l'avviso come chi aveva un posto: aspettava quell'auto. E
lo riceve **chi guidava**, se a cancellare è stato un amministratore — è il caso in cui serve di
più, perché altrimenti si presenta al ritrovo con l'auto.

La decisione che vale la pena ricordare: `ride_id` resta **nullo** sull'avviso. Quella colonna
cascata su `rides`, quindi una notifica che nomina il passaggio appena cancellato viene portata
via dalla stessa cascata che l'ha generata. Rimettendo `old.id` al posto di `null` il test torna
rosso, e la coda resta vuota senza che niente lo dica.

### C30 — «Sono in ritardo di cinque minuti» *(richiede C13)* — *fatto: `027`; arriva con C13*

Un tocco da chi guida che arriva a chi è a bordo. È la cosa che nei passaggi veri si risolve con
dieci messaggi in chat, e costa un tipo di notifica in più più un bottone sulla scheda del
passaggio, visibile solo a chi guida e solo il giorno stesso.

*Fatto quando*: chi guida può segnalare un ritardo, chi ha un posto lo riceve, e il ritardo si
vede sulla scheda del passaggio anche a chi apre l'app in quel momento.

**Fatto nella `027`**, e si vede anche a chi la scheda ce l'ha già aperta: il realtime ora
ascolta gli `UPDATE` su `rides`, che era l'unico verso che mancava.

Due conseguenze che non erano nel criterio e che sarebbero state difetti veri. `hasDeparted()`
conta il ritardo, altrimenti la lista d'attesa si chiudeva mentre l'auto era ancora ferma sotto
casa e il conto alla rovescia diceva «Partita» a un'auto che sta arrivando. E i minuti stanno
dentro la chiave della notifica: «cinque» e poi «venti» sono due informazioni diverse, e con la
chiave ferma sul passaggio la seconda sarebbe sparita nell'indice unico.

### C31 — Andata e ritorno legati — *fatto: `028`*

Un passaggio è di sola andata, e il viaggio vero quasi sempre è A/R: «7:40 casa → università,
13:30 università → casa». Oggi in `rides` non esiste **nessun legame fra due righe**, quindi chi
prende il posto all'andata non sa se ha anche il ritorno, e chi guida ripubblica tutto da capo.

*Fatto quando*: pubblicando si può indicare il ritorno nella stessa operazione, le due schede si
riconoscono come coppia, e prenotare l'una propone l'altra.

**Fatto nella `028`, e la colonna era il pezzo facile.** Due vincoli della `004` rendevano il
caso impossibile, ed erano nati giusti quando un passaggio era di sola andata:
`rides_one_per_day` (un'auto per guidatore al giorno) e «hai già un posto su un'altra auto per
quel giorno» — che è esattamente ciò che si vuole fare prendendo A/R. Il primo si **precisa**
invece di toglierlo, con `(ritorno_di is not null)` come discriminante: due andate restano
vietate, ed è il controllo che si perde per primo allargando l'indice a mano. Il secondo cade
**solo** fra le due metà di una coppia: senza quel «solo», uno tiene un posto su tre auto e ne
lascia due vuote.

### C32 — Le fermate della comitiva — *fatto: `029`*

Origine e destinazione sono testo libero ridigitato ogni volta: «Piazza Dante», «piazza dante» e
«P.za Dante» diventano tre posti diversi, e le statistiche li contano separati. Una rubrica di
punti di ritrovo del gruppo, da **scegliere** invece che da scrivere.

*Fatto quando*: le fermate usate di recente si scelgono da un elenco, scriverne una nuova la
aggiunge alla rubrica del gruppo, e due passaggi dallo stesso posto contano come lo stesso posto.

**Fatto nella `029`.** La rubrica la riempie un trigger e non il client: una rubrica da compilare
prima di poterla usare resta vuota per sempre, perché il primo che pubblica non ha niente da
scegliere. Cosa rende «lo stesso posto» lo stesso posto è una colonna generata dal database —
se lo calcolasse il client, due versioni dello stesso client potrebbero non essere d'accordo, e
l'unicità si appoggia proprio su quella.

**Le coordinate di una fermata non si raccolgono dalle pubblicazioni**, e la tentazione era
forte perché avrebbe dato a C34 i numeri gratis. Il punto di «Parto da qui» è dove si trovava una
persona, quasi sempre casa sua al metro, e questa tabella la legge tutto il gruppo: è C21 e C22
per la terza volta. Si mettono con un gesto che dice a parole cosa sta facendo.

### C33 — L'auto ha un profilo — *fatto: `030`*

I posti si ridigitano a ogni pubblicazione. Un'auto salvata — quanti posti, che modello e colore
**per riconoscerla sotto casa al buio**, che è il momento in cui quell'informazione serve
davvero, e quanto consuma — riduce la pubblicazione a scegliere l'auto e l'ora.

*Fatto quando*: chi ha salvato un'auto pubblica senza reinserire i posti, e chi aspetta sa che
auto cercare.

**Fatto nella `030`.** Modello e colore compaiono accanto a chi guida, non fra le pastiglie in
fondo: rispondono alla stessa domanda — «chi passa a prendermi» — e si leggono nel momento in cui
si guarda la strada, non la scheda.

Due «no» che una policy da sola non dice: `auto_id` non entra nella policy di scrittura di
`rides`, quindi senza un controllo nel trigger si attaccherebbe al proprio passaggio l'auto di
chiunque; e l'indice della predefinita è **parziale**, perché un `unique` normale avrebbe
impedito al secondo membro di averne una.

### C34 — La quota calcolata invece che digitata — *fatto (05/08/2026)*

`fuel_per_person` è un numero che chi guida inventa ogni volta, quindi **cambia da persona a
persona per lo stesso tragitto**. Con il consumo dell'auto (C33) e la distanza fra due fermate
(C32) l'app propone la cifra e chi guida la conferma. Toglie l'unica trattativa che c'è.

*Dipende da C32 e C33*, e senza quelle non ha i dati per calcolare niente.

*Fatto quando*: il campo «€ a testa» arriva precompilato con un valore che si può correggere, e la
proposta è la stessa per lo stesso tragitto indipendentemente da chi guida.

**Fatto**, con una deroga dichiarata al secondo mezzo criterio. La proposta è identica per tutti
finché nessuno ha dichiarato il consumo della propria auto: prezzo, consumo di riferimento e modo
di dividere sono costanti, e cambia solo la distanza. Se chi guida ha salvato un consumo (C33) la
proposta usa quello, perché **un'auto che beve di più costa davvero di più**, e fingere di no
vorrebbe dire che il numero derivato è meno vero di quello inventato. La nota sotto il campo dice
sempre quale dei due conti ha fatto — un numero precompilato senza la sua derivazione è un numero
da accettare per fiducia, cioè la cosa che C26 ha appena tolto ai conti.

**Una scoperta, facendo il conto vero:** le cifre sono piccole. Dodici chilometri divisi per
cinque fanno mezzo euro, non i cinque euro che si scrivono a mano — quelli comprendono usura e
pedaggi, che non sono benzina e che il campo non nomina. Sotto i cinquanta centesimi non si
propone niente: un minimo messo lì per avere sempre un numero sarebbe una cifra inventata, per
giunta più alta del dovuto.

### C35 — Il posto per un ospite — *fatto: `031`*

Un sedile è un utente registrato. Prenotare due posti perché porti un amico che non ha l'app **non
si può fare**, e nella vita succede di continuo. Serve un sedile con un nome libero invece di un
`user_id`, e la quota di quell'ospite va nel conto di chi lo ha portato.

*Fatto quando*: si prenota un posto per un ospite indicandone il nome, il posto risulta occupato a
tutti, e la sua quota compare nel conto di chi lo ha invitato — non in un conto suo, che non
esiste.

**Fatto nella `031`, ed è il cantiere che ha attraversato più schema.** La quota è una riga in
`saldo_con`: `coalesce(passenger_id, invitato_da)`. Nel client la stessa regola sta in
`chiRisponde()`, e deve essere la stessa — due regole diverse qui e nel database vorrebbero dire
due totali diversi per la stessa cosa.

Le tre cose che un `null` in più rompeva **senza errori** sono nel punto 3 dell'elenco in testa
alla fase. Vale la pena rileggerle prima di rendere facoltativa qualsiasi altra colonna.

### C36 — Le regole della comitiva — *fatto: `032`*

Ogni passaggio è deciso da capo. Un gruppo dovrebbe poter fissare le sue una volta: «chi guida non
paga», «quota fissa 5 €», «massimo quattro a bordo». Da lì la quota si precompila, e le eccezioni
si vedono perché sono eccezioni.

*Fatto quando*: un amministratore imposta le regole del gruppo, la pubblicazione le rispetta senza
che nessuno le ridigiti, e chi le infrange lo vede scritto prima di confermare.

**Fatto nella `032`, e il database non le fa rispettare.** È la decisione del cantiere, e sta
scritta in cinque parole nel criterio qui sopra: *le eccezioni si vedono perché sono eccezioni*.
Una regola di comitiva non è un vincolo di integrità — «chi guida non paga» è una convenzione fra
amici, e la sera che qualcuno fa un'eccezione deve poterla fare; altrimenti l'unica strada è
cambiare la regola per tutti, che è un modo di mentire al database per fare una cosa normale. Un
vincolo che si aggira spegnendolo non è un vincolo, è un ostacolo che insegna a spegnere i
vincoli. Il controllo 4 di `verifica-regole.sql` verifica quindi che un passaggio contro le
regole **entri**, e il messaggio spiega perché, così che nessuno lo «ripari».

### C37 — La settimana invece del giorno — *fatto (05/08/2026)*

La Home guarda un giorno per volta, e la domanda vera della domenica sera è «come siamo messi
questa settimana». Sette colonne con chi guida e quanti posti, dove i buchi si vedono a colpo
d'occhio. Il riepilogo **calcola già** i giorni scoperti: manca la forma in cui si guardano.

*Fatto quando*: dalla Home si passa alla settimana e ritorno, i giorni scoperti si distinguono
senza leggere, e da un giorno vuoto si pubblica in un tocco.

**Fatto**, senza toccare lo schema: i dati c'erano tutti. «Senza leggere» vale con **due**
segnali e non uno — fondo e bordo tratteggiato — perché non deve valere solo per chi distingue i
colori. Nella settimana si contano solo i passaggi della comitiva aperta: uno di fuori (C9) è
un'occasione per una persona, non copertura per il gruppo, e contarlo direbbe che martedì è
coperto quando la comitiva martedì non ha nessuno.

### C38 — La comitiva a tempo — *fatto: `033`*

Un gruppo oggi è permanente. Un concerto, un matrimonio, un weekend fuori vogliono una comitiva
che nasce, serve tre giorni e si chiude da sola, con un codice che scade. È un caso d'uso diverso
da quello dei fuorisede, ed è probabilmente quello che porta persone nuove.

**Attenzione**: un codice che scade è anche un codice in più che circola, e C24 è ancora aperto.
Va fatto dopo, o insieme.

*Fatto quando*: si crea una comitiva con una data di fine, dopo quella data non ci si entra più col
codice, e i dati restano leggibili a chi c'era.

**Fatto nella `033`.** «Si chiude» vuol dire due cose — non ci si entra col codice, non si
pubblica — e non una terza: nessuna policy cambia, perché `is_member()` guarda l'appartenenza e
non la data. Chi ha diviso una macchina per tre giorni deve poter ancora vedere chi c'era e
**saldare quello che deve**; chiudere anche i conti vorrebbe dire che chi deve cinque euro non ha
più modo di registrarli. Una comitiva scaduta è un album, non un buco.

**Sul rapporto con C24**, che l'avvertenza qui sopra chiedeva di guardare: dire «questa comitiva
è chiusa» invece di «codice non valido» regala l'informazione che quel codice esiste — che però
chi indovina un codice valido ottiene già oggi, e in forma peggiore, perché entra. La terza
risposta è meno invasiva della seconda, non più. Tacere costerebbe invece a chi ha in mano un
codice legittimo: lo manderebbe a ricontrollare le lettere di un codice giusto. C24 si chiude
limitando i tentativi, che è il rimedio vero e non riguarda questa colonna.

---

## Fase 8 — Il ripasso del front-end (05/08/2026)

### C39 — L'accesso, e le regole di C15 applicate ovunque — *fatto*

C15 aveva rifatto l'app. **Non aveva mai toccato l'accesso**, che è l'unica schermata che si vede
prima di sapere cosa sia WeTransport, ed era rimasta quella di partenza: aurora animata dietro il
pannello, logo che galleggiava all'infinito, pastiglie di vetro, il pannello che scivolava di
820 ms al cambio di modo, il titolo «Bentornato». Cioè l'elenco degli anti-riferimenti di
PRODUCT.md, quasi voce per voce, sulla prima schermata.

**Il difetto peggiore però non era estetico.** Sul telefono il pannello del marchio era la prima
colonna e occupava tutto il primo schermo: a 360×780 la casella dell'email cominciava sotto la
piega. Il contesto d'uso scritto in PRODUCT.md è «in piedi, di corsa, con una mano sola, spesso al
buio davanti a un portone»: lì, chi apre l'app per entrarci doveva scorrere per trovare dove si
entra. Ora email, password e «Accedi» chiudono a 579 px su 780, e c'è un test che lo misura invece
di fidarsi.

Al posto del pannello c'è **il cartello**: l'auto vera dell'app, la stessa geometria di
`buildCar()`, con due sedili presi e due liberi, e sotto la riga «Restano due posti». È la risposta
alla prova del nove di D7 — coperto il nome, si capisce lo stesso che app è — e sul telefono non
c'è affatto, perché lì lo spazio verticale è del modulo.

**Poi le stesse regole, applicate dove C15 non era arrivato:**

| | Cosa | Dov'era |
|---|---|---|
| Molla | `--spring` aveva un superamento a 1.4: gli elementi andavano oltre il punto d'arrivo e tornavano indietro | su **venti** regole, dai bottoni ai sedili al tondo della navigazione |
| Gradienti | nove riempimenti decorativi (bottoni, schede, avatar, barre, il tondo, i riquadri scuri) più due macchie sfocate sotto tutta la pagina | ovunque |
| Movimento infinito | il cerchio degli stati vuoti galleggiava per sempre, la pastiglia di chi cerca un passaggio pulsava per sempre | Home, stati vuoti |
| Alone | `--glow`, un bagliore colorato sotto ogni bottone primario | tutti i primari |

**Quattro difetti veri, trovati guardando invece di leggere:**

1. **Le finestre si aprivano nell'angolo in alto a sinistra.** `* { margin: 0 }` in cima al foglio
   spegne il `margin: auto` con cui il browser centra un `<dialog>` aperto con `showModal()`.
   Valeva per tutte: chiedi un nome, conferma, segnala qualcuno. Una riga, e nessuno l'aveva mai
   fotografata.
2. **Sette conferme distruttive passavano da `confirm()` del browser**, accanto a un dialogo
   disegnato usato per l'altra metà dei casi. Quello nativo non si può scrivere: diceva «OK» dove
   serviva «Esci dall'account». Mostra l'indirizzo del sito in cima, che dentro un'app installata
   sembra la finestra di un altro programma. E in qualche browser dentro un'altra app arriva
   soppresso, cioè l'azione parte o non parte senza che nessuno abbia risposto. Ora è uno solo, il
   bottone dice cosa fa, e il fuoco parte da «Annulla».
3. **Il tema scuro era sotto la soglia AA su nove coppie**, e nessuno poteva accorgersene perché i
   rapporti stavano nei commenti, scritti a mano una volta. Un token solo faceva due lavori con
   contrasti opposti: bianco sopra (3,97:1) e se stesso come testo (4,36:1). Sdoppiato in
   `--primary` / `--primary-testo`, e lo stesso per `--danger` e `--ok`.
4. **`var(--primary-bright)` restava scritto in `app.js`** dopo che il token era sparito coi
   gradienti: due barre del riepilogo con un colore invalido.

Più: il pavimento tipografico portato a 0,68 rem (nel riepilogo c'erano etichette da 9 px), i
collegamenti che non avevano una regola e restavano blu di sistema — illeggibili al buio su
`404.html` e `offline.html`, che sono pagine il cui unico scopo è portare da un'altra parte — e
`color-scheme` dichiarato anche lì.

**Il controllo che nasce da qui.** `tests/contrasto.mjs` legge i token **da `style.css`** e verifica
53 coppie nei due temi; gira in `npm run check`, quindi un token che si sposta lo dice subito
invece di aspettare un anno. PRODUCT.md chiede AA «come soglia verificata, non dichiarata»: prima
era dichiarata.

**Fatto quando:** il giudizio resta di chi la usa, su un telefono in mano. Quello che qui si può
dire chiuso è che la prima schermata non ha più niente di generico, che nessun contrasto è sotto
soglia, e che due dei difetti sopra erano rotture vere, non gusto.

---

## Fase 9 — Il tabellone (06/08/2026)

### C40 — Due colori, un tema, e il riepilogo che sta in una schermata — *fatto*

Richiesta del proprietario, con la palette allegata: **onyx `#020202` e candy blue `#B2D5E5`**,
tutte le pagine e l'accesso, l'accesso resta animato, e nel riepilogo **niente scorrimento** né
sulla pagina né dentro i riquadri.

**1. Il buio è il materiale, non un tema.** Non c'è più un tema chiaro e uno scuro: c'è l'onyx.
`prefers-color-scheme` era una scelta neutra travestita da cortesia — due palette da mantenere, due
giri di contrasti da verificare, e nessuna delle due che è *la* faccia dell'app. Il contesto d'uso di
PRODUCT.md è in piedi al buio davanti a un portone: uno schermo che spara bianco addosso lì è una
scelta contro chi lo usa. Il riferimento fisico non è un cruscotto né un terminale — sono i due
riflessi che PRODUCT.md nomina per non prenderli — è una **targa smaltata nera con le lettere
chiare**: un tabellone degli orari, il cartello di una fermata.

**2. Un accento solo, e vuol dire due cose che si distinguono per forma.** Il candy blue dice
«questo si tocca» quando è *scritto* o è un contorno, e dice «questo è tuo» quando è un blocco
*pieno* con l'onyx sopra. Niente di decorativo è candy blue. L'ottone è sparito: era il secondo
colore, e con una palette di due tinte un terzo colore è una tinta in più, non un'informazione in
più. Sono sparite anche le sei tinte a caso degli avatar — viola, rosso, verde — che erano sei
accenti in un'app che ne ha uno: restano sei perché servono a distinguere sei persone, ma stanno
tutte nella famiglia del candy blue e cambiano di luminosità prima che di tinta.

**3. La profondità la fanno le righe.** Su un fondo quasi nero un'ombra è invisibile o è sporco. Le
schede si separano con un bordo da un pixel e mezzo tono di fondo, come pannelli avvitati sulla
stessa lamiera. Le due ombre rimaste stanno solo dove una cosa galleggia davvero: il dialogo e il
messaggio che compare.

**4. I raggi sono quattro e diversi fra loro.** «Tutto arrotondato allo stesso raggio» sta fra gli
anti-riferimenti, ed era vero: ventidue pixel su qualsiasi cosa. Ora 3 per le pastiglie, 6 per
bottoni e campi, 10 per le schede, 14 per i pannelli. Le pillole restano solo dove sono cerchi
davvero: le facce, i pallini. Con loro se n'è andata la **pillola flottante in basso**, che era
l'anti-riferimento più letterale rimasto in piedi: adesso è una fascia appoggiata al bordo, e il
movimento che diceva dove sei — un elemento solo che scivola — è diventato un rettangolo di due
pixel invece di un tondo che solleva un'icona.

**5. L'accesso resta animato, e l'animazione racconta il prodotto.** Quello che si muove è l'auto
che si riempie: i posti si occupano uno alla volta, la frase accanto conta quelli che restano
(«restano tre posti», «resta un posto», «l'auto è piena»), poi riparte. Chi non ha mai aperto l'app
capisce cos'è prima di entrarci — l'unico argomento per cui una schermata d'accesso può permettersi
un'animazione. Sul telefono, dove il cartello grande non c'è perché lo spazio verticale serve tutto
al modulo, la stessa cosa la dice una striscia di quattro posti nella riga del marchio: **costa zero
pixel di altezza** perché occupa il vuoto a destra del nome. Un contatore solo per i due disegni, o
potrebbero mostrare due numeri diversi. Vive in `accesso.js`, non in `app.js`, per la stessa ragione
di `rete.js`: `app.js` comincia con un `import` da un CDN, e la prima schermata dell'app non può
dipendere dal fatto che un dominio di terzi risponda.

**6. Il riepilogo non scorre, e non barare è la parte difficile.** Prima la promessa valeva solo da
1280px e con la finestra alta almeno 700: sotto quelle soglie si tornava a scorrere, e i riquadri
più carichi tenevano una barra di scorrimento propria. Adesso vale sempre, con un meccanismo solo e
due numeri: **quante colonne si vedono insieme** (la larghezza) e **quante schede stanno in una
colonna** (l'altezza). Se le colonne che escono sono meno di quelle visibili si vede tutto insieme;
se sono di più si va avanti di lato, una colonna alla volta, con i pallini sotto. Nessuna soglia
decide «qui scorre e qui no»: lo decide l'aritmetica.

La parte che ha richiesto tre giri è che *la pagina non scorreva già al primo colpo* — ma il
calendario, la settimana e i conti venivano tagliati dai loro stessi bordi. **Un riquadro con tre
quarti di calendario dentro non è «senza scorrimento», è un calendario rotto**, ed è lo stesso
difetto di prima detto in un altro modo. Si misura, non si guarda: `banco` di prova a sette
larghezze, e il criterio è `scrollHeight > clientHeight` su ogni riquadro. Da lì sono usciti:
`--righe` legato all'**altezza** e non alla larghezza (240px è sotto quanto un mese diventa
illeggibile); l'agenda staccata dal calendario, perché il mese e i prossimi sette giorni sono due
domande diverse e insieme facevano la scheda che costringeva tutte le altre; la riga di un conto che
resta una riga e taglia il nome coi puntini invece di andare a capo tre volte; e un tetto su ogni
elenco **con scritto quante voci restano fuori** — un elenco troncato in silenzio è un dato sparito.

**7. La ciambella di domani è diventata una riga.** Era una scheda intera con un grafico ad anello e
tre voci di legenda per dire due numeri. Il primo principio di PRODUCT.md dice che se una cosa si
capisce grazie a un disegno non si è capita: «domani · 3 auto · 5/9 posti» sono gli stessi numeri,
letti prima, in un ventesimo dello spazio. E le schede da dieci sono diventate nove, che in colonne
da tre fanno esattamente quattro colonne piene — il riquadro che diceva poco era anche quello che
lasciava il buco in fondo alla tavola. Non è una coincidenza fortunata.

**Il controllo del contrasto è stato riscritto, non allentato.** Un tema solo invece di due, e le
coppie sono quelle del sistema nuovo: 38 in tutto, dal testo tenue sul fondo al contorno di un
sedile libero (che porta informazione, quindi vale la 1.4.11 e la soglia è 3:1, non 4.5). Una l'ha
già fermato: il contorno del candy blue a `L 0.42` faceva 2.30:1, e sta a 0.52 perché lì fa 3.56.

**Fatto quando:** il giudizio resta di chi la usa. Quello che qui si può dire chiuso è che nessuna
delle sette misure prova scorrimento — né di pagina né dentro un riquadro — che nessun contrasto è
sotto soglia, e che gli anti-riferimenti rimasti in piedi (la pillola flottante, il raggio unico,
l'icona grigia centrata negli stati vuoti) non ci sono più.

---

### C41 — Il riepilogo senza il quaderno, e ogni numero una volta sola — *fatto*

Richiesta del proprietario, e il primo pezzo è la correzione del punto 6 di C40 qui sopra: **quei
due scorrimenti fanno schifo.** Il quaderno — le colonne larghe quanto la finestra, i pallini sotto
— era la risposta sbagliata alla domanda giusta. C40 aveva preso «il riepilogo non scorre» come un
vincolo da rispettare a qualunque costo, e a quel costo si era comprato un gesto laterale che
nessuno scopre da solo, per una vista il cui unico compito è dire come siamo messi **in
un'occhiata**. Una cosa che si trova scorrendo non è in un'occhiata: era scorrimento con un altro
nome, e per giunta uno che il telefono non suggerisce.

**1. Non si è aggiustato il quaderno, si è tolto il motivo per cui esisteva.** Le schede erano
dieci e non ci stavano; adesso sono sei e ci stanno. La griglia è una griglia normale — tre colonne
per due righe sopra i 1024px, due per tre sopra i 640, una per sei sul telefono — e sei si divide
per tre e per due, quindi la tavola si chiude a ogni misura senza celle mezze vuote in fondo.
Nessun elemento deve più sapere quanti sono gli altri, e con il quaderno se ne sono andati
`montaPagine()`, i pallini, `scroll-snap`, le due variabili `--righe`/`--colonne` e le quattro
soglie di **altezza** che servivano a indovinare quante schede entrassero in una colonna.

**2. `min-height` e non `height`, che è tutta la differenza.** Da 1024px in su la vista si allunga
fino al bordo dello schermo e le due righe si dividono quello che avanza: la pagina è piena invece
di finire a metà con del nero sotto. Ma se lo schermo è corto la pagina si allunga e si scorre di
un dito, invece di tagliare un riquadro o mandarlo in una schermata laterale. **Fissare l'altezza è
esattamente quello che aveva costretto a inventare i pallini.** Misurato su otto formati con
Playwright: da 768px di finestra in su sta tutto in una schermata, sotto scorre in verticale come
ogni altra vista dell'app, e in nessuno degli otto un riquadro è tagliato dai propri bordi.

**3. Il calendario non serviva a niente, ed è vero.** Era la scheda più alta del riepilogo — è
quella su cui erano state misurate le soglie di `--righe`, cioè **dettava l'impaginazione a tutte
le altre** — e in cambio diceva quali giorni del mese hanno un'auto. Chi guarda il riepilogo vuole
sapere della settimana che viene, non di quella passata: la stessa domanda ha già una risposta
migliore due riquadri più in là, con dentro anche quanti posti sono presi.

**4. Ogni numero compare una volta sola**, ed è la regola nuova da qui in avanti. L'inventario dei
doppioni era imbarazzante: i **giorni scoperti** stavano in tre posti (la riga sotto il titolo, un
riquadro dei numeri, il piede della settimana), il **saldo** in due (il riquadro e la pastiglia dei
conti), i **passaggi in programma** in due, e i **prossimi sette giorni** avevano due schede intere
— «Prossimi sette giorni» e «Occupazione settimanale» — di cui la prima mostrava le auto di *un*
giorno solo, quasi sempre lo stesso passaggio già scritto in grande nella scheda accanto. Tre copie
dello stesso conto non sono tre informazioni: sono una, ripetuta, che ruba il posto a quelle che
mancano. Via l'agenda, via la pastiglia, via le due righe di troppo nella testata, e i riquadri dei
numeri da cinque a quattro: «Posti disponibili» era un riquadro intero per un dato che sta nella
riga sotto «Passaggi in programma», dove costa una riga.

**5. Un difetto trovato mentre si contavano i doppioni:** «Passaggi nel mese» aveva sotto «N
persone alla guida», e quel numero erano i guidatori **di sempre**, non quelli del mese. Due
finestre temporali nello stesso riquadro, e nessuna delle due scritta. Adesso conta chi ha guidato
nel mese, che è la cosa che il riquadro dice di dire.

**6. Un giro solo sulle righe, e tre letture in parallelo.** `disegnaRiepilogo` passava tre volte
sui passaggi — una per i conteggi, una per il carburante, una per il saldo — più un `filter`
sull'intero elenco per ognuno dei sette giorni della settimana: nove passate per delle somme che si
possono riempire tutte insieme. E i passaggi si aspettavano da soli prima che partissero le altre
due interrogazioni, cioè due viaggi di rete in fila per tre domande indipendenti. Nello stesso giro
è sparita `ridesTaken`, una mappa che veniva calcolata a ogni disegno e non era letta da nessuno.

**7. Le ripetizioni nella scrittura, che sono l'altra faccia dei doppioni a schermo.** Il ternario
del segno (`+ ` / `− ` e il valore assoluto) stava scritto a mano in otto punti: adesso è `firma()`,
e per strada ha smesso di dire «+ 0,00 €», che è un modo per annunciare un credito di niente. Il
plurale era un ternario ricopiato quindici volte: è `plurale()`. La testata del riepilogo era
scritta in tre copie che divergevano a ogni ritocco: è `testata()`. Il `(getDay() + 6) % 7` che sa
che la settimana comincia di lunedì stava in tre punti: è `giornoBreve()`. Con loro se n'è andato il
CSS di ciò che non esiste più — il calendario, l'agenda, i pallini, e una legenda a ciambella
rimasta nel foglio dopo che il grafico era diventato una riga in C40.

**Fatto quando:** il giudizio resta di chi la usa. Quello che qui si può dire chiuso è che non c'è
più un gesto laterale in nessuna delle otto misure, che nessun numero della vista compare due volte,
e che `npm run check` è verde.

---

## Revisione integrale del 27/07/2026 — cosa è uscito

Lettura riga per riga di `app.js` (2103 righe), delle 17 migrazioni, del guscio (`sw.js`,
`netlify.toml`, `index.html`, `manifest.json`), della Edge Function e dell'informativa, in una
passata sola con tutte le classi di controllo insieme. Metodo imposto da `Regole.md`, ed è la
seconda volta che ripaga: il difetto peggiore era **fuori** dal file che stavo guardando.

**Corretto in questo giro**

| Cosa | Dove | Perché contava |
|---|---|---|
| La zona di casa usciva dentro il profilo | `018` + `019`, C22 qui sopra | Il buco di C21 sull'altra tabella, e più esposto: bastava vedere un passaggio pubblico |
| `bloccati_fra` e `sospeso` rispondevano a chiunque su chiunque; i codici invito si potevano provare senza account | `020`, C23 qui sopra | `grant execute to public` è il default di Postgres. Il blocco è la cosa che la 012 nasconde perfino a chi lo subisce, e la lasciava leggere una funzione |
| La Home mostrava le auto delle **proprie altre comitive**, etichettate "in zona" | `loadRides` | Da C9 il filtro sul gruppo era sparito dalla query, e la policy fa uscire tutto il visibile — comprese le comitive di cui sono membro. Con una comitiva sola non si vedeva; con due, le pillole dei gruppi non volevano più dire niente e l'etichetta mentiva |
| `#i-edit` non esiste nello sprite | `index.html` | Il bottone "Cambia nome" mostrava un rettangolo vuoto al posto dell'icona, da sempre |
| L'esportazione revocava il blob nello stesso istante del click | `esportaDati` | La lezione era già stata pagata in `scaricaIcs`, e lì sola: fuori da Chrome il file poteva arrivare vuoto |
| Doppia sottoscrizione realtime a ogni accesso | `subscribeRealtime` | `render()` sottoscrive, poi chiama `setDate()`, che sottoscrive di nuovo: una connessione aperta e chiusa nello stesso istante |
| La Edge Function si apriva a chiunque se `CRON_SECRET` mancava | `functions/notifiche` | `if (segretoCron && ...)`: una guardia che si spegne da sola quando le manca la chiave. Ora rifiuta di partire |
| `supabase functions deploy` senza `--no-verify-jwt` | `supabase/README.md` | Il primo giro del cron avrebbe risposto `401` senza che niente somigliasse a un errore delle notifiche |
| L'informativa non diceva posizione, avvisi push e jsDelivr | `privacy.html` | Tre trattamenti veri e un terzo destinatario non dichiarati. È esattamente la lezione dei caratteri di C15: **un'informativa si verifica sulle richieste di rete, non sulle intenzioni** |

**Trovati e lasciati stare, con motivo**

- `.waitlist-row` e `.fuel` non esistono in `style.css` (già noto da C7). Non rompono niente:
  sono modificatori che non modificano.
- `askNotifyPermission()` chiede il permesso delle notifiche **al primo click ovunque**. Da C13
  c'è un interruttore esplicito nel Profilo, quindi è una domanda doppia e fuori contesto — e i
  browser penalizzano chi la fa a freddo. Toglierla è togliere un comportamento: serve un sì.
- `push_subscriptions.endpoint` è unico su tutta la tabella. Due account sullo stesso browser: al
  secondo l'app dice "avvisi accesi" e non arriva niente, perché la riga è dell'altro. Caso di
  dispositivo condiviso, si risolve quando le notifiche verranno accese davvero.
- Le Statistiche contano anche i passaggi **futuri** già pubblicati. Semanticamente discutibile,
  ma è la stessa cifra che si vede in Home: cambiarla è una decisione di prodotto, non un fix.
- Il realtime su `rides` passa da un permesso per colonna che prima non c'era (016). Il payload
  arriva filtrato per colonna e l'app lo ignora — ricarica e basta — ma **questo si guarda a
  video**, non si deduce: è già il punto 6 dei prossimi passi.

**Idee raccolte, da valutare (nessuna decisa)**

1. **Ospitare `supabase-js` invece di prenderlo da jsDelivr.** Chiude tre cose in un colpo: il
   numero di arrivo di C16 (73,5 KB e 9 richieste da un'altra origine, più della metà del peso
   totale), l'ultima riga di terze parti nella CSP, e l'ultimo destinatario nell'informativa. È il
   seguito naturale di quello che si è fatto con i caratteri.
2. **Accorpare le quattro attese incatenate della prima schermata** (profilo → bloccati → comitive
   → passaggi) in una RPC sola. È l'altra metà di C16, e si sente solo su rete lenta.
3. **Una vista "passaggi in zona" vera.** Oggi la scoperta è passiva: compaiono in Home mescolati
   ai propri. Con più comitive intorno servirà un posto dove cercarli di proposito.
4. **Avviso quando un passaggio viene annullato.** D5 dice tre notifiche sole, ma questa cambia i
   piani di chi ci contava più di tutte le altre: da riaprire, non da aggiungere di nascosto.
5. **Cancellare in blocco una serie ripetuta.** "Ripeti per 4 settimane" pubblica quattro auto e
   poi si annullano una per una.
6. **Il conto alla rovescia vivo** e il conteggio dei commenti che si aggiorna: due cosmetici già
   annotati in C7, che oggi costerebbero poco.
7. **`dest_lat`/`dest_lon`**: restano colonne morte finché non si riapre D6 (geocoder o selettore
   su mappa). Non è un bug da chiudere, è una decisione da riprendere.

---

## Decisioni prese dopo la prima stesura

| # | Punto | Scelta |
|---|---|---|
| **D5** | Notifiche (C13) | Tre eventi soli: posto prenotato nella tua auto, posto liberato in lista d'attesa, partenza fra un'ora. Commenti e nuove auto **no**: sarebbero rumore. Web Push standard, nessun servizio di terzi. |
| **D6** | Servizi esterni (C14) | Solo API native del browser: Web Share per l'invito, `.ics` per il calendario, link Maps con coordinate vere (dentro C9). Nessun SDK di terzi, nessuna analytics. |
| **D7** | Estetica (C15) | Il difetto è che sembra generata dall'AI, non che sia brutta. Si tolgono gli effetti generici, si sceglie una tipografia vera, l'auto SVG diventa protagonista. Prova del nove: coperto il logo, si riconosce lo stesso. |
| **D8** | Nome e dominio (C20) | Repo rinominato in `wetransport`; dominio proprio al momento dell'apertura al pubblico, non prima. |
| **D10** | Palette e tema (C40) | Onyx `#020202` e candy blue `#B2D5E5`, **un tema solo**: niente `prefers-color-scheme`, perché due palette sono due cose da mantenere e nessuna delle due è la faccia dell'app. Un accento solo, e le due cose che dice — «si tocca», «è tuo» — si distinguono per **forma** (scritto/contornato contro pieno), non per tinta. Sul riepilogo la regola e' cambiata in C41: **niente gesto laterale, mai**. La vista si allunga fino al bordo dello schermo e riempie quello che ha; se lo schermo e' corto si scorre in verticale come in ogni altra vista, invece di mandare le schede in una schermata laterale che nessuno trova. Quello che non entra si toglie, non si nasconde — e ogni numero compare una volta sola. |
| **D9** | Contrasto (C39) | Si calcola, non si stima. I rapporti nei commenti valgono finché nessuno tocca un token, cioè non valgono: `tests/contrasto.mjs` legge i token dal foglio di stile e sta dentro `npm run check`. Un colore che deve reggere due contrasti opposti (bianco sopra, se stesso come testo) è due token, non uno. |
