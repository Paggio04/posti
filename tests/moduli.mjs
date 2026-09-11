// I fili fra i moduli: ogni nome importato dev'essere davvero esportato dal file da cui
// lo si chiede. Gira in CI e in locale con `node tests/moduli.mjs`.
//
// **Perche' serve un controllo suo.** `node --check` guarda un file per volta, ed ESLint
// tratta un `import` come una dichiarazione e basta: per tutti e due `import { pippo }
// from './nucleo.js'` e' corretto anche se `nucleo.js` non ha mai sentito nominare
// `pippo`. Lo scopre il browser, a pagina aperta, e l'errore parla del file che chiede
// invece che del file che dovrebbe dare. Da C17 i moduli sono tredici e i fili una
// sessantina: e' esattamente il genere di cosa che non si tiene a mente.
//
// **E il caso opposto conta quanto il primo.** Un `export` che non chiede piu' nessuno
// non rompe niente, ma su un file appena spezzato e' quasi sempre un resto — un nome
// rimasto nell'elenco dopo che la riga che lo usava e' diventata un setter. Lasciarlo
// passare vuol dire che l'elenco delle esportazioni smette di dire chi parla con chi,
// che e' l'unica ragione per cui lo si tiene scritto a mano.
//
// Provato al contrario: togliendo un nome da un `export { ... }` il controllo diventa
// rosso e nomina il file che lo chiede; aggiungendone uno che nessuno importa, rosso
// con «e non lo chiede nessuno».
import fs from 'node:fs';
import path from 'node:path';

const RADICE = path.join(import.meta.dirname, '..');
const files = ['app.js', ...fs.readdirSync(path.join(RADICE, 'mod')).sort().map((f) => 'mod/' + f)];
// **Anche i test e il banco consumano i moduli**, e un `export` che serve solo a
// loro non e' un export orfano. `tests/auto.mjs` legge la geometria dell'auto dal
// modulo vero invece di ricopiarsela, e `banco.html` usa `collegaPromo` perche'
// l'invito a installare l'app e' logica vera anche quando i dati intorno sono
// finti: senza questa riga quei fili sembrerebbero recisi, e il rimedio sbagliato
// sarebbe duplicare il codice. Di questi file si guardano gli import e basta:
// quello che esportano non riguarda l'app.
const lettori = ['banco.html', ...fs.readdirSync(path.join(RADICE, 'tests')).sort()
  .filter((f) => f.endsWith('.mjs')).map((f) => 'tests/' + f)];

const esportati = new Map();
const importati = [];

for (const f of [...files, ...lettori]) {
  const t = fs.readFileSync(path.join(RADICE, f), 'utf8');
  const set = new Set();
  for (const m of t.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const p of m[1].split(',')) { const n = p.split(' as ').pop().trim(); if (n) set.add(n); }
  }
  for (const m of t.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) set.add(m[1]);
  for (const m of t.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) set.add(m[1]);
  if (files.includes(f)) esportati.set(f, set);

  for (const m of t.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)'/gm)) {
    const nomi = m[1].split(',').map((p) => p.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    let dest = m[2];
    if (dest.startsWith('.')) dest = path.posix.normalize(path.posix.join(path.posix.dirname(f), dest));
    importati.push({ da: f, dest, nomi });
  }
}

const scarti = [];
for (const imp of importati) {
  // `vendor/` e `config.js` non sono di questo giro: il primo e' generato, il secondo
  // e' due righe di configurazione.
  if (!esportati.has(imp.dest)) continue;
  for (const n of imp.nomi) {
    if (!esportati.get(imp.dest).has(n)) {
      scarti.push(`${imp.da} chiede \`${n}\` a ${imp.dest}, che non lo esporta`);
    }
  }
}
for (const [f, set] of esportati) {
  for (const n of [...set].sort()) {
    if (!importati.some((i) => i.dest === f && i.nomi.includes(n))) {
      scarti.push(`${f} esporta \`${n}\` e non lo chiede nessuno`);
    }
  }
}

// --- Il guscio del service worker elenca esattamente i moduli dell'app --------
//
// `sw.js` nomina i file del guscio uno per uno, ed e' giusto che sia cosi': un
// guscio che si riempie da solo mette in cache quello che capita. Ma un elenco
// scritto a mano si dimentica, e un modulo che l'app importa e il guscio non ha
// **non da' errore in linea** — da' un'app installata che offline non apre, cioe'
// il momento peggiore in cui accorgersene.
//
// Il confronto e' con i moduli **raggiungibili da `app.js`**, non con il contenuto
// della cartella: `mod/installa.js` oggi lo usa solo il banco, e nel guscio non ci
// deve stare. Il giorno in cui l'app lo importa, questa riga diventa rossa finche'
// non si aggiunge anche a `sw.js`, che e' esattamente quando serve saperlo.
const raggiungibili = new Set();
(function segui(da) {
  for (const imp of importati.filter((i) => i.da === da && i.dest.startsWith('mod/'))) {
    if (raggiungibili.has(imp.dest)) continue;
    raggiungibili.add(imp.dest);
    segui(imp.dest);
  }
})('app.js');
const nelGuscio = new Set([...fs.readFileSync(path.join(RADICE, 'sw.js'), 'utf8')
  .matchAll(/'\/(mod\/[\w.-]+\.js)'/g)].map((m) => m[1]));
for (const f of [...raggiungibili].sort()) {
  if (!nelGuscio.has(f)) scarti.push(`${f} lo importa l'app e il guscio di sw.js non ce l'ha`);
}
for (const f of [...nelGuscio].sort()) {
  if (!raggiungibili.has(f)) scarti.push(`sw.js mette ${f} nel guscio e l'app non lo importa`);
}

if (scarti.length) {
  for (const s of scarti) console.error('  ' + s);
  console.error(`\nFili fra i moduli: ${scarti.length} scarti.`);
  process.exit(1);
}
console.log(`Fili fra i moduli: ${files.length} file, ${importati.length} import, tutto combacia.`);
