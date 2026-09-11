// La geometria dell'auto, misurata invece che guardata
//
// Nasce per la fase 3 del restyling (C51, decisioni 6-7): l'auto va ridisegnata da
// capo, e le quattro regole che il ridisegno deve rispettare erano scritte in
// `docs/ROADMAP.md` e in nessun posto che le controllasse. Questo file le controlla.
//
// **Tre reggono, e la quarta regge per tre auto su sei.** Le poltrone sono state
// allargate a 44 prendendo il pavimento (fase 3); quello che resta rosso e' la
// **panchina da tre** delle auto da 4, 5 e 6, e non per una svista: fra i due
// fianchi ci sono 114 unita' e tre sedili da 44 ne vogliono 132. Mancano 18 unita'
// che non esistono, quindi quella fila sale solo se l'auto cresce — e allora cresce
// anche `.car-svg`. Finche' quella decisione non e' presa il test sta in
// `npm run auto` e non in `npm run check`: un `check` rosso per un lavoro che
// aspetta una decisione smette di voler dire qualcosa.
//
// Si legge la geometria **dal modulo vero**, non da una copia: `mod/auto-svg.js` non
// tocca il DOM al caricamento, quindi in Node si importa senza finestra.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CAR_INSET, CAR_W, DRIVER_POS, H_SEDUTA, H_SPALLIERA, PASSO_FILA, SEAT_LAYOUTS, W_AVANTI, Y_SEDUTA } from '../mod/auto-svg.js';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');

// Come `drawSeat` disegna un sedile: la spalliera sopra, la seduta sotto. Il gruppo
// che si tocca e' l'unione dei due, e `pos.x` e' il **centro**, non il bordo. Le
// altezze arrivano dal modulo: se lassu' cambia la seduta, qui cambia il bersaglio
// senza che nessuno debba ricordarselo.
function ingombro(pos) {
  const w = pos.w ?? W_AVANTI;
  const y1 = pos.y + Y_SEDUTA - H_SPALLIERA;
  const y2 = pos.y + Y_SEDUTA + H_SEDUTA;
  return { x1: pos.x - w / 2, x2: pos.x + w / 2, y1, y2, w, h: y2 - y1 };
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
//
// **Fila per fila, non un minimo solo.** Il minimo unico diceva «34» e faceva
// sembrare rotta tutta l'auto, mentre la fila che non ci arriva e' una: la panchina
// da tre delle auto da 4, 5 e 6. Cosi' si vede quale, e le altre non spariscono
// dentro la peggiore.
console.log('\n  — il bersaglio a 360px di larghezza —');
const css = readFileSync(join(RADICE, 'style.css'), 'utf8');
const tetto = css.match(/\.car-svg\s*\{[^}]*width:\s*min\((\d+)px/)?.[1];
if (!tetto) {
  esito(false, 'in `style.css` non si legge la larghezza di `.car-svg`');
} else {
  const scala = Number(tetto) / CAR_W;
  console.log(`    --  .car-svg al massimo ${tetto}px su un viewBox di ${CAR_W} -> scala ${scala}`);
  for (const posti of Object.keys(SEAT_LAYOUTS).map(Number)) {
    const sedili = Object.values(SEAT_LAYOUTS[posti]).map(ingombro);
    // Il lato corto del bersaglio: e' quello che decide se il dito ci sta.
    const corto = Math.min(...sedili.map((s) => Math.min(s.w, s.h)));
    esito(corto * scala >= 44, `auto da ${posti}: il bersaglio piu' piccolo e' ${corto * scala}px (min 44)`);
  }
}

// Il pavimento fra due file: e' da li' che viene l'altezza in piu' della seduta, e
// finirlo vorrebbe dire far toccare due bersagli. Misura, non regola — la regola che
// lo protegge e' la prima, che nessuna coppia si sovrapponga.
console.log(`\n    --  fra due file restano ${PASSO_FILA - (H_SPALLIERA + H_SEDUTA)} unita' di pavimento`
  + ` (passo ${PASSO_FILA}, ingombro ${H_SPALLIERA + H_SEDUTA})\n`);

// --- 5. Il cartello dell'accesso dice la stessa auto -------------------------
// In `index.html` l'auto del cartello e' **scritta a mano**, perche' quel riquadro
// sta in pagina anche senza JavaScript. E' una copia di `SEAT_LAYOUTS[4]`, e una
// copia diverge: allargando le poltrone nel modulo, il cartello sarebbe rimasto a
// 40 e le due auto si vedono nella stessa sessione. Qui si confrontano.
console.log('\n  — il cartello dell\'accesso —');
const html = readFileSync(join(RADICE, 'index.html'), 'utf8');
const cartello = html.slice(html.indexOf('<div class="auth-cartello">'));
const sedute = [...cartello.matchAll(
  /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*class="seat-base"/g,
)].map((m) => m.slice(1, 5).map(Number));

const attese = [DRIVER_POS, ...Object.values(SEAT_LAYOUTS[4])]
  .map((pos) => {
    const w = pos.w ?? W_AVANTI;
    return [pos.x - w / 2, pos.y + Y_SEDUTA, w, H_SEDUTA];
  })
  .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const trovate = [...sedute].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

esito(trovate.length === attese.length,
  `nel cartello ci sono ${trovate.length} sedute, l'auto da 4 ne ha ${attese.length}`);
if (trovate.length === attese.length) {
  const diverse = attese.filter((att, i) => att.some((n, k) => n !== trovate[i][k]));
  esito(diverse.length === 0, diverse.length === 0
    ? 'ogni seduta del cartello combacia col modulo'
    : `${diverse.length} sedute non combaciano: attesa ${JSON.stringify(diverse[0])}`);
}

console.log(bocciate === 0
  ? '\n  La geometria dell\'auto regge tutte le regole.\n'
  : `\n  ${bocciate} righe non reggono. Se non sono le tre auto con la panchina da tre,
  e' una regressione: quelle sono il debito dichiarato della fase 3.\n`);
process.exit(bocciate === 0 ? 0 : 1);
