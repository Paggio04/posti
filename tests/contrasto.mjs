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
// **Due temi, e li misura tutti e due.** Da quando c'e' l'interruttore le stesure
// sono due — `:root` e' quella chiara, `:root[data-tema="scuro"]` ridefinisce solo
// cio' che cambia — e un controllo che ne guardasse una sola direbbe che l'app e'
// a posto conoscendone meta'. Ogni coppia qui sotto gira due volte, e il nome del
// tema compare accanto al rapporto: se ne cede una si vede subito quale.
//
// E' questo file la risposta al costo che D10 temeva («due palette sono due cose da
// mantenere»): il costo resta, ma non lo paga chi legge il foglio sperando bene.
//
// Con il viola della palette `--primary` e `--primary-testo` sono tornati a essere
// **due colori diversi**, non due nomi per uno. Il candy blue era chiaro e faceva
// entrambi i mestieri con lo stesso valore; il viola e' scuro (L 0.53), quindi si
// riempie col quasi-bianco sopra ma come testo sul fondo farebbe 2.4:1. La coppia
// che l'ha imposto sta qui sotto ed e' l'unica ragione per cui i due token esistono.

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

// Ritaglia il corpo di una regola contando le graffe: qui serve solo per `:root`,
// ma non sa niente di `:root` — se domani i token si spostano, si passa un altro
// selettore e basta.
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

// Il tema scuro non riscrive tutto: quello che non nomina lo eredita dal chiaro,
// esattamente come fa il browser. Va steso qui sopra o il controllo misurerebbe
// dei buchi al posto dei token ereditati.
const chiaro = token(blocco(':root'));
const TEMI = {
  chiaro,
  scuro: { ...chiaro, ...token(blocco(':root[data-tema="scuro"]')) },
};
const BIANCO = [1, 1, 1, 1];

// --- le coppie che devono reggere ----------------------------------------------

// [etichetta, primo piano, fondo, soglia, tema?]
// Il primo piano e' un token (`--ink`), un colore scritto (`oklch(...)`) o BIANCO.
// La soglia e' 4.5 per il testo normale, 3 per il testo grande e per le forme che
// portano informazione senza essere testo (bordi, tracciati, anelli di fuoco).
//
// Il quinto campo dice **in quale tema** vale la coppia, e serve solo dove la cosa
// misurata cambia davvero di posto fra i due — cioe' l'auto, che alla luce sta su
// una piastra scura e al buio direttamente sulla pagina. Senza quel campo si
// misurerebbe la piastra anche al buio, dove e' trasparente: un numero verde su
// una cosa che non c'e'.
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

  // La targa del marchio: e' l'unico oggetto che si **ribalta** con il tema
  // invece di seguirlo — inchiostro con le lettere chiare alla luce, il contrario
  // al buio — e per questo va misurata nei due temi come tutto il resto: e'
  // proprio nei ribaltamenti che una coppia cede senza che nessuno lo veda.
  ['lettere sulla targa del marchio', '--su-targa', '--targa', 4.5],
  ['la targa contro il fondo pagina', '--targa', '--bg', 3],

  ['viola come testo, su carta', '--primary-testo', '--surface', 4.5],
  ['viola come testo, sul fondo', '--primary-testo', '--bg', 4.5],
  ['viola come testo, sul suo velo', '--primary-testo', '--primary-soft', 4.5],
  ['viola come testo, sul rilievo', '--primary-testo', '--rilievo', 4.5],
  ['quasi-bianco sul viola pieno', '--su-primario', '--primary', 4.5],
  ['quasi-bianco sul viola premuto', '--su-primario', '--primary-hover', 4.5],
  // La riga di servizio dentro un riquadro pieno di viola: e' testo piccolo, quindi
  // 4.5 anche se e' un sottotitolo. Stava scritta a mano nel foglio e non era qui.
  ['riga tenue sul viola pieno', '--su-primario-tenue', '--primary', 4.5],
  ['anello di fuoco sul fondo pagina', '--primary-testo', '--bg', 3],
  ['contorno del viola, sulla carta', '--primary-bordo', '--surface', 3],

  // «Questo e' tuo»: viola pieno con il quasi-bianco sopra, e il contorno intorno.
  ['quasi-bianco su cio\' che e\' tuo', '--tuo-su', '--tuo', 4.5],
  ['riga tenue su cio\' che e\' tuo', '--su-primario-tenue', '--tuo', 4.5],
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
  // distinguere sei persone, ma stanno tutte nella famiglia del viola e portano
  // tutte il quasi-bianco sopra: cambiano di tinta prima che di luminosita'.
  ['iniziali sull\'avatar 1', '--su-primario', 'oklch(0.50 0.200 300)', 4.5],
  ['iniziali sull\'avatar 2', '--su-primario', 'oklch(0.46 0.165 285)', 4.5],
  ['iniziali sull\'avatar 3', '--su-primario', 'oklch(0.54 0.215 312)', 4.5],
  ['iniziali sull\'avatar 4', '--su-primario', 'oklch(0.44 0.140 272)', 4.5],
  ['iniziali sull\'avatar 5', '--su-primario', 'oklch(0.52 0.155 328)', 4.5],
  ['iniziali sull\'avatar 6', '--su-primario', 'oklch(0.48 0.105 262)', 4.5],
  ['iniziali sull\'avatar tuo', '--tuo-su', '--tuo', 4.5],

  // L'auto. La scocca e' un elemento non testuale che porta informazione — se non
  // si vede, non si vede che c'e' un'auto — quindi vale la 1.4.11 e la soglia e'
  // 3:1, su **tutti e due** i fondi su cui l'auto compare: il pannello
  // dell'accesso e la scheda di un passaggio. E' la coppia che avrebbe fermato le
  // prime due stesure: scocca riempita di `--surface` faceva 1,42:1.
  // Alla luce l'auto sta sulla piastra, e la piastra e' l'unico fondo che ha.
  ['scocca dell\'auto, sulla sua piastra', '--scocca', '--piastra', 3, 'chiaro'],
  // Al buio la piastra e' trasparente, quindi sotto l'auto c'e' quello che c'era
  // prima: la pagina, o la scheda del passaggio. Sono due fondi e vanno misurati
  // tutti e due — e' la coppia che avrebbe fermato le prime due stesure di C40.
  ['scocca dell\'auto, sul fondo pagina', '--scocca', '--bg', 3, 'scuro'],
  ['scocca dell\'auto, sulla scheda del passaggio', '--scocca', '--surface', 3, 'scuro'],
  ['il vuoto di un posto, sulla scocca', '--posto', '--scocca', 3],
  ['il posto tuo, sulla scocca', '--tuo', '--scocca', 3],
  ['contorno di un posto, sul suo vuoto', '--posto-bordo', '--posto', 3],
  ['contorno di un posto libero, sul suo vuoto', '--posto-libero', '--posto', 3],
  ['iniziali dentro un posto', '--posto-testo', '--posto', 4.5],
  ['iniziali dentro il posto tuo', '--tuo-su', '--tuo', 4.5],
  ['gomma sulla scocca', '--gomma', '--scocca', 3],

  // Il benvenuto e' l'unico riquadro dove il viola prende tutta la superficie: il
  // bottone dentro e' il verso rovesciato, chiaro pieno con il viola scritto sopra.
  ['bottone chiaro dentro il benvenuto', '--primary', '--su-primario', 4.5],

];

let bocciate = 0;
for (const [nomeTema, tema] of Object.entries(TEMI)) {
  console.log(`\n  — tema ${nomeTema} —`);
  // Il fondo su cui si stende un colore semitrasparente e' il fondo pagina di
  // **quel** tema: la stessa velatura sopra la carta chiara e sopra il buio non
  // da' lo stesso colore, ed e' il genere di cosa che a occhio non si vede.
  const sotto = leggiOklch(tema['--bg']).slice(0, 3);
  for (const [etichetta, pp, fondo, soglia, soloTema] of COPPIE) {
    if (soloTema && soloTema !== nomeTema) continue;
    const rgbFondo = steso(leggiOklch(tema[fondo] ?? fondo), sotto);
    const rgbPp = steso(pp === BIANCO ? BIANCO : leggiOklch(tema[pp] ?? pp), rgbFondo);
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
console.log('\n  Tutte le coppie reggono la soglia AA nei due temi.\n');
