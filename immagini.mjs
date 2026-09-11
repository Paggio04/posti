// Le immagini che non si scrivono a mano: le quattro icone e l'anteprima
//
//     npm run immagini
//
// Erano l'ultimo pezzo di identita' rimasto alla palette viola. `icon.svg` era
// stato allineato in C53; questi cinque file no, perche' sono raster e da un
// foglio di stile non si ricolorano. Cioe': chi installava l'app si ritrovava
// sulla schermata home la tessera quasi nera con l'auto lavanda, e chi mandava il
// link in chat mandava un'anteprima di due palette fa.
//
// **Erano anche disegni diversi.** Nei PNG l'auto era piena, in `icon.svg` e' di
// contorno: due marchi, non uno. E l'auto dell'anteprima era quella vecchia, la
// capsula larga due terzi della sua lunghezza. Adesso tutti e cinque i file
// *vengono* da quello che c'e' nel repo — `icon.svg` e l'auto del cartello in
// `index.html` — quindi la domanda «quale dei due e' quello buono» non si pone
// piu', e il giorno in cui il marchio cambia si rilancia questo.
//
// Serve un rasterizzatore, e in casa ce n'e' gia' uno: il Chromium che Playwright
// usa per i test. Nessuna dipendenza nuova per cinque file che si rifanno una
// volta ogni tanto.

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RADICE = dirname(fileURLToPath(import.meta.url));
const sorgente = readFileSync(join(RADICE, 'icon.svg'), 'utf8');

// Dal marchio si prendono il fondo e il disegno separatamente: il fondo serve
// intero alle maskable, il disegno va rimpicciolito solo li'.
const FONDO = sorgente.match(/fill="(#[0-9A-Fa-f]{6})"/)?.[1];
const ARTE = sorgente.replace(/[\s\S]*?<rect[^>]*\/>/, '').replace('</svg>', '').trim();
if (!FONDO || !ARTE) throw new Error('icon.svg non ha piu\' la forma attesa: un <rect> di fondo e poi il disegno');

const browser = await chromium.launch();
const pagina = await browser.newPage({ deviceScaleFactor: 1 });

// ── Le quattro icone ─────────────────────────────────────────────────────
// Le **maskable** non sono le altre con un nome diverso. Android ritaglia l'icona
// nella forma che ha deciso il telefono — cerchio, goccia, quadrato stondato — e
// garantisce solo il cerchio dentro l'80% del lato. Quindi: niente angoli
// arrotondati (li mette il sistema, e i nostri finirebbero tagliati storti), fondo
// che arriva ai bordi, e disegno rimpicciolito dentro la zona sicura. 0,62 del
// lato lo tiene dentro con un margine anche negli angoli, che e' il punto in cui
// una zona sicura si perde.
const DENTRO = 0.62;
const fogliIcona = (n, maskable) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 100 100">
  <rect width="100" height="100"${maskable ? '' : ' rx="14"'} fill="${FONDO}"/>
  ${maskable ? `<g transform="translate(50 50) scale(${DENTRO}) translate(-50 -50)">${ARTE}</g>` : ARTE}
</svg>`;

for (const [nome, n, maskable] of [
  ['icona-192.png', 192, false],
  ['icona-512.png', 512, false],
  ['icona-maskable-192.png', 192, true],
  ['icona-maskable-512.png', 512, true],
]) {
  await pagina.setViewportSize({ width: n, height: n });
  await pagina.setContent(fogliIcona(n, maskable));
  // `omitBackground` tiene la trasparenza fuori dall'icona; dentro il fondo c'e'
  // ed e' opaco, che e' quello che un'icona deve essere.
  await pagina.locator('svg').screenshot({ path: join(RADICE, nome), omitBackground: true });
  console.log(`  ${nome}  ${n}x${n}${maskable ? '  · zona sicura ' + DENTRO * 100 + '%' : ''}`);
}

// ── L'anteprima del link ─────────────────────────────────────────────────
// 1200x630 e' la misura che chiedono tutti quelli che ritagliano: WhatsApp,
// Telegram, Facebook, X. E' la prima cosa che vede chi riceve il link, quindi non
// e' un dettaglio di rifinitura — e' la copertina.
//
// L'auto **non e' ridisegnata qui**: e' quella del cartello in `index.html`, presa
// dal file. Quella l'ha gia' allineata `tests/auto.mjs`, che confronta le sue
// cinque sedute con `SEAT_LAYOUTS`. Copiarla a mano vorrebbe dire avere una terza
// auto da tenere allineata, ed e' esattamente l'errore che questo file chiude.
//
// La pagina si scrive in un file temporaneo nella radice, e non si passa da
// `setContent`, perche' il foglio di stile e i caratteri sono riferimenti relativi
// e da `about:blank` non si risolvono.
const indice = readFileSync(join(RADICE, 'index.html'), 'utf8');
const auto = indice.slice(indice.indexOf('<svg class="car-svg"'), indice.indexOf('</svg>', indice.indexOf('<svg class="car-svg"')) + 6);
if (!auto.startsWith('<svg')) throw new Error('in index.html non si trova piu\' l\'auto del cartello');

// Il tema chiaro, dichiarato: il generatore gira dove capita, e un'anteprima che
// cambia colore a seconda di come e' impostato il computer di chi la rigenera non
// e' un'anteprima, e' un caso.
const anteprima = `<!doctype html>
<html lang="it" data-tema="chiaro"><head><meta charset="utf-8">
<link rel="stylesheet" href="style.css">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: 1200px; height: 630px; display: flex; align-items: center; gap: 72px;
    padding: 0 90px; box-sizing: border-box; background: var(--bg); color: var(--ink);
    font-family: var(--font-sans);
  }
  .car-piastra { flex: none; width: 320px; padding: 28px 34px; margin: 0; }
  .car-svg { width: 100%; }
  .dire { min-width: 0; }
  .dire .targa { font-size: 1.15rem; padding: 10px 16px; margin-bottom: 34px; }
  /* Fuori dalla dashboard la sagoma dentro la targa non ha una misura sua, e un
     SVG senza misura prende tutto lo spazio che trova: qui diventava alta come la
     targa e spingeva il nome fuori dal riquadro. */
  .dire .targa svg { width: 22px; height: 15px; }
  .dire h1 { font-size: 4.6rem; line-height: 1.02; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 26px; }
  .dire p { font-size: 1.6rem; line-height: 1.4; color: var(--ink-soft); margin: 0; max-width: 22ch; }
</style></head>
<body>
  <div class="car-piastra">${auto}</div>
  <div class="dire">
    <span class="targa">
      <svg viewBox="0 0 24 16" aria-hidden="true"><path d="M2 11h20v3H2z" fill="currentColor"/><path d="M4 11l2-5h12l2 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
      WeTransport
    </span>
    <h1>Chi guida oggi?</h1>
    <p>Chi guida pubblica la propria auto, gli altri prenotano il posto.</p>
  </div>
</body></html>`;

const temporaneo = join(RADICE, '.anteprima-tmp.html');
writeFileSync(temporaneo, anteprima, 'utf8');
try {
  await pagina.setViewportSize({ width: 1200, height: 630 });
  await pagina.goto(pathToFileURL(temporaneo).href);
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.screenshot({ path: join(RADICE, 'anteprima.png') });
  console.log('  anteprima.png  1200x630');
} finally {
  unlinkSync(temporaneo);
}

await browser.close();
console.log(`\nCinque immagini rifatte da icon.svg e da index.html, fondo del marchio ${FONDO}.`);
