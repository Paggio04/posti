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
// `--primary` e `--primary-testo` sono di nuovo **due nomi con lo stesso valore**,
// in tutti e due i temi: con le palette di C53 il tocco fa entrambi i mestieri senza
// cambiare colore. I due token restano separati perche' il giorno in cui la carta si
// scurisce si cambia una riga sola invece di rincorrere ogni uso; le coppie qui sotto
// li controllano comunque tutti e due, che e' quello che li tiene onesti.

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

  ['il tocco come testo, su carta', '--primary-testo', '--surface', 4.5],
  ['il tocco come testo, sul fondo', '--primary-testo', '--bg', 4.5],
  ['il tocco come testo, sul suo velo', '--primary-testo', '--primary-soft', 4.5],
  ['il tocco come testo, sul rilievo', '--primary-testo', '--rilievo', 4.5],
  ['quasi-bianco sul tocco pieno', '--su-primario', '--primary', 4.5],
  ['quasi-bianco sul tocco premuto', '--su-primario', '--primary-hover', 4.5],
  // La riga di servizio dentro un riquadro pieno del tocco: e' testo piccolo, quindi
  // 4.5 anche se e' un sottotitolo. Stava scritta a mano nel foglio e non era qui.
  ['riga tenue sul tocco pieno', '--su-primario-tenue', '--primary', 4.5],
  ['anello di fuoco sul fondo pagina', '--primary-testo', '--bg', 3],
  ['contorno del tocco, sulla carta', '--primary-bordo', '--surface', 3],

  // «Questo e' tuo»: riempimento pieno col quasi-bianco sopra, e il contorno intorno.
  ['quasi-bianco su cio\' che e\' tuo', '--tuo-su', '--tuo', 4.5],
  // Sopra l'arancio la riga di servizio non e' quella del blu: i due riempimenti
  // hanno luminosita' opposte, quindi due token. Vale la soglia del testo.
  ['riga tenue su cio\' che e\' tuo', '--tuo-su-tenue', '--tuo', 4.5],
  ['cio\' che e\' tuo, come testo su carta', '--tuo-testo', '--surface', 4.5],
  ['cio\' che e\' tuo, come testo sul suo velo', '--tuo-testo', '--tuo-velo', 4.5],
  ['contorno di cio\' che e\' tuo, sulla carta', '--tuo-bordo', '--surface', 3],

  ['errore sul suo velo', '--danger', '--danger-soft', 4.5],
  // Il bordo di un pannello di stato dice dove finisce l'avviso: porta
  // informazione, quindi 1.4.11 e soglia 3. Erano scritti a mano nel foglio.
  ['errore su carta', '--danger', '--surface', 4.5],
  ['bianco sul bottone distruttivo', BIANCO, '--danger-pieno', 4.5],
  ['bianco sulla barra senza rete', BIANCO, '--danger-pieno', 4.5],
  ['conferma sul suo velo', '--ok', '--ok-soft', 4.5],
  ['conferma su carta', '--ok', '--surface', 4.5],

  // Le sei tinte degli avatar (COLORI_AV in mod/storico.js): un cerchio con due
  // lettere dentro e' testo, e vale la soglia del testo. Sono sei perche' servono
  // a distinguere sei persone, e girano intorno al blu della palette cambiando
  // **tinta** prima che luminosita'.
  //
  // Due cose le tengono separate dal resto del foglio, e sono decisioni, non
  // taratura. L'arancio non e' fra loro: qui l'arancio vuol dire «tuo», e un
  // avatar arancione direbbe che quella persona sei tu. E le lettere sopra sono
  // **sempre bianche**, non `--su-primario`: quello al buio diventa il blu,
  // perche' li' il riempimento interattivo e' chiaro — ma questi sei riempimenti
  // sono di mezzo tono in tutti e due i temi, e il bianco e' l'unico inchiostro
  // che ci regge sopra.
  ['iniziali sull\'avatar 1', 'oklch(0.999 0 0)', 'oklch(0.470 0.090 263)', 4.5],
  ['iniziali sull\'avatar 2', 'oklch(0.999 0 0)', 'oklch(0.440 0.070 226)', 4.5],
  ['iniziali sull\'avatar 3', 'oklch(0.999 0 0)', 'oklch(0.455 0.075 301)', 4.5],
  ['iniziali sull\'avatar 4', 'oklch(0.999 0 0)', 'oklch(0.425 0.065 196)', 4.5],
  ['iniziali sull\'avatar 5', 'oklch(0.999 0 0)', 'oklch(0.480 0.085 281)', 4.5],
  ['iniziali sull\'avatar 6', 'oklch(0.999 0 0)', 'oklch(0.410 0.060 216)', 4.5],
  ['iniziali sull\'avatar tuo', '--tuo-su', '--tuo', 4.5],

  // La pastiglia della seconda tessera. Dentro c'e' un'icona, non del testo:
  // vale la 1.4.11 e la soglia e' 3, sia contro il suo velo sia contro la carta
  // — perche' il velo e' cosi' tenue (1,20:1 sulla carta alla luce) che a
  // distinguere la pastiglia dallo sfondo ci pensa il disegno dentro, non il
  // riempimento.
  ['icona della seconda tessera, sul suo velo', '--tessera-2-ico', '--tessera-2-velo', 3],
  ['icona della seconda tessera, sulla carta', '--tessera-2-ico', '--surface', 3],

  // Le barre nelle righe dei conti: una forma che porta informazione, quindi 3
  // contro la sua pista. Non sono l'unico segno del verso — l'importo lo dice in
  // parola e in colore — ma **quanto pesa** un conto lo dice solo la barra.
  ['barra di un conto in dare, sulla sua pista', '--danger', '--surface-2', 3],
  ['barra di un conto in avere, sulla sua pista', '--ok', '--surface-2', 3],
  ['barra di un conto, sulla sua pista', '--ink-soft', '--surface-2', 3],

  // L'auto. La scocca e' un elemento non testuale che porta informazione — se non
  // si vede, non si vede che c'e' un'auto — quindi vale la 1.4.11 e la soglia e'
  // 3:1, su **tutti e due** i fondi su cui l'auto compare: il pannello
  // dell'accesso e la scheda di un passaggio. E' la coppia che avrebbe fermato le
  // prime due stesure: scocca riempita di `--surface` faceva 1,42:1.
  // **L'auto ha una piastra in tutti e due i temi, e prima no.** Al buio era
  // trasparente, quindi la lamiera doveva essere chiara per staccare dalla pagina
  // — e una lamiera chiara nasconde il posto arancione, che per vedersi vuole un
  // fondo sotto L 0.484. Con la palette nuova l'auto e' un oggetto stampato con la
  // sua carta chiara: lamiera scura, posti chiari scavati dentro, il posto tuo
  // arancione. Un fondo solo, misurato in tutti e due i temi.
  ['scocca dell\'auto, sulla sua piastra', '--scocca', '--piastra', 3],
  ['il vuoto di un posto, sulla scocca', '--posto', '--scocca', 3],
  // Il posto **tuo**, e perche' qui la coppia e' una per tema invece di una sola.
  // Non e' una soglia ammorbidita: e' che con l'arancio #F58F20 non esiste una
  // lamiera che vada bene a tutti. L'arancio ha luminanza 0,402, quindi per
  // staccare 3:1 vuole una lamiera sotto 0,098; un dettaglio scuro su una lamiera
  // blu non puo' superare (luminanza + 0,05) / 0,05, quindi la gomma la pretende
  // sopra 0,1025. Le due richieste non si incontrano, per il 4%: si e' scelta la
  // lamiera che serve alla gomma, e al buio il posto arancione lo delimita il suo
  // contorno — che nel disegno c'era gia', 2,5px su `.seat-mine`.
  // Alla luce non serve: li' «tuo» e' il blu-grigio e il riempimento ce la fa.
  ['il posto tuo, sulla scocca', '--tuo', '--scocca', 3, 'chiaro'],
  ['contorno del posto tuo, sulla scocca', '--posto-tuo-filo', '--scocca', 3, 'scuro'],
  ['contorno di un posto, sul suo vuoto', '--posto-bordo', '--posto', 3],
  ['contorno di un posto libero, sul suo vuoto', '--posto-libero', '--posto', 3],
  ['iniziali dentro un posto', '--posto-testo', '--posto', 4.5],
  ['iniziali dentro il posto tuo', '--tuo-su', '--tuo', 4.5],
  ['gomma sulla scocca', '--gomma', '--scocca', 3],

  // Il benvenuto e' l'unico riquadro dove il tocco prende tutta la superficie: il
  // bottone dentro e' il verso rovesciato, chiaro pieno col tocco scritto sopra.
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
