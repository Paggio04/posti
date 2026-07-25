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

## Dove siamo (25/07/2026)

**Fasi 0, 1 e 2 chiuse e pubblicate.** `main` è al merge della PR #1, il sito vivo serve l'app
nuova, le migrazioni 000-011 sono applicate in produzione, e il ramo che pubblica è protetto da
controlli obbligatori. **T1 è raggiunto sul piano tecnico**; quello che manca per dire "pronta per
la comitiva" è gente vera che la usa.

**Fase 3 scritta e verificata sul ramo, non ancora pubblicata**: C10 sicurezza delle persone
(migrazione 012), C11 GDPR (013), C9 passaggi in zona (014). Ogni cantiere ha il suo file di test in
CI, e ogni test è stato provato al contrario — tolta una protezione alla volta, per vedere se
diventa rosso davvero.

Prima di pubblicare la Fase 3, quattro cose che il repo non può fare da solo:

| Cosa | Dove | Perché | Stato |
|---|---|---|---|
| Titolare del trattamento nell'informativa | `privacy.html` | Dato legale obbligatorio; pubblicare un'email personale è una decisione di chi la possiede | Riquadro rosso in pagina |
| Regione del progetto Supabase | Supabase → Settings → General | L'API non la espone, si legge solo dalla dashboard | Riquadro rosso in pagina |
| Revocare il token Supabase della sessione del 24/07 | Supabase → Account → Access Tokens | Era servito per applicare le migrazioni; un token che non serve più non deve esistere | Da fare |
| Due account di prova + segreti `WT_TEST_*` | Supabase + GitHub → Settings → Secrets | Sbloccano `tests/flussi.spec.js` a ogni PR; senza, restano i soli smoke (C8) | Assenti all'ultima PR |

### L'ordine di pubblicazione, che qui è l'opposto di quello della 011

**Prima le migrazioni 012, 013 e 014 in produzione, poi il codice.** Verificato sul progetto vivo il
25/07/2026: `profiles.sospeso`, `profiles.zona_lat`, `rides.visibilita` e la tabella `user_reports`
**non esistono ancora**. Il codice nuovo le legge al primo caricamento — `ensureProfile` chiede
`sospeso`, `loadBlocked` interroga `user_blocks` — quindi pubblicarlo prima vuol dire un'app rotta
per chiunque la apra, non un degrado elegante.

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

### C11 — GDPR completo — *fatto nel codice; due dati mancano e li può mettere solo una persona*
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
- **Due cose non le può mettere il codice**, e nella pagina sono riquadri rossi bene in vista
  invece che frasi plausibili inventate:
  - **il titolare del trattamento** — nome e contatto di chi gestisce l'app. È un dato legale, e
    pubblicare un'email personale su un sito pubblico è una decisione di chi la possiede;
  - **la regione del progetto Supabase**, che si legge solo dalla dashboard (Settings → General) e
    che l'API non espone.
  Finché ci sono quei riquadri, l'informativa **non** è completa e l'app non è pronta per T2.
- **Fatto quando:** un utente esporta e cancella tutto da solo, e la cancellazione porta via anche
  auto, prenotazioni, richieste e commenti. **Raggiunto**, meno i due dati qui sopra.

---

## Fase 4 — Integrare

### C12 — PWA vera
Il `manifest.json` c'è ma **manca il service worker**: l'app non è installabile come si deve e non
apre offline. Serve anche l'icona in PNG 192 e 512 (oggi solo SVG, che alcuni sistemi ignorano) e
una schermata sensata quando la rete non c'è. *Fatto quando:* installata dal telefono, si apre
senza barra del browser e mostra qualcosa di utile anche offline.

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

### C14 — Servizi esterni
**Deciso — solo cose che il browser sa già fare, nessun SDK, nessuna voce nuova nella CSP:**

| Cosa | Come | Perché così |
|---|---|---|
| Invita al gruppo | Web Share API nativa (che sul telefono offre WhatsApp da sola) + copia del codice come ripiego | Zero dipendenze, funziona con tutte le app di messaggistica, non solo WhatsApp |
| Passaggio nel calendario | File `.ics` generato dall'app | Nessun servizio esterno, funziona con Google, Apple e Outlook allo stesso modo |
| Navigazione al ritrovo | Link Maps, con coordinate vere al posto del testo libero | Rimandato dentro C9, che è il cantiere dove nascono i luoghi veri |

**Esclusi**: SDK di terzi, analytics, login social oltre a Google. Ogni SDK è codice altrui in
esecuzione dentro la mia pagina e una riga in più nella CSP.

---

## Fase 5 — Abbellire e ottimizzare

### C15 — Togliere l'aria di cosa generata
**Il problema non è che sia brutta: è che sembra generata.** Aurora animata sull'accesso, nav
flottante a pillola, tutto arrotondato, animazioni a molla, gradienti morbidi: è l'estetica
predefinita delle interfacce fatte dall'AI in questi mesi. Nessun dettaglio è sbagliato, e proprio
per questo nessuno è *suo*. Chi la apre non ricorda niente.

**Cosa si fa:**
1. **Togliere gli effetti che non dicono niente**: aurora, bagliori, gradienti decorativi. Sono
   costati righe di CSS e non distinguono l'app da altre mille.
2. **Scegliere un carattere tipografico vero** e portarne il peso: la tipografia è il modo più
   economico di avere un'identità, e oggi è quella di sistema.
3. **Fare dell'auto la protagonista.** L'SVG dei sedili è l'unica cosa qui dentro che nessun altro
   ha: è disegnata su misura per questo problema. Oggi è un elemento fra tanti dentro una scheda.
4. **Un accento solo, deciso**, al posto della palette morbida buona per qualsiasi cosa.
5. **Testi con una voce.** "Bentornato", "Accedi per vedere chi guida oggi" sono corretti e
   anonimi: è il registro predefinito. Questa è un'app per una comitiva di amici, può parlare come loro.
6. **Stati vuoti disegnati**, non icona grigia centrata con frase gentile.

**Fatto quando:** copro il logo e il nome con un dito, mostro uno screenshot a qualcuno, e si
capisce lo stesso che è questa app e non un'altra. Prima e dopo affiancati.

### C16 — Peso e velocità sul telefono
1200 righe di CSS e 1311 di JS senza build, più supabase-js da CDN. Misurare prima di ottimizzare:
tempo alla prima schermata utile su rete lenta, dimensione totale, quante query fa la home.
*Fatto quando:* c'è un numero di partenza e uno di arrivo, non un'impressione.

### C17 — Spezzare `app.js`
L'ADR 001 dice di rivedere la scelta "un file solo" oltre le 2-3k righe di JS: oggi siamo a 1311 e
le Fasi 3 e 4 aggiungono roba. Quando si supera la soglia: moduli ES separati (auth, gruppi,
passaggi, render), sempre senza build. **Non prima**: dividere presto costa e non rende.

---

## Fase 6 — Allineare al resto dello studio

### C18 — Standard dello Starter
Portare qui quello che la base dei siti ha già e questo repo no: SEO completa (`robots.txt`,
`sitemap.xml`, dati strutturati), `404.html`, pagina cookie se serviranno cookie di profilazione,
`eslint.config.js` versionato. Al contrario, quello che WeTransport ha imparato e lo Starter non
sa ancora torna indietro nello Starter.

### C19 — Vault e codice allineati
Mappa Graphify rigenerata, memoria tecnica aggiornata con le decisioni di questo file, nota
progetto che punta qui invece di duplicare.

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

## Decisioni prese dopo la prima stesura

| # | Punto | Scelta |
|---|---|---|
| **D5** | Notifiche (C13) | Tre eventi soli: posto prenotato nella tua auto, posto liberato in lista d'attesa, partenza fra un'ora. Commenti e nuove auto **no**: sarebbero rumore. Web Push standard, nessun servizio di terzi. |
| **D6** | Servizi esterni (C14) | Solo API native del browser: Web Share per l'invito, `.ics` per il calendario, link Maps con coordinate vere (dentro C9). Nessun SDK di terzi, nessuna analytics. |
| **D7** | Estetica (C15) | Il difetto è che sembra generata dall'AI, non che sia brutta. Si tolgono gli effetti generici, si sceglie una tipografia vera, l'auto SVG diventa protagonista. Prova del nove: coperto il logo, si riconosce lo stesso. |
| **D8** | Nome e dominio (C20) | Repo rinominato in `wetransport`; dominio proprio al momento dell'apertura al pubblico, non prima. |
