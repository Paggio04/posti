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
// insieme a `jq`, `bc` e `rg`). Il `fetch` nativo di Node >= 18 basta e non aggiunge
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
    attesoOggi: '200',
    attesoDopo: '42501',
    spiega: 'security definer con due id come parametri: dice di due estranei se si sono bloccati',
  },
  {
    nome: 'sospeso',
    funzione: 'sospeso',
    corpo: { u: IGNOTO_A },
    attesoOggi: '200',
    attesoDopo: '42501',
    spiega: 'stato di moderazione di chiunque, a chiunque',
  },
  {
    nome: 'join_group',
    funzione: 'join_group',
    corpo: { p_code: 'ZZZZZ9' },
    attesoOggi: 'P0001',
    attesoDopo: '42501',
    spiega: "risponde a chi non ha un account. Perche' e' un problema: vedi SECURITY.md, riga «Codici invito / enumerazione»",
  },
  {
    nome: 'mio_profilo',
    funzione: 'mio_profilo',
    corpo: {},
    attesoOggi: 'PGRST202',
    attesoDopo: '42501',
    spiega:
      "sonda di stato dello schema, non di C23: PGRST202 significa che la 018 non e' applicata. " +
      'Per questa riga la migrazione che cambia la risposta e\' la 018, non la 020: appena esiste, ' +
      "la funzione c'e' ma resta riservata a chi ha un account.",
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
    `${s.nome} | ${esito.http} | ${esito.codice} | atteso oggi: ${s.attesoOggi} — dopo la 020: ${s.attesoDopo}`
  );
}

console.log('');
console.log(`Progetto: ${SUPABASE_URL}`);
console.log('Legenda:');
console.log('  200      la funzione ha risposto a chi non ha un account');
console.log('  P0001    ha risposto, e il messaggio distingue un caso dall\'altro');
console.log('  42501    permesso negato: e\' quello che si vuole leggere dopo la 020');
console.log('  PGRST202 la funzione non esiste su questo progetto');
console.log('');
for (const r of righe) console.log(`  ${r.nome}: ${r.spiega}`);
console.log('');
const scarti = righe.filter((r) => r.codice !== r.attesoOggi);
console.log(
  scarti.length === 0
    ? 'Tutte le sonde rispondono come SECURITY.md dichiara oggi.'
    : `Scarti rispetto a quanto dichiarato oggi: ${scarti.map((r) => `${r.nome} → ${r.codice}`).join(', ')}. ` +
      'Se la 020 e la 018 sono state applicate, e\' questo file (e la riga di SECURITY.md) a dover cambiare.'
);
