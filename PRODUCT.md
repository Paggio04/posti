# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Una comitiva di amici che si organizza i passaggi in auto, e — da ora dichiaratamente — chi sta
nella stessa zona senza conoscere nessuno: il lavoro si giudica su **T2, l'app aperta a chiunque**,
non più solo sul gruppo che si conosce già. Il contesto d'uso non è una scrivania: è in piedi, di
corsa, con una mano sola, spesso al buio davanti a un portone, cinque minuti prima di partire. Da
qui in avanti ogni scelta visiva si giudica in quella situazione, non su uno schermo grande e fermo.

Il lavoro da fare è uno e si legge in tre secondi: **chi guida oggi, e c'è posto per me.**

Progettare per T2 significa che fiducia, identità di chi guida, segnalazione e blocco non sono
funzioni di servizio da nascondere in un menù: sono parte della decisione di salire in macchina con
una persona che non si conosce.

## Product Purpose

Chi guida pubblica la propria auto, gli altri prenotano un sedile preciso. Sostituisce il gruppo
di messaggi dove i passaggi si perdono fra cento messaggi. Funziona quando nessuno deve chiedere
"allora chi passa a prendermi?".

## Positioning

Il posto non è un numero che scala, è **un sedile scelto tappando sulla pianta dell'auto**. È il
meccanismo che una chat di gruppo, un foglio condiviso o una bacheca di annunci non possono
imitare: rende visibile a colpo d'occhio chi è già a bordo e dove resta spazio, e trasforma "ci sto
anch'io" in una prenotazione con un vincolo vero dietro (un posto per persona per auto).

Il secondo elemento di posizione è l'opposto di un social: **l'appartenenza a una comitiva è il
confine dei dati**, non una funzione di scoperta. Un passaggio si vede se sei nel gruppo che lo
ospita, se hai un posto su quell'auto, se è aperto alla tua zona (25 km dal punto di partenza) o se
è pubblico. Aprirsi agli sconosciuti in T2 avviene dentro quel confine, non rimuovendolo.

## Operating Context

- **Telefono, in movimento, spesso con rete pessima.** Installabile come PWA; senza linea si apre
  l'ultimo guscio salvato e l'app dice chiaramente che la linea manca invece di fingere.
- **Momento d'uso corto e ripetuto**: si apre per sapere chi guida, si prenota, si chiude. Non c'è
  una sessione lunga da riempire.
- **Il gruppo esiste già fuori dall'app** (la comitiva, la chat): l'app non deve ricostruire quella
  socialità, deve togliere una domanda ricorrente da quella chat.
- **Il denaro circola fra amici, non attraverso l'app.** I conti in sospeso e i pagamenti sono una
  contabilità condivisa di ciò che ci si deve; l'app non incassa e non trasferisce nulla.
- **Realtime**: la vista si invalida da sola quando qualcuno prenota, quindi due persone che
  guardano lo stesso sedile nello stesso momento è uno scenario normale, non un caso limite.
- La roadmap è il piano di lavoro vivo (`docs/ROADMAP.md`), le decisioni architetturali stanno in
  `docs/adr/`: entrambi sono contesto vincolante per capire perché una cosa è com'è, e la roadmap
  registra anche le idee **scartate**, che non vanno riproposte.

## Capabilities and Constraints

- **Sito statico senza build step.** HTML/CSS/JS vanilla, deploy su Netlify dalla root. Nessun
  bundler: quello che si scrive è quello che viene servito.
- **Nessun backend proprio.** Supabase per auth e Postgres; tutta la sicurezza vive nel database
  (RLS + trigger) e il client è non fidato per definizione. La anon key è pubblica per design.
- **Il service worker mette in cache il guscio, mai dati né sessioni.** Vincolo dichiarato e
  motivato: una copia di dati sarebbe una copia che l'esportazione non mostra e la cancellazione
  non porta via.
- **Ciò che regge la mancanza di rete non dipende dalla rete**: `rete.js` non importa niente e
  prova la rete con una richiesta vera invece di fidarsi di `navigator.onLine`.
- Funzioni presenti a schema: passaggi e sedili, gruppi, richieste di passaggio (con ora), lista
  d'attesa, commenti, amministratore e segnalazioni, cancellazione account, passaggi in zona,
  coordinate riservate, pagamenti e conti, registro eventi, ricorrenze. Migrazioni numerate fino
  alla `025`.
- Un posto per persona per auto (vincolo `unique`); il guidatore gestisce la propria auto e può
  liberare i sedili; chi blocca una persona smette di vederla nei due sensi; un amministratore
  legge la coda delle segnalazioni e nessuno può promuoversi da solo.
- **Aperto e non chiuso, e vincolante per il resto**: le notifiche a scheda chiusa sono ferme.
  Tabella e trigger esistono dalla `017` e la coda si riempie, ma `VAPID_PUBLIC_KEY` è vuota, la
  Edge Function non è mai stata eseguita, `pg_cron` è spento e nel client non c'è una riga che
  legga quella tabella. Tre cantieri della Fase 7 non esistono finché questo non si accende.
- CI bloccante su lint, validazione HTML, scansione segreti, migrazioni riapplicate da zero e
  Playwright sull'anteprima della PR e sul sito vivo. `main` è protetto da un ruleset versionato
  con status check obbligatori e nessun bypass: **si arriva a main solo per PR**.

## Brand Commitments

- **Il nome è una decisione aperta.** Nel frattempo il nome in uso è **WeTransport**, applicato
  ovunque (titoli, manifest, pagine, README); "Posti" resta solo il nome della cartella. Futuro
  lavoro non deve trattare WeTransport come definitivo né reintrodurre "Posti" di sua iniziativa.
- Tagline in uso: **"chi guida oggi?"**.
- L'app è senza scopo di lucro e lo dichiara nella privacy: niente linguaggio da prodotto
  commerciale, niente promesse di scala.

## Brand Personality

**Diretta, di paese, artigianale.** Parla come parla la comitiva — "chi guida oggi", "restano due
posti", "l'auto di Marco è piena" — e allo stesso tempo si vede che l'ha fatta una persona con
delle opinioni: scelte visibili, niente compromessi morbidi, cura anche dove nessuno guarda. Lo
stesso tono dei commenti nel codice e della roadmap. Mai il registro da prodotto: niente
"Bentornato", niente "Gestisci le tue preferenze".

## Evidence on Hand

**C'è:**

- **Dati veri di prova**: account e passaggi reali su cui ragionare per stati pieni, liste
  popolate e casi limite. Gli stati pieni non vanno immaginati.
- **Asset grafici originali e vincolanti**: l'SVG dei sedili (il pezzo che nessun altro ha), le
  icone (`icon.svg`, `icona-*.png`) e i font in `fonts/`.
- **Screenshot e collaudo a video** dell'app in uso.

**Non c'è, e non va inventato:** testimonianze, recensioni, numeri d'uso, dimensione della base
utenti, loghi di partner, casi studio, benchmark, prezzi. L'app è online e funzionante ma non ha
ancora una base di utenti reali a regime: qualunque prova sociale sarebbe fabbricata.

## Product Principles

1. **Una domanda, tre secondi.** Ogni schermata si giudica su quanto in fretta risponde a "chi
   guida oggi, e c'è posto per me". Ciò che non serve a quella risposta compete con essa.
2. **Il confine dei dati è un impegno, non un'impostazione.** Chi vede cosa è deciso nel database e
   spiegato all'utente; nessuna schermata può suggerire una visibilità diversa da quella reale.
3. **Progettare per la rete peggiore, non per la migliore.** Offline, lentezza e fallimento sono
   stati normali e vanno detti in chiaro, mai mascherati da caricamento infinito.
4. **In T2 la fiducia è parte del prodotto.** Identità di chi guida, segnalazione, blocco e
   sospensione sono percorsi di prima classe, perché salire in auto con uno sconosciuto è la
   decisione vera che l'app chiede di prendere.
5. **Onestà artigianale.** Niente prove sociali finte, niente linguaggio da prodotto scalabile,
   niente promesse che il database non mantiene, e una cifra sui conti si può sempre aprire e
   verificare voce per voce.

## Anti-references

Scritte dal proprietario in D7, e sono la ragione per cui questo cantiere esiste: **il difetto non
è che sia brutta, è che sembra generata.** Aurora animata sull'accesso, nav flottante a pillola,
tutto arrotondato allo stesso raggio, animazioni a molla, gradienti morbidi decorativi, palette
morbida buona per qualsiasi cosa, stati vuoti con icona grigia centrata e frase gentile.

Due riflessi da evitare anche dopo aver tolto quelli sopra:

- **il secondo riflesso**: togliere l'aurora e finire in "Linear-like" — grigi, densità, calma —
  che è l'aspirazione predefinita di metà delle app;
- **il terzo**: dominio automobilistico → "terminal dark mode" da quadro strumenti.

## Design Principles

1. **La tipografia fa il lavoro, non la decorazione.** Se un elemento si capisce grazie a un
   gradiente o a un'ombra, non si è capito: si riscrive con dimensione, peso e spazio.
2. **Il movimento dice lo stato, o non c'è.** Il tondo della navigazione si sposta sulla scheda
   attiva perché indica dove sei. Niente si muove per fare scena.
3. **L'auto è la protagonista.** L'SVG dei sedili è l'unica cosa qui dentro che nessun altro ha:
   è disegnata su misura per questo problema, e deve essere la prima cosa che si vede.
4. **Riferimento fisico, non digitale**: un tabellone degli orari, un biglietto, un cartello. La
   profondità finta non serve a un'informazione che si legge in tre secondi.
5. **Un accento solo, e deciso.** Un colore che significa "questo puoi toccarlo, questo è il tuo
   stato". Tutto il resto è inchiostro, carta e una riga di bordo.

## Accessibility & Inclusion

WCAG **AA** come soglia verificata, non dichiarata: 4.5:1 sul testo, 3:1 su titoli grandi e
elementi non testuali, e i rapporti si calcolano invece di stimarli a occhio.

`prefers-reduced-motion` non spegne l'informazione: dove il movimento indica uno stato, lo stato
cambia **di scatto** invece di scomparire. Un'animazione che porta significato non si può
semplicemente togliere, si può solo rendere istantanea.

Gli stati non si dicono col colore da solo: posto libero, occupato e tuo si distinguono anche per
forma o etichetta, perché un'auto piena e un'auto vuota non possono dipendere dal rosso e dal
verde.
