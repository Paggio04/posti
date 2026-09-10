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

const esportati = new Map();
const importati = [];

for (const f of files) {
  const t = fs.readFileSync(path.join(RADICE, f), 'utf8');
  const set = new Set();
  for (const m of t.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const p of m[1].split(',')) { const n = p.split(' as ').pop().trim(); if (n) set.add(n); }
  }
  for (const m of t.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) set.add(m[1]);
  for (const m of t.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) set.add(m[1]);
  esportati.set(f, set);

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

if (scarti.length) {
  for (const s of scarti) console.error('  ' + s);
  console.error(`\nFili fra i moduli: ${scarti.length} scarti.`);
  process.exit(1);
}
console.log(`Fili fra i moduli: ${files.length} file, ${importati.length} import, tutto combacia.`);
