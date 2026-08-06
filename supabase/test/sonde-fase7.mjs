// Sonde della Fase 7, dall'esterno, con la sola chiave pubblica.
//
//   node --no-warnings supabase/test/sonde-fase7.mjs
//
// **Non gira in CI, e non deve** — come `sonde-esterne.mjs`, di cui e' la sorella: punta
// al progetto Supabase vero (`config.js`), non a un Postgres di prova. Si lancia a mano,
// e serve a rispondere a una domanda sola: **le migrazioni 026-033 sono applicate, e
// applicate bene?**
//
// ── Perche' si puo' misurare da fuori, senza account ────────────────────────
// Il permesso per **colonna** (016) vale per il **ruolo** e si valuta **prima** della
// RLS. Quindi `anon` puo' dire se una colonna e' leggibile senza vedere una sola riga:
//
//   * `200` con `[]`  -> la colonna c'e' e il permesso c'e'. La RLS fa il resto.
//   * `401 42501`     -> permission denied: **il permesso per colonna manca**.
//   * `400 42703`     -> la colonna non esiste: la migrazione non e' stata applicata.
//
// E' la stessa differenza che `SECURITY.md` usa per la riga «PII handling»: non serve un
// account per misurare un permesso che vale per il ruolo.
//
// ── Legge e basta ───────────────────────────────────────────────────────────
// Nessuna sonda scrive. Le due su `create_group` sono `POST`, ma la 020 ha revocato
// `execute` ad `anon`: il `42501` arriva **prima** che il corpo della funzione parta,
// quindi nessun gruppo viene creato. E' lo stesso ragionamento con cui
// `sonde-esterne.mjs` puo' chiamare `join_group` senza toccare la produzione.
//
// ── Cosa cerca, e perche' quelle domande ────────────────────────────────────
// A. **Le colonne nuove sono leggibili.** E' il difetto che la 027 ha fatto emergere:
//    dalla 016 il permesso su `rides` e' per colonna e lo ricalcola
//    `blinda_coordinate()`, quindi una colonna aggiunta dopo nasce invisibile e la Home
//    va in errore per tutti. Qui si vede da fuori, in due secondi.
// B. **Le coordinate sono ancora chiuse.** Il modo piu' facile di "riparare" A e' un
//    `grant select on rides`, che rimette C21 esattamente dov'era. Le due meta' vanno
//    guardate insieme o la prima autorizza a rompere la seconda.
// C. **Le tabelle nuove esistono e non restituiscono niente** a chi non ha un account.
// D. **`create_group` risponde con e senza `p_scade`.** La 033 cancella la firma vecchia
//    e ne crea una con un parametro in piu' che ha un default: `PGRST202` qui vuol dire
//    che PostgREST non la trova — di solito perche' la cache dello schema e' vecchia, e
//    si risolve con `notify pgrst, 'reload schema';`. Finche' e' cosi', «Crea gruppo» da'
//    404 anche a migrazione applicata.
//
// La chiave si **importa**, non si ricopia: quando ruota, ruota in un posto solo.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

if (typeof SUPABASE_URL !== 'string' || !SUPABASE_URL.startsWith('https://')) {
  throw new Error(`config.js: SUPABASE_URL non e' un indirizzo https valido: ${SUPABASE_URL}`);
}
if (typeof SUPABASE_ANON_KEY !== 'string' || SUPABASE_ANON_KEY.length < 20) {
  throw new Error("config.js: SUPABASE_ANON_KEY manca o e' troppo corta per essere una chiave");
}

const intestazioni = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

async function leggi(percorso) {
  const risposta = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { headers: intestazioni });
  const testo = await risposta.text();
  let corpo = null;
  try { corpo = JSON.parse(testo); } catch { /* non e' JSON: resta il testo */ }
  return { stato: risposta.status, codice: corpo?.code ?? null, testo };
}

async function chiama(funzione, argomenti) {
  const risposta = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funzione}`, {
    method: 'POST',
    headers: { ...intestazioni, 'Content-Type': 'application/json' },
    body: JSON.stringify(argomenti),
  });
  let corpo = null;
  try { corpo = await risposta.json(); } catch { /* vuoto */ }
  return { stato: risposta.status, codice: corpo?.code ?? null };
}

const esiti = [];
const registra = (nome, letto, atteso, passa) => esiti.push({ nome, letto, atteso, passa });
const come = (r) => `${r.stato}${r.codice ? ' ' + r.codice : ''}`;

// ── A. Le colonne aggiunte dalla Fase 7 devono essere leggibili ─────────────
for (const [tabella, colonna] of [
  ['rides', 'ritardo_min'], ['rides', 'ritardo_alle'], ['rides', 'ritorno_di'], ['rides', 'auto_id'],
  ['groups', 'scade_il'], ['groups', 'regola_quota'], ['groups', 'regola_guida_non_paga'],
  ['groups', 'regola_max_posti'],
  ['seat_claims', 'ospite_nome'], ['seat_claims', 'invitato_da'],
]) {
  const r = await leggi(`${tabella}?select=${colonna}&limit=1`);
  // 42501 = il permesso per colonna manca (manca `blinda_coordinate()` in fondo alla
  // migrazione). 42703 = la colonna non c'e' proprio: migrazione non applicata.
  registra(`${tabella}.${colonna}`, come(r), 'ne 42501 ne 42703',
    r.codice !== '42501' && r.codice !== '42703');
}

// ── B. E le quattro coordinate devono restare chiuse (C21) ──────────────────
for (const colonna of ['origin_lat', 'origin_lon', 'dest_lat', 'dest_lon']) {
  const r = await leggi(`rides?select=${colonna}&limit=1`);
  registra(`rides.${colonna} chiusa`, come(r), '42501', r.codice === '42501');
}
{
  const r = await leggi('rides?select=*&limit=1');
  registra('rides select=* rifiutato', come(r), '42501', r.codice === '42501');
}

// ── C. Le tabelle nuove ci sono, e non danno niente a chi non ha un account ─
for (const tabella of ['fermate', 'auto', 'notifiche_coda']) {
  const r = await leggi(`${tabella}?select=id&limit=1`);
  // PGRST205 = tabella sconosciuta a PostgREST. Il corpo deve essere vuoto: `fermate` e
  // `auto` hanno policy `to authenticated`, `notifiche_coda` non ha policy affatto.
  registra(`${tabella} esiste e tace`, `${come(r)} ${r.testo}`.trim(), '200 []',
    r.codice !== 'PGRST205' && r.testo.replace(/\s/g, '') === '[]');
}

// ── D. `create_group` risponde nelle due forme ──────────────────────────────
for (const [etichetta, argomenti] of [
  ['create_group senza scadenza', { p_name: 'sonda' }],           // come la chiama l'app vecchia
  ['create_group con scadenza', { p_name: 'sonda', p_scade: null }], // come la chiama la nuova
]) {
  const r = await chiama('create_group', argomenti);
  // 42501 e' la risposta giusta: la funzione **c'e'** ed e' riservata a chi ha un account
  // (020). PGRST202 vuol dire che PostgREST non la trova.
  registra(etichetta, come(r), '42501', r.codice === '42501');
}

// ── E. E C23 resta chiuso: se una migrazione lo riaprisse, si saprebbe qui ──
for (const [etichetta, funzione, argomenti] of [
  ['join_group', 'join_group', { p_code: 'ZZZZZ9' }],
  ['mio_profilo', 'mio_profilo', {}],
]) {
  const r = await chiama(funzione, argomenti);
  registra(`${etichetta} riservata`, come(r), '42501', r.codice === '42501');
}

let rotte = 0;
console.log('sonda'.padEnd(32), 'risposta'.padEnd(16), 'atteso'.padEnd(18));
console.log('-'.repeat(78));
for (const e of esiti) {
  if (!e.passa) rotte++;
  console.log(e.nome.padEnd(32), String(e.letto).padEnd(16), e.atteso.padEnd(18), e.passa ? 'ok' : '<<< DA GUARDARE');
}
console.log('-'.repeat(78));
if (rotte === 0) {
  console.log(`Tutte e ${esiti.length} le sonde rispondono come devono: la Fase 7 e' applicata.`);
} else {
  console.log(`${rotte} sonde su ${esiti.length} da guardare.`);
  process.exitCode = 1;
}
