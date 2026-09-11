// La geometria dell'auto, misurata invece che guardata
//
// Nasce per la fase 3 del restyling (C51, decisioni 6-7): l'auto va ridisegnata da
// capo, e le quattro regole che il ridisegno deve rispettare erano scritte in
// `docs/ROADMAP.md` e in nessun posto che le controllasse. Questo file le controlla.
//
// **Le prime tre valgono oggi, la quarta e' il debito della fase 3.** Per questo il
// test sta in `npm run auto` e non ancora in `npm run check`: la quarta e' rossa per
// costruzione — `.car-svg` e' larga al massimo 150px con un viewBox di 150, quindi
// un sedile e' al piu' 40 pixel veri e la regola ne chiede 44. Non e' una svista da
// aggirare alzando la soglia: e' la misura di quanto l'auto deve crescere. Quando la
// fase 3 la fa crescere, questa riga entra in `check` e ci resta.
//
// Si legge la geometria **dal modulo vero**, non da una copia: `mod/auto-svg.js` non
// tocca il DOM al caricamento, quindi in Node si importa senza finestra.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CAR_INSET, CAR_W, DRIVER_POS, SEAT_LAYOUTS, W_AVANTI } from '../mod/auto-svg.js';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');

// Come `drawSeat` disegna un sedile: la spalliera sopra, la seduta sotto. Il gruppo
// che si tocca e' l'unione dei due, e `pos.x` e' il **centro**, non il bordo.
function ingombro(pos) {
  const w = pos.w ?? W_AVANTI;
  return { x1: pos.x - w / 2, x2: pos.x + w / 2, y1: pos.y - 28, y2: pos.y + 27, w, h: 55 };
}

const sovrapposti = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

let bocciate = 0;
const esito = (ok, testo) => {
  if (!ok) bocciate++;
  console.log(`    ${ok ? 'ok ' : 'NO '} ${testo}`);
};

// --- 1. Nessuna sovrapposizione ------------------------------------------------
// Fra sedili, e fra ogni sedile e il posto di chi guida: due bersagli che si
// toccano sono un tocco che finisce sul posto sbagliato.
console.log('\n  — nessuna sovrapposizione —');
for (const posti of Object.keys(SEAT_LAYOUTS).map(Number)) {
  const tutti = [['guidatore', ingombro(DRIVER_POS)]]
    .concat(Object.entries(SEAT_LAYOUTS[posti]).map(([i, p]) => [`posto ${i}`, ingombro(p)]));
  let peggio = Infinity, colpa = '';
  for (let i = 0; i < tutti.length; i++) {
    for (let j = i + 1; j < tutti.length; j++) {
      const [na, a] = tutti[i], [nb, b] = tutti[j];
      if (sovrapposti(a, b)) { peggio = -1; colpa = `${na} e ${nb} si sovrappongono`; continue; }
      // Quanto spazio resta fra i due, sull'asse in cui sono vicini.
      const dx = Math.max(b.x1 - a.x2, a.x1 - b.x2);
      const dy = Math.max(b.y1 - a.y2, a.y1 - b.y2);
      const luce = Math.max(dx, dy);
      if (luce < peggio) { peggio = luce; colpa = `${na} / ${nb}`; }
    }
  }
  esito(peggio > 0, `auto da ${posti}: luce minima ${peggio}px (${colpa})`);
}

// --- 2. Tutto dentro la scocca -------------------------------------------------
// Il fianco dritto della sagoma sta a `CAR_INSET`, e specchiato dall'altra parte.
console.log('\n  — tutto dentro la scocca —');
for (const posti of Object.keys(SEAT_LAYOUTS).map(Number)) {
  const tutti = [DRIVER_POS, ...Object.values(SEAT_LAYOUTS[posti])].map(ingombro);
  const margine = Math.min(...tutti.map(s => Math.min(s.x1 - CAR_INSET, CAR_W - CAR_INSET - s.x2)));
  esito(margine >= 0, `auto da ${posti}: ${margine}px fra il sedile piu' esterno e il fianco`);
}
// L'abitacolo e' il riquadro che fa vedere i sedili dentro l'auto: sta piu' dentro
// del fianco, e un sedile che lo sfora si appoggia sul suo contorno.
const ABITACOLO_X = 22;
const dentroAbitacolo = Math.min(
  ...Object.values(SEAT_LAYOUTS).flatMap(l => [DRIVER_POS, ...Object.values(l)])
    .map(ingombro)
    .map(s => Math.min(s.x1 - ABITACOLO_X, CAR_W - ABITACOLO_X - s.x2)),
);
console.log(`    --  e ${dentroAbitacolo}px dal contorno dell'abitacolo (non e' una regola, e' una misura)`);

// --- 3. Il posto di chi guida non si prenota -----------------------------------
// Due prove, perche' una sola si aggira: il posto non compare fra quelli
// prenotabili, e la chiamata che lo disegna non chiede di poterlo toccare.
console.log('\n  — il posto di chi guida —');
const occupaGuidatore = Object.values(SEAT_LAYOUTS)
  .flatMap(l => Object.values(l))
  .some(p => sovrapposti(ingombro(p), ingombro(DRIVER_POS)));
esito(!occupaGuidatore, 'nessun posto prenotabile cade dove siede chi guida');
const scheda = readFileSync(join(RADICE, 'mod/scheda.js'), 'utf8');
const chiamata = scheda.match(/drawSeat\(svg, DRIVER_POS, \{[^}]*\}/s)?.[0] ?? '';
esito(chiamata !== '' && !chiamata.includes('clickable'), 'la chiamata che lo disegna non passa `clickable`');

// --- 4. Il bersaglio, alla larghezza piu' stretta ------------------------------
// La regola della fase 3: 44px veri a 360 di larghezza. Il viewBox non dice niente
// da solo — conta quanto e' larga `.car-svg` sullo schermo, che sta nel foglio.
console.log('\n  — il bersaglio a 360px di larghezza —');
const css = readFileSync(join(RADICE, 'style.css'), 'utf8');
const tetto = css.match(/\.car-svg\s*\{[^}]*width:\s*min\((\d+)px/)?.[1];
if (!tetto) {
  esito(false, 'in `style.css` non si legge la larghezza di `.car-svg`');
} else {
  const scala = Number(tetto) / CAR_W;
  const piuStretto = Math.min(
    ...Object.values(SEAT_LAYOUTS).flatMap(l => Object.values(l)).map(p => ingombro(p).w),
  );
  const bersaglio = piuStretto * scala;
  console.log(`    --  .car-svg al massimo ${tetto}px su un viewBox di ${CAR_W} -> scala ${scala}`);
  esito(bersaglio >= 44, `il sedile piu' stretto e' ${piuStretto} nel disegno, ${bersaglio}px veri (min 44)`);
}

console.log(bocciate === 0
  ? '\n  La geometria dell\'auto regge tutte le regole.\n'
  : `\n  ${bocciate} regole non reggono. Le prime tre sono regressioni; la quarta e' il debito della fase 3.\n`);
process.exit(bocciate === 0 ? 0 : 1);
