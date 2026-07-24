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

## Fase 0 — Rete di sicurezza (prima di toccare qualsiasi altra cosa)

Oggi ogni push su `main` è la pubblicazione, e gli smoke test girano **dopo**, contro il sito
vivo: se rompo qualcosa, lo rompo davanti a chi sta usando l'app. Tutto il resto della roadmap
tocca sicurezza e schema, cioè le cose dove sbagliare costa di più. Questa fase viene prima.

### C1 — Anteprima per ogni modifica, test che bloccano — *scritto, da collaudare alla prima PR*
- **Obiettivo:** poter provare una modifica a un indirizzo temporaneo prima che la vedano gli utenti.
- **Fatto:** il job `e2e-anteprima` aspetta lo stato di deploy che Netlify scrive sul commit della
  PR, ricava da lì l'indirizzo dell'anteprima e ci lancia Playwright; niente più `sleep 60` alla
  cieca. I test leggono l'indirizzo da `BASE_URL` (`playwright.config.js`) invece di averlo scritto
  dentro. Il vecchio job sul sito vivo resta come rete di sicurezza dopo la pubblicazione
  (`e2e-produzione`), ma non è più l'unica difesa.
- **Restano due cose da fare a mano, sul pannello:** i Deploy Preview vanno attivi su Netlify, e su
  GitHub `checks` + `e2e-anteprima` vanno messi come controlli obbligatori sul ramo `main`
  (Settings → Branches), altrimenti il merge resta possibile con la CI rossa.
- **Fatto quando:** una PR con un bug evidente non è mergiabile, e `main` non si è mai rotto per provarlo.
- **Collaudo:** apro una PR di prova che rompe un selettore → CI rossa, merge bloccato, sito live intatto.
  Se il passo "Trova l'anteprima Netlify" stampa un avviso invece dell'indirizzo, l'integrazione
  GitHub-Netlify non è attiva e va sistemata lì.

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
- **Attenzione — codice e database ora sono disallineati:** il sito vivo serve ancora l'app vecchia,
  quella con la pillola "Tutti", mentre il database non accetta più passaggi senza comitiva. Con 0
  membri nei gruppi nessuno se ne accorge, ma finché questo ramo non è pubblicato la Home mostra
  una lista vuota e pubblicare un'auto darebbe errore. **Va pubblicato.**
- **Resta il collaudo a video**, che nessun test sostituisce: due account veri, due comitive, stesso
  giorno.

### C5 — Profili chiusi *(decisione D2)*
- **Obiettivo:** smettere di mostrare nome e avatar di tutti a tutti.
- **Cosa:** sostituire `profiles read using (true)` con una regola basata sui gruppi in comune;
  rivedere le query di `app.js` che oggi danno per scontato di poter leggere qualsiasi profilo
  (storico, statistiche, lista d'attesa, commenti).
- **Fatto quando:** un utente non vede il nome di nessuno con cui non condivide una comitiva, e
  **nessuna schermata mostra un nome vuoto o un trattino** al posto di una persona.
- **Collaudo a video:** account estraneo → home, storico, statistiche, commenti: tutti i nomi che
  compaiono sono di gente del suo gruppo, nessun buco.

---

## Fase 2 — Rinforzare quello che c'è (T1)

### C6 — Bug noti da chiudere
| Bug | Dove | Effetto |
|---|---|---|
| Avatar Google bloccati dalla CSP | `netlify.toml`, `img-src 'self' data:` | Chi entra con Google ha un avatar che punta a `lh3.googleusercontent.com`: il browser lo blocca, restano le iniziali. La funzione è scritta ma non si vede mai. |
| `ride_waitlist` definita due volte | `supabase-setup.sql:260` e `:303` | Riapplicare il file dà errore a metà (chiuso da C2) |
| `meta description` mancante | `privacy.html` | Controllo di consegna rosso; correzione già fatta in locale e mai committata |

### C7 — Revisione integrale di `app.js`
- **Obiettivo:** trovare tutti i bug, non i primi che saltano fuori.
- **Cosa:** lettura riga per riga delle 1311 righe in **una sola passata esaustiva**, con tutte le
  classi di controllo insieme (errori non gestiti, stato che resta sporco, casi limite di data e
  fuso, doppi tap, realtime che cade, sessione scaduta). Metodo imposto da `Regole.md`: le passate
  incrementali hanno già lasciato passare bug gravi.
- **Fatto quando:** esiste l'elenco completo dei difetti trovati, ognuno o corretto o scritto qui
  con il motivo per cui resta.

### C8 — Test end-to-end sui flussi veri
- **Obiettivo:** gli smoke test coprono oggi solo la schermata di accesso. Il cuore dell'app —
  pubblicare un'auto, prenotare un sedile, vedere l'aggiornamento in tempo reale — non è testato.
- **Cosa:** utenti di prova su un progetto Supabase dedicato ai test; scenari: registrazione →
  gruppo → pubblica auto → secondo utente prenota → il primo lo vede senza ricaricare → doppia
  prenotazione dello stesso sedile → vince uno solo.
- **Fatto quando:** i test girano sull'anteprima (C1) e falliscono davvero se rompo uno di quei flussi.

---

## Fase 3 — Aprire al pubblico (T2)

Da qui in poi l'app la usano persone che non conosco. Nessuno di questi cantieri parte prima che
la Fase 1 sia chiusa.

### C9 — Passaggi in zona *(la D dell'intervista)*
- **Obiettivo:** trovare un passaggio da qualcuno che sta in zona ma non è della mia comitiva.
- **Cosa:** luogo di partenza e arrivo veri sul passaggio (oggi c'è solo un link Maps testuale);
  zona sul profilo; campo `visibilità` (`gruppo` / `zona` / `pubblico`); regole di lettura che
  seguono; **estensione della regola D2**: vedo il nome di chi guida un passaggio che posso vedere.
- **Fatto quando:** cerco un passaggio fuori dal mio gruppo, lo trovo, e continuo a non vedere
  niente dei gruppi a cui non appartengo.
- **Dipende da:** C4, C5, C10.

### C10 — Sicurezza delle persone
- **Obiettivo:** un'app dove sconosciuti salgono in macchina insieme e non c'è modo di segnalare
  nessuno non è pronta per il pubblico. Vale più di qualsiasi funzione.
- **Cosa:** segnalare un utente, bloccarlo (non ci vediamo più i passaggi a vicenda), una coda di
  segnalazioni per me, sospensione di un account.
- **Fatto quando:** posso segnalare, bloccare, e vedere le segnalazioni; un utente sospeso non
  entra più.

### C11 — GDPR completo
- **Obiettivo:** oggi `SECURITY.md` segna la conformità come parziale, e va bene finché siamo fra
  amici. Con iscritti sconosciuti diventa un obbligo.
- **Cosa:** informativa privacy pubblicata e aggiornata (titolare, base giuridica, conservazione,
  Supabase come responsabile, regione dei dati); esportazione dei propri dati; cancellazione
  dell'account dall'app, non dalla dashboard.
- **Fatto quando:** un utente esporta e cancella tutto da solo, e la cancellazione porta via anche
  auto, prenotazioni, richieste e commenti.

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
