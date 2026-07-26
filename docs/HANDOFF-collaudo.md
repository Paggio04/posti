# Handoff — collaudo a video di WeTransport

Questo file serve a una sessione **locale**, sulla macchina di Elia, per fare il collaudo che da
un container non si può fare: aprire l'app in un browser vero, con un account vero, e guardare se
funziona davvero. Tutto quello che c'è qui sotto è stato verificato **automaticamente**; niente è
stato verificato **da un essere umano che usa l'app**.

## Come è andata fino a qui

- Repo: `Paggio04/posti` (il dominio è `wetransport.netlify.app`: i tre nomi sono ancora diversi,
  è il cantiere C20)
- Il lavoro è arrivato su `main` con la PR #3
- Database Supabase: progetto `ggjhvsnhzwapdulcjgkh`, regione **eu-west-2 (Londra)**
- Migrazioni applicate in produzione: **000 → 014** (15 righe in `public.schema_migrations`)
- Amministratore nominato: **Elia**

## Da fare per prima cosa: partire

```bash
git clone https://github.com/Paggio04/posti.git
cd posti
npm ci
npx serve .        # oppure: python3 -m http.server 8000
```

Serve un **server**, non `file://`: `app.js` è un modulo ES e da `file://` il browser lo blocca.

Su `localhost` funziona l'accesso con email e password. **Non** funziona "Continua con Google":
`localhost` non è fra gli indirizzi di reindirizzo autorizzati sul progetto Supabase.

Il sito vero è **https://wetransport.netlify.app** e parla con lo stesso database. Non esiste un
progetto di staging, quindi **qualsiasi cosa si prenoti o pubblichi è reale**, e i 4 utenti la
vedono. Per provare i flussi, meglio un account di prova dedicato.

## Cosa controllare, in ordine di rischio

### 1. C9 — la posizione, che era spenta in produzione

Il difetto più grave trovato: `Permissions-Policy: geolocation=()` teneva spenta la
geolocalizzazione **anche per la pagina stessa**, quindi "Parto da qui" non ha mai funzionato sul
sito vivo. Corretto in `geolocation=(self)`, e c'è uno smoke test che lo copre.

Da verificare a mano, perché `navigator.geolocation` non si collauda con un test di database:

- [ ] "Metti la tua auto" → "Parto da qui" chiede il permesso e prende una posizione vera
- [ ] Pubblicare con visibilità **zona** ora è possibile (prima il form la rifiutava sempre)
- [ ] Impostare la propria zona nel Profilo
- [ ] Un secondo account con la zona entro 25 km **vede** quel passaggio; uno fuori raggio no

### 2. C14 — navigazione e calendario

- [ ] Su un passaggio **della propria comitiva** con coordinate: il link dice "Naviga al ritrovo"
      e apre il percorso sul punto vero
- [ ] Su un passaggio visto **da fuori comitiva**: il link dice "Punto di ritrovo su Maps" e cerca
      il nome del luogo, **non** le coordinate. È la regola di `coordinateVisibili()`: il punto
      esatto di partenza di una persona può essere casa sua
- [ ] Il pulsante calendario scarica un `.ics` che si apre davvero in Calendario / Google Calendar,
      **con l'ora giusta** (la conversione in UTC usa il fuso del telefono)
- [ ] Un passaggio senza ora produce un evento di giornata intera

### 3. C12 — PWA, da installare su un telefono vero

Verificato in un browser: worker attivo, guscio in cache, ricarica offline, barra della rete.
**Mai verificato su un telefono.**

- [ ] Installarla da Safari (iOS) e da Chrome (Android)
- [ ] Si apre **senza la barra del browser**
- [ ] L'icona sulla home è quella giusta e non sgranata (PNG 192 e 512)
- [ ] Su Android: come sta l'icona dentro la maschera circolare? Le PNG sono `purpose: "any"`,
      **non** `maskable`, quindi potrebbe venire tagliata. Se succede serve una variante con i
      margini, ed è un lavoro di disegno
- [ ] Modalità aereo: l'app si apre, la barra rossa compare, e dice il vero
- [ ] Tornata la rete, i passaggi si ricaricano da soli

### 4. C15 — l'estetica, che è la cosa che solo tu puoi giudicare

Il primo tentativo è stato bocciato ("sembra il sito di una casa di riposo") e revertito. Il
secondo aggiunge invece di togliere: navy come colore principale, bordi tondeggianti, ottone solo
dove una cosa è tua, materiali sull'auto, tondo della navigazione che scivola sulla scheda attiva.

- [ ] **La prova del nove:** coprire logo e nome con un dito e chiedere a qualcuno se capisce che
      è questa app e non un'altra
- [ ] Il tondo della navigazione, su un telefono, con il pollice: si capisce dove sei?
- [ ] Il tuo sedile in ottone si trova a colpo d'occhio in un'auto piena?
- [ ] Sul telefono al sole, i contrasti tengono? (calcolati: 16.1:1 sul testo, 7.2:1 sul
      secondario, 10.1:1 bianco su navy)

### 5. Il resto della Fase 3, mai eseguito in un browser

Tutto verificato su Postgres, **niente** verificato a video. Servono **due account veri in due
comitive diverse**:

- [ ] Segnalare una persona: il segnalato **non** deve sapere di esserlo
- [ ] Bloccare: vale nei due sensi, e l'auto della persona bloccata sparisce **tranne** se ci sei
      già sopra
- [ ] Sospendere un account dalla coda dell'amministratore: perde la parola, non la vista
- [ ] "Scarica i miei dati": il JSON contiene tutto il proprio e **non** le segnalazioni ricevute
- [ ] "Elimina il mio account": porta via tutto il proprio, e **se possiedi una comitiva questa
      passa al membro più anziano** invece di sparire con te. Questo è il controllo più importante
      di tutti, perché un errore qui danneggia gli altri

## Cose in sospeso che non sono bug

| Cosa | Dove | Nota |
|---|---|---|
| **Revocare il token Supabase del 24/07** | dashboard → Account → Access Tokens | segnalato tre volte, mai fatto |
| Segreti `WT_TEST_*` + due account di prova | Supabase + GitHub Secrets | senza, `tests/flussi.spec.js` si salta |
| **C21**: coordinate esatte nel payload | `select('*')` su `rides` | il link è prudente, il payload no: serve una vista e una migrazione `015` |
| Inter arriva da Google | `index.html` | l'informativa dichiara solo Supabase e Netlify come responsabili, e un font di Google è un terzo che vede l'IP. I file di IBM Plex sono già in `fonts/`, inutilizzati: il commit che li usava è dentro il tentativo revertito (`a94d1dc`) |
| Icone `maskable` | `manifest.json` | vedi C12 |

## Come verificare il database senza indovinare

Nel SQL editor di Supabase:

```sql
-- Deve dire 15 righe, ultima 014_passaggi_in_zona
select version, applied_at from public.schema_migrations order by version;

-- Un amministratore, e sei tu
select p.display_name, p.is_admin from public.profiles p where p.is_admin;

-- Le colonne che il codice pretende
select column_name from information_schema.columns
where table_name = 'rides' and column_name in
  ('visibilita', 'origin_lat', 'origin_lon', 'dest_lat', 'dest_lon');
```

`dest_lat`/`dest_lon` esistono e **nessuno le scrive**: è voluto, non un bug. Le coordinate
arrivano solo da `navigator.geolocation`, e alla destinazione non ci sei; riempirle vorrebbe dire
un geocoder, che la decisione D6 esclude.

## Il metodo, se serve continuare

Due lezioni pagate in questa sessione, e vale rispettarle:

1. **Le coordinate speculari si calcolano, non si scrivono.** Le ruote dell'auto erano fuori di 4px
   e una sporgeva dal disegno; i tondi della navigazione erano posizionati a occhio. Ora c'è
   `specchia(x, w)` e le misure della barra sono variabili da cui si ricava tutto.
2. **Un controllo che misura la cosa sbagliata è peggio di nessun controllo**, perché autorizza a
   chiudere il caso. La mia misura del tondo diceva "centrato a 0.02px" mentre ignorava un bordo da
   4px, e il difetto l'ha trovato l'occhio del proprietario, non il mio script.

E la terza, dalla CI, che ha avuto ragione contro di me **due volte di fila**:

- primo giro: un test rosso ha trovato un difetto vero che il collaudo locale mascherava (lo stub
  del CDN rispondeva sempre, quindi `app.js` partiva sempre). Da lì la regola: **ciò che rende
  l'app resistente alla mancanza di rete non può dipendere dalla rete** — la barra "sei senza
  rete" e la registrazione del service worker stavano in `app.js`, che come prima riga importa un
  modulo da un CDN. Ora stanno in `rete.js`, che non importa niente;
- secondo giro: la CI ha bocciato quella correzione, ragionevole e insufficiente. Il colpevole era
  `navigator.onLine`, che dice *«esiste una scheda di rete»*, non *«internet funziona»*: resta
  `true` sul wifi dell'albergo che non porta da nessuna parte. Ora la rete **si prova** con una
  richiesta piccola che il service worker lascia passare invece di servire dalla cache.

In nessuno dei due giri il test era da aggiustare. Se un test è rosso e la spiegazione comoda è
"il test è fragile", quasi sempre la spiegazione è sbagliata.
