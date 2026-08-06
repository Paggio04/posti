// Contrasto: si calcola, non si stima.
//
// PRODUCT.md chiede WCAG AA «come soglia verificata, non dichiarata», e finora
// nessuno la verificava: i rapporti stavano nei commenti del foglio di stile, scritti
// a mano una volta e mai piu' ricontrollati. Bastava cambiare un token perche' il
// commento diventasse falso — ed e' successo, nel tema scuro, su quattro coppie.
//
// Questo file legge i token **da style.css**, non da una copia: se il foglio cambia,
// cambia anche il controllo. Gira in `npm run check`, e fallisce con l'elenco delle
// coppie sotto soglia invece di un numero solo.
//
//   node tests/contrasto.mjs
//
// Cosa non fa: non guarda la pagina viva, quindi non vede un testo appoggiato su una
// superficie che qui non e' elencata. Le coppie vanno aggiunte quando nasce il
// componente che le usa.
//
// **Un tema solo.** Prima ce n'erano due e questo file li leggeva tutti e due: il
// blocco `:root` e quello dentro `prefers-color-scheme: dark`. Adesso l'app e' onyx
// e basta, quindi il secondo blocco non esiste piu' e il giro e' uno. Il candy blue
// non si sdoppia come si sdoppiava il navy — chiaro com'e', regge il testo sul buio
// **e** l'onyx sopra di se' con lo stesso valore — quindi i token `--primary` e
// `--primary-testo` hanno lo stesso colore e restano due nomi per due mestieri.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- colore -------------------------------------------------------------------

// OKLCH -> sRGB lineare. La matrice e' quella della specifica CSS Color 4.
function oklchARgb(L, C, hGradi) {
  const h = (hGradi * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
}

const luminanza = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function rapporto(primoPiano, fondo) {
  const [alto, basso] = [luminanza(primoPiano) + 0.05, luminanza(fondo) + 0.05]
    .sort((x, y) => y - x);
  return alto / basso;
}

// Un colore semitrasparente non e' il colore che si vede: va prima steso sul fondo.
const steso = ([r, g, b, alfa], fondo) =>
  alfa === 1 ? [r, g, b] : [r, g, b].map((v, i) => v * alfa + fondo[i] * (1 - alfa));

function leggiOklch(testo) {
  const m = testo.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)/);
  if (!m) throw new Error(`non e' un colore oklch: ${testo}`);
  return [...oklchARgb(+m[1], +m[2], +m[3]), m[4] === undefined ? 1 : +m[4]];
}

// --- i token, letti dal foglio di stile ----------------------------------------

const css = readFileSync(join(RADICE, 'style.css'), 'utf8');

// `:root { ... }` e' il tema chiaro; il blocco dentro `prefers-color-scheme: dark`
// e' quello scuro, e ridefinisce solo i token che cambiano.
function blocco(dopo) {
  const i = css.indexOf(dopo);
  if (i < 0) throw new Error(`blocco non trovato: ${dopo}`);
  const apre = css.indexOf('{', i);
  let livello = 0;
  for (let j = apre; j < css.length; j++) {
    if (css[j] === '{') livello++;
    else if (css[j] === '}' && --livello === 0) return css.slice(apre, j);
  }
  throw new Error(`blocco non chiuso: ${dopo}`);
}

function token(testo) {
  const mappa = {};
  for (const m of testo.matchAll(/(--[\w-]+)\s*:\s*(oklch\([^)]*\))\s*;/g)) mappa[m[1]] = m[2];
  return mappa;
}

const tema = token(blocco(':root'));
const BIANCO = [1, 1, 1, 1];

// --- le coppie che devono reggere ----------------------------------------------

// [etichetta, primo piano, fondo, soglia]
// Il primo piano e' un token (`--ink`), un colore scritto (`oklch(...)`) o BIANCO.
// La soglia e' 4.5 per il testo normale, 3 per il testo grande e per le forme che
// portano informazione senza essere testo (bordi, tracciati, anelli di fuoco).
const COPPIE = [
  ['testo normale su carta', '--ink', '--surface', 4.5],
  ['testo normale sul fondo', '--ink', '--bg', 4.5],
  ['testo tenue su carta', '--ink-soft', '--surface', 4.5],
  ['testo tenue sul fondo pagina', '--ink-soft', '--bg', 4.5],
  ['testo tenue sulla superficie 2', '--ink-soft', '--surface-2', 4.5],
  ['testo tenue sul rilievo', '--ink-soft', '--rilievo', 4.5],
  ['segnaposto dei campi', '--segnaposto', '--surface', 4.5],
  ['segnaposto dei campi, sul fondo', '--segnaposto', '--bg', 4.5],

  // Il bordo di un campo dice **dove si scrive**: e' un elemento non testuale che
  // porta informazione, quindi vale la 1.4.11 e la soglia e' 3. Il bordo tenue
  // (--border) non c'e' qui apposta: quello separa e basta, non dice niente.
  ['bordo di un campo, sulla carta', '--border-strong', '--surface', 3],
  ['bordo di un campo, sul fondo', '--border-strong', '--bg', 3],

  ['candy blue come testo, su carta', '--primary-testo', '--surface', 4.5],
  ['candy blue come testo, sul fondo', '--primary-testo', '--bg', 4.5],
  ['candy blue come testo, sul suo velo', '--primary-testo', '--primary-soft', 4.5],
  ['candy blue come testo, sul rilievo', '--primary-testo', '--rilievo', 4.5],
  ['onyx sul candy blue pieno', '--su-primario', '--primary', 4.5],
  ['onyx sul candy blue al passaggio', '--su-primario', '--primary-hover', 4.5],
  ['anello di fuoco sul fondo pagina', '--primary-testo', '--bg', 3],
  ['contorno del candy blue, sulla carta', '--primary-bordo', '--surface', 3],

  // «Questo e' tuo»: pieno con l'onyx sopra, e il contorno che lo circonda.
  ['onyx su cio\' che e\' tuo', '--tuo-su', '--tuo', 4.5],
  ['cio\' che e\' tuo, come testo su carta', '--tuo-testo', '--surface', 4.5],
  ['cio\' che e\' tuo, come testo sul suo velo', '--tuo-testo', '--tuo-velo', 4.5],
  ['contorno di cio\' che e\' tuo, sulla carta', '--tuo-bordo', '--surface', 3],

  ['errore sul suo velo', '--danger', '--danger-soft', 4.5],
  ['errore su carta', '--danger', '--surface', 4.5],
  ['bianco sul bottone distruttivo', BIANCO, '--danger-pieno', 4.5],
  ['bianco sulla barra senza rete', BIANCO, '--danger-pieno', 4.5],
  ['conferma sul suo velo', '--ok', '--ok-soft', 4.5],
  ['conferma su carta', '--ok', '--surface', 4.5],

  // Le sei tinte degli avatar (COLORI_AV in app.js): un cerchio con due lettere
  // dentro e' testo, e vale la soglia del testo. Sono sei perche' servono a
  // distinguere sei persone, ma stanno tutte nella famiglia del candy blue e
  // portano tutte l'onyx sopra: cambiano di luminosita' prima che di tinta.
  ['iniziali sull\'avatar 1', '--su-primario', 'oklch(0.78 0.030 227)', 4.5],
  ['iniziali sull\'avatar 2', '--su-primario', 'oklch(0.70 0.050 250)', 4.5],
  ['iniziali sull\'avatar 3', '--su-primario', 'oklch(0.72 0.060 200)', 4.5],
  ['iniziali sull\'avatar 4', '--su-primario', 'oklch(0.66 0.070 215)', 4.5],
  ['iniziali sull\'avatar 5', '--su-primario', 'oklch(0.74 0.040 265)', 4.5],
  ['iniziali sull\'avatar 6', '--su-primario', 'oklch(0.68 0.040 185)', 4.5],
  ['iniziali sull\'avatar tuo', '--tuo-su', '--tuo', 4.5],

  // L'auto. La scocca e' un elemento non testuale che porta informazione — se non
  // si vede, non si vede che c'e' un'auto — quindi vale la 1.4.11 e la soglia e'
  // 3:1, su **tutti e due** i fondi su cui l'auto compare: il pannello
  // dell'accesso e la scheda di un passaggio. E' la coppia che avrebbe fermato le
  // prime due stesure: scocca riempita di `--surface` faceva 1,42:1.
  ['scocca dell\'auto, sul fondo pagina', '--scocca', '--bg', 3],
  ['scocca dell\'auto, sulla scheda del passaggio', '--scocca', '--surface', 3],
  ['il vuoto di un posto, sulla scocca', '--posto', '--scocca', 3],
  ['il posto tuo, sulla scocca', '--tuo', '--scocca', 3],
  ['contorno di un posto, sul suo vuoto', '--posto-bordo', '--posto', 3],
  ['contorno di un posto libero, sul suo vuoto', '--primary', '--posto', 3],
  ['iniziali dentro un posto', '--ink', '--posto', 4.5],
  ['iniziali dentro il posto tuo', '--tuo-su', '--tuo', 4.5],
  ['gomma sulla scocca', '--gomma', '--scocca', 3],

  // Il benvenuto e' l'unico riquadro dove il candy blue prende tutta la superficie:
  // il testo sotto il titolo e' un onyx schiarito, non l'onyx pieno, e va misurato.
  ['testo del benvenuto', 'oklch(0.30 0.03 227)', '--primary', 4.5],
  ['bottone scuro dentro il benvenuto', '--primary', '--su-primario', 4.5],

  // La striscia dei numeri quando e' tua: etichetta e nota sono onyx schiarito
  // sopra il candy blue pieno.
  ['etichetta di un numero tuo', 'oklch(0.30 0.03 227)', '--tuo', 4.5],
];

let bocciate = 0;
// Il fondo su cui si stende un colore semitrasparente e' il nero della pagina, non
// il bianco: qui sotto non c'e' piu' un foglio.
const SOTTO = leggiOklch(tema['--bg']).slice(0, 3);
for (const [etichetta, pp, fondo, soglia] of COPPIE) {
  const rgbFondo = steso(leggiOklch(tema[fondo] ?? fondo), SOTTO);
  const rgbPp = steso(pp === BIANCO ? BIANCO : leggiOklch(tema[pp] ?? pp), rgbFondo);
  const r = rapporto(rgbPp, rgbFondo);
  const passa = r >= soglia;
  if (!passa) bocciate++;
  console.log(`  ${passa ? '  ok' : '  NO'}  ${r.toFixed(2).padStart(5)}:1  (min ${soglia})  ${etichetta}`);
}

if (bocciate) {
  console.error(`\n  ${bocciate} coppie sotto soglia.\n`);
  process.exit(1);
}
console.log('\n  Tutte le coppie reggono la soglia AA.\n');
