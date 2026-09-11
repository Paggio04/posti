# La libreria di Supabase, ospitata qui

`supabase-js.esm.js` è `@supabase/supabase-js` **2.116.0**, impacchettato in un file solo.
222 KB, 58 KB compressi. `LICENSE` è la sua: MIT, che permette di tenerla nel repo.

**Sta qui e non su un CDN di terzi per le stesse tre ragioni dei caratteri**, ed era
l'*idea 1* della revisione del 27/07 in `docs/ROADMAP.md`:

1. **L'informativa.** Prendendola da jsDelivr, il browser di chi apre l'app contattava un
   dominio di terzi, che vedeva il suo indirizzo IP e il tipo di browser. `privacy.html`
   doveva elencarlo, e lo elencava. Adesso i responsabili sono di nuovo due — Supabase e
   Netlify — e non c'è nessun terzo da dichiarare.
2. **La CSP.** `script-src` e `connect-src` in `netlify.toml` non nominano più
   `cdn.jsdelivr.net`: una regola che si stringe invece di allargarsi.
3. **Il peso e la partenza.** Erano 73,5 KB in nove richieste verso un'altra origine —
   nove aperture di connessione prima che l'app potesse partire. Adesso è un file solo,
   dalla stessa origine, nel `GUSCIO` del service worker.

C'è una quarta ragione, arrivata dopo e più concreta delle tre: **un ambiente che non
raggiunge jsDelivr non poteva eseguire i test.** Fuori da GitHub Actions — una sandbox con
un proxy, un aereo, una rete d'ufficio con una lista bianca — `app.js` non partiva affatto,
quindi metà dei controlli end-to-end falliva per una ragione che non c'entrava niente con il
codice in prova. Un test che non si può eseguire dove si scrive non protegge chi scrive.

## Aggiornarla

```bash
npm i -D @supabase/supabase-js@<versione>
npm run vendor
```

Poi si **rilegge il numero di versione qui sopra** e si alza `VERSIONE` in `sw.js`, perché
questo file è guscio: senza, chi ha l'app già aperta continua a usare quella di prima.

**Il file è generato, e va rigenerato invece che modificato.** Se serve una modifica alla
libreria, si cambia la versione: una riga corretta a mano qui dentro sparisce al primo
aggiornamento e non lascia traccia di essere esistita.
