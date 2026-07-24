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

### C1 — Anteprima per ogni modifica, test che bloccano
- **Obiettivo:** poter provare una modifica a un indirizzo temporaneo prima che la vedano gli utenti.
- **Cosa:** attivare i Deploy Preview di Netlify sulle pull request; spostare il job `e2e` dal sito
  vivo all'URL dell'anteprima; renderlo bloccante sul merge; togliere il `sleep 60`.
- **Fatto quando:** una PR con un bug evidente non è mergiabile, e `main` non si è mai rotto per provarlo.
- **Collaudo:** apro una PR di prova che rompe un selettore → CI rossa, merge bloccato, sito live intatto.

### C2 — Migrazioni numerate al posto del file unico
- **Obiettivo:** sapere sempre quale schema è davvero applicato.
- **Cosa:** spezzare `supabase-setup.sql` in file numerati applicati una volta e in ordine, con
  traccia di cosa è già stato eseguito. Sistemare il doppione già presente: il blocco
  `ride_waitlist` è definito due volte (righe 260 e 303), riapplicare il file oggi darebbe errore.
- **Fatto quando:** ricreo il backend da zero su un progetto vuoto applicando le migrazioni in
  ordine, senza un solo errore, e ottengo lo schema identico a quello in produzione.
- **Collaudo:** progetto Supabase di prova, migrazioni in ordine, confronto delle tabelle.

### C3 — Controlli locali accesi
- **Obiettivo:** `pre-volo.py` smette di saltare metà dei controlli.
- **Cosa:** `package.json` con ESLint e html-validate come dipendenze di sviluppo, configurazione
  allineata a quella della CI (oggi la CI se la scrive al volo in `ci.yml`: una sola fonte).
- **Fatto quando:** `python C:\WEB\Strumenti\pre-volo.py C:\Progetti\posti` esce 0 e non dice più
  "saltato".
- **Collaudo:** comando in locale, uscita 0.

---

## Fase 1 — Chiudere i due buchi (T1)

### C4 — Tutto dentro un gruppo *(decisione D1)*
- **Obiettivo:** nessuna riga di dati senza una comitiva che la possiede.
- **Cosa:** `group_id` diventa obbligatorio su `rides` e `ride_requests`; policy e trigger perdono
  i rami `group_id is null` e i `coalesce(..., '000...')` che li accompagnano; l'app obbliga a
  creare o entrare in un gruppo al primo accesso; i dati esistenti senza gruppo vengono archiviati.
- **Fatto quando:** un utente di un gruppo non vede **nessun** dato di un altro gruppo, verificato
  con due account veri in due comitive diverse.
- **Collaudo a video:** due account, due gruppi, stesso giorno: nessuno dei due vede l'auto dell'altro,
  né nello storico né nelle statistiche.

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

### C13 — Notifiche
Oggi le notifiche esistono solo con la scheda aperta in secondo piano (`maybeNotify`). Servono
notifiche vere a scheda chiusa: "hanno prenotato un posto nella tua auto", "la tua auto parte fra
un'ora", "si è liberato un posto". Richiede service worker (C12) e una decisione sul come.

### C14 — Servizi esterni
Navigazione verso il punto di ritrovo, invito al gruppo condiviso su WhatsApp, passaggio aggiunto
al calendario. **Da confermare quali servono davvero**: ognuno è codice da mantenere e voci nella CSP.

---

## Fase 5 — Abbellire e ottimizzare

### C15 — Rifinitura dell'interfaccia
Il redesign del 21/07 ha già dato forme tonde, nav a pillola, aurora sull'accesso e animazioni a
molla. **Da confermare cosa manca ancora**: prima schermata per chi arriva senza gruppo, stati
vuoti, transizioni fra schede, tema scuro rivisto, illustrazione dell'auto.

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
Cercare "wetransport" su GitHub non trova niente. **Da confermare**: rinominare il repo in
`wetransport`, e se prendere un dominio proprio.

---

## Da confermare

Punti aperti, da chiudere prima dei cantieri che li riguardano:

1. **C14** — quali servizi esterni servono davvero (Maps, WhatsApp, calendario, altro).
2. **C15** — cosa vuol dire "abbellire" adesso, dopo il redesign del 21/07: cosa ti dà fastidio guardandola.
3. **C20** — rinominare il repo in `wetransport`? Dominio proprio al posto di `.netlify.app`?
4. **C13** — notifiche a scheda chiusa: quali eventi valgono davvero un avviso sul telefono.
