// Sonde dall'esterno, con la sola chiave pubblica: quello che risponde a chi non ha
// un account e non ha mai visto il repo.
//
// **Non gira in CI, e non deve.** Punta al progetto Supabase vero (`config.js`), non a
// un Postgres di prova: si lancia a mano, quando serve sapere com'e' il mondo adesso.
//
//   node --no-warnings supabase/test/sonde-esterne.mjs
//
// **Legge e basta.** `bloccati_fra` e `sospeso` sono `stable`; `join_group` con un
// codice inesistente alza `Codice non valido` prima di scrivere qualsiasi cosa, e senza
// account l'insert non ci arriverebbe comunque. Nessuna sonda modifica la produzione.
//
// **Perche' Node e non `curl`**: sulla macchina di casa `curl` non c'e' (Ambiente.md,
// insieme a `jq`, `bc` e `rg`). Il `fetch` nativo di Node >= 22.7 basta e non aggiunge
// dipendenze. Il `--no-warnings` serve solo a zittire l'avviso di Node che rilegge
// `config.js` come modulo ES: il repo non ha `"type": "module"` in `package.json`.
//
// La chiave si **importa**, non si ricopia: quando ruota, ruota in un posto solo.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

if (typeof SUPABASE_URL !== 'string' || !SUPABASE_URL.startsWith('https://')) {
  throw new Error(`config.js: SUPABASE_URL non e' un indirizzo https valido: ${SUPABASE_URL}`);
}
if (typeof SUPABASE_ANON_KEY !== 'string' || SUPABASE_ANON_KEY.length < 20) {
  throw new Error("config.js: SUPABASE_ANON_KEY manca o e' troppo corta per essere una chiave");
}

// Due id che non esistono: le sonde devono dire se la funzione **risponde**, non cosa
// risponde su una persona vera.
const IGNOTO_A = '00000000-0000-4000-8000-000000000001';
const IGNOTO_B = '00000000-0000-4000-8000-000000000002';

// Ogni sonda: come si chiama, cosa si manda, e cosa ci si aspetta prima e dopo la 020.
// L'atteso sta qui accanto di proposito: una riga di SECURITY.md vale finche' il
// comando che le sta accanto le da' ragione.
const SONDE = [
  {
    nome: 'bloccati_fra',
    funzione: 'bloccati_fra',
    corpo: { a: IGNOTO_A, b: IGNOTO_B },
    attesoOggi: '42501',
    attesoDopo: '42501',
    spiega: 'security definer con due id come parametri: diceva di due estranei se si sono bloccati. Chiusa dalla 020',
  },
  {
    nome: 'sospeso',
    funzione: 'sospeso',
    corpo: { u: IGNOTO_A },
    attesoOggi: '42501',
    attesoDopo: '42501',
    spiega: 'dava lo stato di moderazione di chiunque, a chiunque. Chiusa dalla 020',
  },
  {
    nome: 'join_group',
    funzione: 'join_group',
    corpo: { p_code: 'ZZZZZ9' },
    attesoOggi: '42501',
    attesoDopo: '42501',
    spiega: "non e' piu' chiamabile senza account (020). Resta aperta da autenticato: vedi SECURITY.md, riga «Codici invito / enumerazione», e C24",
  },
  {
    nome: 'mio_profilo',
    funzione: 'mio_profilo',
    corpo: {},
    attesoOggi: '42501',
    attesoDopo: '42501',
    migrazione: '018',
    spiega:
      "sonda di stato dello schema, non di C23: la 018 l'ha creata (01/08/2026) e la lascia " +
      "riservata a chi ha un account. PGRST202 qui vorrebbe dire che la funzione e' sparita.",
  },
];

async function sonda(s) {
  let risposta;
  try {
    risposta = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${s.funzione}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(s.corpo),
    });
  } catch (e) {
    // Un errore di rete non e' un esito della sonda: propagarlo con contesto, non
    // farlo passare per un 200.
    throw new Error(`${s.nome}: la chiamata non e' partita (${e.message})`, { cause: e });
  }

  const testo = await risposta.text();
  let codice;
  if (risposta.ok) {
    codice = '200';
  } else {
    try {
      codice = JSON.parse(testo).code ?? '(nessun code)';
    } catch {
      codice = `(risposta non JSON: ${testo.slice(0, 60)})`;
    }
  }
  return { http: risposta.status, codice, testo };
}

const righe = [];
for (const s of SONDE) {
  const esito = await sonda(s);
  righe.push({ ...s, ...esito });
  console.log(
    `${s.nome} | ${esito.http} | ${esito.codice} | atteso: ${s.attesoOggi}`
  );
}

console.log('');
console.log(`Progetto: ${SUPABASE_URL}`);
console.log('Legenda:');
console.log('  42501    permesso negato: lo stato corretto dal 01/08/2026');
console.log('  P0001    ha risposto, e il messaggio distingue un caso dall\'altro');
console.log('  42501    permesso negato: e\' quello che si vuole leggere dopo la 020');
console.log('  PGRST202 la funzione non esiste su questo progetto');
console.log('');
for (const r of righe) console.log(`  ${r.nome}: ${r.spiega}`);
console.log('');
const scarti = righe.filter((r) => r.codice !== r.attesoOggi);
const riepilogo = () => console.log(
  scarti.length === 0
    ? 'Tutte le sonde rispondono come SECURITY.md dichiara oggi.'
    : `Scarti rispetto a quanto dichiarato oggi: ${scarti.map((r) => `${r.nome} → ${r.codice}`).join(', ')}. ` +
      'Le migrazioni 018, 019 e 020 sono applicate dal 01/08/2026: uno scarto qui e\' una regressione, non un aggiornamento da fare.'
);

// --- La 019, che si misura senza account ---------------------------------
// Il permesso per colonna vale per il RUOLO e si valuta PRIMA della RLS: quindi
// `select=*` su una tabella protetta e' rifiutato anche a chi non vedrebbe nessuna
// riga. `rides` ce l'ha dalla 016 e risponde 42501; `profiles` no, e risponde 200 [].
// La differenza fra le due risposte E' la misura: non serve un accesso autenticato.
async function tabella(nome) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${nome}?select=*&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  return r.status;
}

console.log('');
const rides = await tabella('rides');
const profiles = await tabella('profiles');
const zonaChiusa = profiles === 401 || profiles === 403;
console.log(`019 | rides select=* -> ${rides} (riferimento: la 016 e' applicata)`);
console.log(`019 | profiles select=* -> ${profiles} -> zona ${zonaChiusa ? 'RISERVATA' : 'LEGGIBILE (regressione)'}`);
// La 019 e' applicata dal 01/08/2026: la zona deve restare riservata. Se un giorno
// `profiles select=*` tornasse leggibile, e' una regressione vera, non un aggiornamento.
if (!zonaChiusa) scarti.push({ nome: '019', codice: `${profiles} (REGRESSIONE: la zona e' di nuovo leggibile)` });

riepilogo();
// Uno script di verifica che esce 0 comunque non verifica niente: se la realta'
// si scosta da cio' che SECURITY.md dichiara, deve dirlo anche al processo.
process.exitCode = scarti.length === 0 ? 0 : 1;
