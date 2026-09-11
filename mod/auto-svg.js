// La macchina disegnata: sagoma, sedili, iniziali
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

// --- Macchina SVG ---
//
// **Le proporzioni sono quelle di un'auto, e prima non lo erano.** La scocca era
// un rettangolo 170x230 con gli spigoli arrotondati a 46: cioe' larga quanto due
// terzi della sua lunghezza (un'auto vera sta a uno a due e mezzo) e con le due
// estremita' quasi semicircolari. Vista dall'alto non era un'auto, era una
// capsula. E dentro quella larghezza tre sedili da 44 in fila si toccavano.
//
// Adesso il rapporto e' 114 di larghezza per 282 di lunghezza — **1 : 2,47**, che
// e' quello di un'utilitaria vera (1,75 m per 4,3 m) — la sagoma e' un tracciato
// con il muso che si stringe e la coda che si chiude, e i sedili sono piu' stretti
// e piu' alti, come sono i sedili. Quelli di dietro sono piu' stretti di quelli
// davanti perche' e' cosi' anche in macchina: dietro e' una panchina divisa in
// tre, davanti sono due poltrone.
//
// Le file sono equidistanti: 122, 210, 298, cioe' 88 di passo, e fra il fondo di
// una fila e la cima della successiva restano 33px di pavimento.
const PASSO_FILA = 88;
const ROW_FRONT = 122, ROW_BACK = ROW_FRONT + PASSO_FILA, ROW_THIRD = ROW_BACK + PASSO_FILA;

// La geometria della scocca. Tutto quello che sta a destra si RICAVA da quello che
// sta a sinistra: scrivere le due coordinate a mano e' esattamente il modo in cui
// le ruote sono finite fuori di 4px, con quelle di sinistra tagliate dal bordo.
const CAR_W = 150;                          // larghezza del viewBox
const CAR_INSET = 18;                       // margine della scocca dal viewBox
const CAR_MID = CAR_W / 2;
const specchia = (x, w) => CAR_W - x - w;   // riflette un rettangolo sull'asse
// Larghezza di un sedile: poltrona davanti, posto di panchina dietro.
//
// **44 e' la misura del dito, non un numero scelto.** `.car-svg` e' larga al massimo
// 150px su un viewBox di 150, quindi la scala non supera mai 1 e una unita' del
// disegno **e' un pixel vero**: un sedile da 40 e' un bersaglio da 40, sotto la
// soglia. Le poltrone salgono quindi a 44, e lo spazio lo prendono dal pavimento
// (`tests/auto.mjs` misura che ne resti).
//
// **La panchina da tre, invece, non ci arriva e non e' una scelta.** Fra i due
// fianchi ci sono 114 unita'; tre sedili da 44 ne vogliono 132, cioe' 18 in piu' di
// quante esistano — anche appiccicandoli, anche senza margine. Il massimo fisico di
// quella fila e' 38 con zero luce fra i sedili, 36 con la luce che serve a non
// sbagliare tocco: due pixel guadagnati spendendo tutto il margine dal fianco. Non
// li vale, e restano 34. Per portare anche quella fila a 44 l'auto deve crescere,
// e allora cresce anche `.car-svg` — che e' una decisione, non una rifinitura.
const W_AVANTI = 44, W_DIETRO = 34;

// Le poltrone stanno dove stavano, spostate di un'unita' per restare simmetriche
// adesso che sono piu' larghe: 30 unita' a destra e a sinistra della mezzeria,
// cioe' 5 di margine dal fianco e 16 di luce fra le due. La coppia di dietro delle
// auto da 3 (e la terza fila di quelle da 6) sta piu' raccolta, 27 dalla mezzeria:
// e' una panchina divisa in due, non due poltrone.
const X_POLTRONA = 30, X_PANCHETTA = 27;
const AV_SX = CAR_MID - X_POLTRONA, AV_DX = CAR_MID + X_POLTRONA;
const PAN_SX = CAR_MID - X_PANCHETTA, PAN_DX = CAR_MID + X_PANCHETTA;

const DRIVER_POS = { x: AV_SX, y: ROW_FRONT, w: W_AVANTI };
const SEAT_LAYOUTS = {
  1: { 1: { x: AV_DX, y: ROW_FRONT, w: W_AVANTI } },
  2: { 1: { x: AV_DX, y: ROW_FRONT, w: W_AVANTI }, 4: { x: CAR_MID, y: ROW_BACK, w: W_AVANTI } },
  3: { 1: { x: AV_DX, y: ROW_FRONT, w: W_AVANTI }, 2: { x: PAN_SX, y: ROW_BACK, w: W_AVANTI }, 4: { x: PAN_DX, y: ROW_BACK, w: W_AVANTI } },
  4: { 1: { x: AV_DX, y: ROW_FRONT, w: W_AVANTI }, 2: { x: 38, y: ROW_BACK, w: W_DIETRO }, 3: { x: CAR_MID, y: ROW_BACK, w: W_DIETRO }, 4: { x: 112, y: ROW_BACK, w: W_DIETRO } },
  5: { 1: { x: AV_DX, y: ROW_FRONT, w: W_AVANTI }, 2: { x: 38, y: ROW_BACK, w: W_DIETRO }, 3: { x: CAR_MID, y: ROW_BACK, w: W_DIETRO }, 4: { x: 112, y: ROW_BACK, w: W_DIETRO }, 6: { x: CAR_MID, y: ROW_THIRD, w: W_AVANTI } },
  6: { 1: { x: AV_DX, y: ROW_FRONT, w: W_AVANTI }, 2: { x: 38, y: ROW_BACK, w: W_DIETRO }, 3: { x: CAR_MID, y: ROW_BACK, w: W_DIETRO }, 4: { x: 112, y: ROW_BACK, w: W_DIETRO }, 5: { x: PAN_SX, y: ROW_THIRD, w: W_AVANTI }, 6: { x: PAN_DX, y: ROW_THIRD, w: W_AVANTI } },
};

// L'ingombro verticale di un sedile, e **qui sta il pavimento che si prende**: la
// seduta passa da 42 a 50, cosi' un sedile da 44 resta piu' alto che largo. Era la
// ragione per cui erano 34-40 e non 44 per 40 — «tre quadrati in fila si leggono
// come una griglia invece che come una panchina» — e allargando senza alzare quella
// ragione tornava valida. Fra due file il passo e' 88, l'ingombro 63: restano 25
// unita' di pavimento, erano 33.
//
// Sono costanti e non numeri scritti dentro al disegno perche' le legge anche
// `tests/auto.mjs`, che senza di loro dovrebbe ricopiarsele.
const H_SPALLIERA = 13;   // lo schienale, sopra la seduta
const H_SEDUTA = 50;      // il cuscino
const Y_SEDUTA = -15;     // dove comincia la seduta, rispetto al centro del posto

// La sagoma, ricavata dall'altezza. Un `path` e non un `rect` con il raggio
// grande, perche' e' il raggio grande a fare la capsula — e nessun valore di `rx`
// fa un muso.
//
// **Il muso e' schiacciato, non a punta**: fra x=56 e x=94 la linea in cima e'
// dritta, cioe' 38px di frontale piatto dove stanno i fari. Un'auto vista
// dall'alto ha un frontale, non una prua; con il muso appuntito la sagoma
// tornava a somigliare a una capsula pur avendo le proporzioni giuste.
function sagomaAuto(H) {
  return `M 56 10
    C 40 12 30 26 25 48 C 20 68 ${CAR_INSET} 88 ${CAR_INSET} 108
    L ${CAR_INSET} ${H - 100}
    C ${CAR_INSET} ${H - 70} 20 ${H - 40} 26 ${H - 24}
    C 31 ${H - 12} 42 ${H - 6} 60 ${H - 5}
    L 90 ${H - 5}
    C 108 ${H - 6} 119 ${H - 12} 124 ${H - 24}
    C 130 ${H - 40} 132 ${H - 70} 132 ${H - 100}
    L 132 108
    C 132 88 130 68 125 48 C 120 26 110 12 94 10 Z`;
}

// ── Le finiture della carrozzeria ──────────────────────────────────────────
// Passaruota, battistrada, fari, linee delle porte, pieghe dei fianchi. Prese
// dal riferimento che mi e' stato dato — che pero' e' un'auto **di profilo**, e
// di profilo un sedile non si puo' toccare: qui la vista resta dall'alto e di
// quel disegno si prende il vocabolario, non l'inquadratura. Stessa ragione per
// cui i fari sono viola e non ciano al neon: i colori dell'app sono quelli della
// palette, e nessuno di piu'.
//
// Tutto quello che sta a destra si ricava da quello che sta a sinistra.
function finitureAuto(svg, H, righe) {
  // **Le ruote entrano nella scocca di tre pixel.** Tangenti al fianco — com'erano
  // — si leggevano come quattro pastiglie appoggiate accanto all'auto invece che
  // come ruote dentro il loro passaruota. Tre pixel bastano, e sono la differenza
  // fra un mezzo e un disegno di un mezzo.
  const RUOTA_W = 13, RUOTA_H = 46, RUOTA_X = 8, RUOTA_DAL_BORDO = 54;
  const ruoteY = [RUOTA_DAL_BORDO, H - RUOTA_DAL_BORDO - RUOTA_H];

  // Il passaruota: l'arco che chiude la ruota sopra e sotto. Un riempimento non
  // si vedrebbe (il fondo della scheda e' gia' l'onyx), quindi e' un contorno.
  for (const ry of ruoteY) {
    for (const ax of [RUOTA_X - 3, specchia(RUOTA_X - 3, RUOTA_W + 6)]) {
      svg.appendChild(svgEl('rect', {
        x: ax, y: ry - 4, width: RUOTA_W + 6, height: RUOTA_H + 8, rx: 9, class: 'car-passaruota',
      }));
    }
  }
  for (const ry of ruoteY) {
    for (const rx of [RUOTA_X, specchia(RUOTA_X, RUOTA_W)]) {
      svg.appendChild(svgEl('rect', { x: rx, y: ry, width: RUOTA_W, height: RUOTA_H, rx: 6, class: 'car-wheel' }));
      // Il battistrada: tre solchi. E' quello che distingue una ruota da una
      // pastiglia grigia, e a questa scala e' l'unico dettaglio che si vede.
      for (const d of [12, 23, 34]) {
        svg.appendChild(svgEl('path', {
          d: `M ${rx + 2} ${ry + d} L ${rx + RUOTA_W - 2} ${ry + d}`, class: 'car-battistrada',
        }));
      }
    }
  }

  // I paraurti: la fascia piu' scura all'estremita'. Senza, muso e coda sono due
  // superfici chiare e vuote, e l'auto sembra un guscio invece di un mezzo.
  svg.appendChild(svgEl('rect', { x: 40, y: 12, width: 70, height: 22, rx: 11, class: 'car-paraurti' }));
  svg.appendChild(svgEl('rect', { x: 36, y: H - 34, width: 78, height: 24, rx: 12, class: 'car-paraurti' }));

  // Cofano e baule: la riga dove la lamiera piatta finisce e comincia il vetro.
  // Sono le due che dividono l'auto nelle sue tre parti — muso, abitacolo, coda —
  // e senza di loro il muso e' solo spazio vuoto sopra il parabrezza.
  svg.appendChild(svgEl('path', { d: 'M 30 60 Q 75 54 120 60', class: 'car-cofano' }));
  svg.appendChild(svgEl('path', { d: `M 32 ${H - 68} Q 75 ${H - 62} 118 ${H - 68}`, class: 'car-cofano' }));

  // I fari: incassati nel frontale, non appoggiati sopra. E' l'unico punto in cui
  // la carrozzeria porta il colore dell'app: dicono da che parte guarda l'auto,
  // cioe' dove sta chi guida, cioe' da dove si comincia a leggere.
  for (const fx of [36, specchia(36, 20)]) {
    svg.appendChild(svgEl('rect', { x: fx, y: 22, width: 20, height: 8, rx: 3, class: 'car-faro' }));
  }
  // La presa d'aria fra i due fari: una riga, e il muso ha una faccia.
  svg.appendChild(svgEl('path', { d: 'M 62 26 L 88 26', class: 'car-griglia' }));
  // I fanali dietro: contorno e basta. Pieni sarebbero il rosso dell'errore su
  // una cosa che non e' un errore.
  for (const fx of [34, specchia(34, 22)]) {
    svg.appendChild(svgEl('rect', { x: fx, y: H - 28, width: 22, height: 8, rx: 3, class: 'car-fanale' }));
  }

  // Le porte, e sono la ragione per cui una scocca vista dall'alto si legge come
  // una scocca: una riga corta sul fianco all'altezza di ogni fila.
  const porte = [ROW_FRONT - 22, ROW_BACK - 22];
  if (righe > 2) porte.push(ROW_THIRD - 22);
  for (const py of porte) {
    svg.appendChild(svgEl('path', { d: `M ${CAR_INSET} ${py} L ${CAR_INSET + 13} ${py}`, class: 'car-porta' }));
    svg.appendChild(svgEl('path', { d: `M ${CAR_W - CAR_INSET - 13} ${py} L ${CAR_W - CAR_INSET} ${py}`, class: 'car-porta' }));
  }

  // Il vano dell'abitacolo: dove il tetto e' tagliato via per far vedere i sedili.
  // Senza questo contorno, muso, abitacolo e coda sono la stessa superficie nera e
  // i sedili sembrano appoggiati sopra la lamiera invece che dentro l'auto.
  svg.appendChild(svgEl('rect', {
    x: 22, y: 62, width: CAR_W - 44, height: H - 62 - 46, rx: 16, class: 'car-abitacolo',
  }));

  // Le due pieghe dei fianchi: danno spessore alla lamiera, come la `body-line`
  // del riferimento.
  const y1 = ROW_FRONT - 30, y2 = H - 76;
  for (const px of [25, CAR_W - 25]) {
    svg.appendChild(svgEl('path', { d: `M ${px} ${y1} L ${px} ${y2}`, class: 'car-piega-scocca' }));
  }

  // Gli specchietti, alla stessa altezza del parabrezza.
  const SPECCHIO_W = 16;
  for (const mx of [0, specchia(0, SPECCHIO_W)]) {
    svg.appendChild(svgEl('rect', { x: mx, y: 70, width: SPECCHIO_W, height: 6, rx: 3, class: 'car-wheel' }));
  }
}

function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export {
  CAR_INSET,
  CAR_MID,
  CAR_W,
  DRIVER_POS,
  H_SEDUTA,
  H_SPALLIERA,
  PASSO_FILA,
  SEAT_LAYOUTS,
  W_AVANTI,
  Y_SEDUTA,
  finitureAuto,
  initials,
  sagomaAuto,
  svgEl,
};
