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

const chiaro = token(blocco(':root'));
const scuro = { ...chiaro, ...token(blocco('@media (prefers-color-scheme: dark)')) };
const BIANCO = [1, 1, 1, 1];

// --- le coppie che devono reggere ----------------------------------------------

// [etichetta, primo piano, fondo, soglia]
// Il primo piano e' un token (`--ink`), un colore scritto (`oklch(...)`) o BIANCO.
// La soglia e' 4.5 per il testo normale, 3 per il testo grande e per le forme che
// portano informazione senza essere testo (bordi, tracciati, anelli di fuoco).
const COPPIE = [
  ['testo normale su carta', '--ink', '--surface', 4.5],
  ['testo tenue su carta', '--ink-soft', '--surface', 4.5],
  ['testo tenue sul fondo pagina', '--ink-soft', '--bg', 4.5],
  ['testo tenue sulla superficie 2', '--ink-soft', '--surface-2', 4.5],
  ['segnaposto dei campi', '--segnaposto', '--surface', 4.5],

  ['primario come testo, su carta', '--primary-testo', '--surface', 4.5],
  ['primario come testo, sul fondo', '--primary-testo', '--bg', 4.5],
  ['primario come testo, sul suo velo', '--primary-testo', '--primary-soft', 4.5],
  ['bianco sul primario pieno', BIANCO, '--primary', 4.5],
  ['anello di fuoco sul fondo pagina', '--primary-testo', '--bg', 3],

  ['ottone come testo, sul suo velo', '--ottone-scuro', '--ottone-velo', 4.5],
  ['ottone come testo, su carta', '--ottone-scuro', '--surface', 4.5],
  ['errore sul suo velo', '--danger', '--danger-soft', 4.5],
  ['bianco sul bottone distruttivo', BIANCO, '--danger-pieno', 4.5],
  ['bianco sulla barra senza rete', BIANCO, '--danger-pieno', 4.5],
  ['conferma sul suo velo', '--ok-deep', '--ok-soft', 4.5],

  // Le sei tinte degli avatar (COLORI_AV in app.js): un cerchio con due lettere
  // dentro e' testo, e vale la soglia del testo.
  ['iniziali sull\'avatar primario', BIANCO, '--primary', 4.5],
  ['iniziali sull\'avatar verde', BIANCO, '--ok-pieno', 4.5],
  ['iniziali sull\'avatar grigio', BIANCO, 'oklch(0.50 0.03 258)', 4.5],
  ['iniziali sull\'avatar viola', BIANCO, 'oklch(0.55 0.14 300)', 4.5],
  ['iniziali sull\'avatar rosso', BIANCO, 'oklch(0.55 0.13 30)', 4.5],
  ['iniziali sull\'avatar azzurro', BIANCO, 'oklch(0.5 0.1 200)', 4.5],
  ['iniziali sull\'avatar ottone', 'oklch(0.28 0.05 70)', '--ottone', 4.5],

  ['bianco sul navy chiaro', BIANCO, '--navy-deep', 4.5],
  ['bianco sul navy scuro', BIANCO, '--navy-deeper', 4.5],
  ['ottone sul navy scuro', '--ottone', '--navy-deeper', 4.5],

  // Testi scritti a mano sui pannelli navy: non sono token, ma sono testo lo stesso.
  ['didascalia del cartello', 'oklch(0.79 0.02 258)', '--navy-deeper', 4.5],
  // Le voci della barra in alto stanno su un rilievo piu' chiaro della fascia
  // (`--navy-deep` dentro `--navy-deeper`): il fondo da verificare e' il rilievo,
  // non la fascia, altrimenti si misura un contrasto che nessuno guarda.
  ['voce spenta della barra in alto', 'oklch(0.78 0.02 258)', '--navy-deep', 4.5],
  ['nome nella scheda del profilo', 'oklch(0.93 0.01 258)', '--navy-deeper', 4.5],
  ['ruolo sotto il nome (barra in alto)', 'oklch(0.66 0.03 258)', '--navy-deeper', 4.5],
  ['sottotitolo dei riquadri scuri', 'oklch(0.72 0.03 258)', '--navy-deep', 4.5],
  ['legenda della ciambella', 'oklch(0.82 0.02 258)', '--navy-deep', 4.5],
  ['pastiglia sui riquadri scuri', 'oklch(0.78 0.02 258)', '--navy-deep', 4.5],
];

let bocciate = 0;
for (const [nomeTema, tema] of [['chiaro', chiaro], ['scuro', scuro]]) {
  console.log(`\n  tema ${nomeTema}`);
  for (const [etichetta, pp, fondo, soglia] of COPPIE) {
    const rgbFondo = steso(leggiOklch(tema[fondo] ?? fondo), [1, 1, 1]);
    const rgbPp = steso(
      pp === BIANCO ? BIANCO : leggiOklch(tema[pp] ?? pp),
      rgbFondo,
    );
    const r = rapporto(rgbPp, rgbFondo);
    const passa = r >= soglia;
    if (!passa) bocciate++;
    console.log(`  ${passa ? '  ok' : '  NO'}  ${r.toFixed(2).padStart(5)}:1  (min ${soglia})  ${etichetta}`);
  }
}

if (bocciate) {
  console.error(`\n  ${bocciate} coppie sotto soglia.\n`);
  process.exit(1);
}
console.log('\n  Tutte le coppie reggono la soglia AA.\n');
