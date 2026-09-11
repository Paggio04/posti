// La scheda di un passaggio: sedili, ritrovo, calendario, commenti
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

import { CAR_MID, CAR_W, DRIVER_POS, H_SEDUTA, H_SPALLIERA, PASSO_FILA, SEAT_LAYOUTS, W_AVANTI, Y_SEDUTA, finitureAuto, initials, sagomaAuto, svgEl } from './auto-svg.js';
import { ask, condividi, conferma } from './dialogo.js';
import { notifichePossibili } from './notifiche.js';
import { addDaysISO, currentDate, currentGroupId, currentUser, emptyMessage, friendlyError, hasDeparted, isAdmin, isPastDay, mioPosto, nomeDi, nomeOccupante, oraPiu, ridesList, sospeso, toast, todayISO } from './nucleo.js';
import { clearMyRequest, gemelloDi, loadRides, setPassaggiVisibili } from './passaggi.js';
import { bloccaSeSospeso, bottonePersona } from './persone.js';
import { DAY_FMT } from './storico.js';
import { SITE_URL, supabase } from './supabase.js';
import { descriviAuto } from './zona.js';

// --- Navigazione al ritrovo (cantiere C14, decisione D6) ---
// Le coordinate della partenza esistono da C9, ma il link continuava a cercare il testo
// libero: "piazza" trova la piazza sbagliata, e il ritrovo si sposta di un chilometro.
// Con origin_lat/origin_lon il punto e' quello vero, e il link apre il percorso invece
// della sola ricerca. Nessun servizio nuovo: e' un indirizzo di Maps, non un SDK.
//
// **Non a tutti lo stesso link, pero'.** La policy di 014 e' di riga, non di colonna: chi
// vede un passaggio 'zona' o 'pubblico' riceve la riga intera, coordinate comprese, e il
// punto di partenza di una persona puo' essere casa sua al metro. Dentro la comitiva (o
// avendo un posto sopra quell'auto) il punto esatto e' esattamente quello che serve; da
// fuori resta la ricerca sul nome del luogo, che dice la zona e non l'indirizzo.
// Restringere anche il payload e' un cantiere a parte, ed e' scritto in ROADMAP: qui si
// smette di *offrire* l'indirizzo con un click, non si finge che il dato non arrivi.
// Chi vede il punto esatto di partenza e chi no. Una decisione sola, in un posto solo: la
// usano sia il link di navigazione sia il file del calendario, e se cambia idea cambia qui.
// Da C21 la domanda non si fa piu' qui: le coordinate arrivano **solo** se il database ha
// deciso che si possono avere (`coordinate_passaggi`), quindi averle in mano *e'* il
// permesso. Prima questa funzione decideva sul group_id della comitiva aperta in quel
// momento, cioe' rispondeva a una domanda diversa da quella del server; ora e' una sola
// risposta, e sta dove stanno tutte le altre regole di visibilita'.
function coordinateVisibili(ride) {
  return ride.partenza != null;
}

function linkRitrovo(ride) {
  if (coordinateVisibili(ride)) {
    return {
      href: 'https://www.google.com/maps/dir/?api=1&destination='
        + encodeURIComponent(`${ride.partenza.lat},${ride.partenza.lon}`),
      testo: 'Naviga al ritrovo',
    };
  }
  // Senza coordinate — o guardando da fuori — vale quello che c'era: il testo libero.
  // Vale anche per ogni passaggio pubblicato prima della 014, che coordinate non ne ha.
  if (!ride.origin) return null;
  return {
    href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ride.origin),
    testo: 'Punto di ritrovo su Maps',
  };
}

// --- Il passaggio nel calendario (cantiere C14, decisione D6) ---
// Un file .ics costruito qui dentro: nessun servizio esterno da avvisare di dove va la
// gente, e Google, Apple e Outlook lo aprono allo stesso modo. Il formato e' pignolo su tre
// cose, e sbagliarne una vuol dire un file che un calendario apre e un altro rifiuta senza
// dire perche': le righe finiscono con CRLF e non con \n, virgole e punto e virgola dentro
// il testo vanno protetti, e le righe lunghe vanno spezzate.
function testoIcs(ride) {
  const esc = (s) => String(s)
    .replace(/\\/g, '\\\\').replace(/([;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
  const istante = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const giorno = (iso) => iso.replace(/-/g, '');

  const righe = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WeTransport//IT',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ride.id}@wetransport`,
    `DTSTAMP:${istante(new Date())}`,
  ];

  if (ride.depart_time) {
    // L'ora salvata e' l'ora dell'orologio di chi parte. La converto in UTC col fuso di
    // questo dispositivo, che per una comitiva che parte dallo stesso posto e' il fuso
    // giusto: cosi' l'appuntamento resta l'istante corretto anche aprendolo da altrove.
    const inizio = new Date(`${ride.ride_date}T${ride.depart_time}`);
    righe.push(
      `DTSTART:${istante(inizio)}`,
      `DTEND:${istante(new Date(inizio.getTime() + 60 * 60 * 1000))}`,
    );
  } else {
    // Senza ora non si inventa un orario: giornata intera, e chi guida la precisa poi.
    righe.push(
      `DTSTART;VALUE=DATE:${giorno(ride.ride_date)}`,
      `DTEND;VALUE=DATE:${giorno(addDaysISO(ride.ride_date, 1))}`,
    );
  }

  const liberi = ride.seats - ride.seat_claims.length;
  const descrizione = [
    `Guida ${nomeDi(ride.driver)}.`,
    liberi > 0 ? `${liberi} posti liberi quando hai scaricato questo file.` : 'Auto al completo.',
    ride.fuel_per_person ? `Benzina: ${ride.fuel_per_person} € a testa.` : null,
    ride.note ? `Nota: ${ride.note}` : null,
    SITE_URL,
  ].filter(Boolean).join('\n');

  righe.push(`SUMMARY:${esc('Passaggio verso ' + ride.destination)}`);
  righe.push(`DESCRIPTION:${esc(descrizione)}`);
  if (ride.origin) righe.push(`LOCATION:${esc(ride.origin)}`);
  // Il punto esatto solo a chi lo vede comunque: stessa regola del link di navigazione.
  if (coordinateVisibili(ride)) righe.push(`GEO:${ride.partenza.lat};${ride.partenza.lon}`);
  righe.push('END:VEVENT', 'END:VCALENDAR');

  // Piegatura: il formato vuole righe da non piu' di 75 ottetti, e la continuazione deve
  // cominciare con uno spazio. Taglio a 70 caratteri invece di contare gli ottetti perche'
  // le lettere accentate ne occupano due, e questo margine le copre senza fare i conti.
  return righe.flatMap((r) => {
    const pezzi = [];
    for (let i = 0; i < r.length; i += 70) pezzi.push((i === 0 ? '' : ' ') + r.slice(i, i + 70));
    return pezzi;
  }).join('\r\n') + '\r\n';
}

function scaricaIcs(ride) {
  const url = URL.createObjectURL(new Blob([testoIcs(ride)], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `passaggio-${ride.ride_date}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Non subito: revocare l'indirizzo nello stesso istante del click lascia a mani vuote i
  // browser che leggono il blob un attimo dopo.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function buildCar(ride) {
  const isLong = ride.seats >= 5;
  // Altezza della scocca: l'ultima fila piu' il lunotto piu' il baule. Non un
  // numero tondo scelto a occhio — 310 sono i 237 dove finisce la seconda fila
  // piu' i 73 che servono a lunotto e coda; con tre file la scocca cresce di un
  // passo di fila esatto.
  const H = isLong ? 310 + PASSO_FILA : 310;
  const svg = svgEl('svg', { viewBox: `0 0 ${CAR_W} ${H}`, class: 'car-svg', role: 'img' });
  svg.setAttribute('aria-label', `Auto di ${nomeDi(ride.driver)}`);

  // Materiali (C15). L'auto e' l'unica cosa qui dentro che nessun altro ha, quindi
  // vale disegnarla come un oggetto e non come un rettangolo: la luce arriva
  // dall'alto, il vetro riflette, e sotto c'e' un'ombra che la appoggia. Il
  // gradiente serve alla lamiera, non alla pagina: la carrozzeria ha un colore
  // per ogni guidatore (--car-hue) e senza una variazione di luce sembra piatta.
  const uid = ++carGradId;
  const defs = svgEl('defs', {});
  const lamiera = svgEl('linearGradient', { id: `lamiera-${uid}`, x1: '0', y1: '0', x2: '0.35', y2: '1' });
  lamiera.appendChild(svgEl('stop', { offset: '0', class: 'lamiera-alto' }));
  lamiera.appendChild(svgEl('stop', { offset: '0.55', class: 'lamiera-mezzo' }));
  lamiera.appendChild(svgEl('stop', { offset: '1', class: 'lamiera-basso' }));
  defs.appendChild(lamiera);
  const vetro = svgEl('linearGradient', { id: `vetro-${uid}`, x1: '0', y1: '0', x2: '1', y2: '1' });
  vetro.appendChild(svgEl('stop', { offset: '0', class: 'vetro-chiaro' }));
  vetro.appendChild(svgEl('stop', { offset: '0.5', class: 'vetro-scuro' }));
  vetro.appendChild(svgEl('stop', { offset: '1', class: 'vetro-chiaro' }));
  defs.appendChild(vetro);
  svg.appendChild(defs);

  // L'ombra a terra: appoggia l'auto invece di lasciarla galleggiare.
  svg.appendChild(svgEl('ellipse', { cx: CAR_MID, cy: H - 4, rx: 56, ry: 6, class: 'car-ombra' }));

  svg.appendChild(svgEl('path', { d: sagomaAuto(H), class: 'car-body', fill: `url(#lamiera-${uid})` }));
  // Il filo di luce sul bordo alto: un pixel, ed e' quello che da' lo spessore.
  svg.appendChild(svgEl('path', { d: `M 58 11 Q ${CAR_MID} 11 92 11`, class: 'car-luce' }));
  // Parabrezza e lunotto. Il parabrezza sta fra il cofano e la prima fila; il
  // lunotto fra l'ultima fila e la coda.
  svg.appendChild(svgEl('rect', { x: 32, y: 66, width: 86, height: 20, rx: 7, class: 'car-glass', fill: `url(#vetro-${uid})` }));
  // Riflesso sul parabrezza: una striscia sola, di sbieco.
  svg.appendChild(svgEl('path', { d: 'M 40 84 L 56 68 L 70 68 L 54 84 Z', class: 'car-riflesso' }));
  svg.appendChild(svgEl('rect', { x: 34, y: H - 62, width: 82, height: 16, rx: 6, class: 'car-glass', fill: `url(#vetro-${uid})` }));
  finitureAuto(svg, H, isLong ? 3 : 2);

  const claims = new Map(ride.seat_claims.map(c => [c.seat_index, c]));
  const myClaim = ride.seat_claims.find(mioPosto);
  const isDriver = ride.driver_id === currentUser.id;
  const past = isPastDay() || hasDeparted(ride);

  drawSeat(svg, DRIVER_POS, { kind: 'driver', label: initials(nomeDi(ride.driver)), name: nomeDi(ride.driver), avatar: ride.driver?.avatar_url ?? null });
  svg.appendChild(svgEl('circle', { cx: DRIVER_POS.x, cy: DRIVER_POS.y - 36, r: 7, class: 'car-wheel-steer' }));

  const layout = SEAT_LAYOUTS[ride.seats];
  for (const idx of Object.keys(layout).map(Number)) {
    const claim = claims.get(idx);
    const pos = layout[idx];
    if (claim) {
      const mine = mioPosto(claim);
      // Il posto di un ospite lo libera anche chi ce l'ha portato: e' la policy di
      // 031, e senza questo ramo un ospite messo per sbaglio resterebbe li' finche'
      // il guidatore non se ne accorge.
      const mioOspite = claim.invitato_da === currentUser.id;
      const nome = nomeOccupante(claim);
      const seat = drawSeat(svg, pos, {
        kind: mine ? 'mine' : 'taken',
        label: initials(nome),
        name: claim.passenger_id ? nome : `${nome} · ospite`,
        avatar: claim.passenger?.avatar_url ?? null,
        clickable: !past && (mine || mioOspite || isDriver || isAdmin),
      });
      if (!past && (mine || mioOspite || isDriver || isAdmin)) {
        seat.addEventListener('click', () => releaseSeat(ride, claim, mine));
      }
    } else {
      // Con un posto gia' preso resta possibile aggiungere un ospite: e' tutto il
      // senso di C35, e chi ha gia' il suo sedile e' proprio la persona che porta
      // qualcuno. Chi guida puo' farlo anche lui — e' la sua auto.
      const canClaim = !past && !isDriver && !myClaim;
      const canOspite = !past && !sospeso && (isDriver || Boolean(myClaim));
      const seat = drawSeat(svg, pos, {
        kind: 'free', label: '+',
        name: canOspite && !canClaim ? 'Posto libero: aggiungi un ospite' : 'Posto libero',
        clickable: canClaim || canOspite,
      });
      if (canClaim) seat.addEventListener('click', () => claimSeat(ride, idx));
      else if (canOspite) seat.addEventListener('click', () => aggiungiOspite(ride, idx));
    }
  }
  return svg;
}

let avatarClipId = 0;
let carGradId = 0;
// Un sedile e' piu' alto che largo, come i sedili: 50 di seduta contro 34-44 di
// larghezza. E' una proporzione da difendere, non un caso: quando erano 44 per 40
// erano quadrati, e tre quadrati in fila si leggevano come una griglia invece che
// come una panchina. Per questo allargando le poltrone a 44 la seduta e' salita a
// 50 — le misure stanno in `auto-svg.js`, dove le legge anche il test, e qui non
// si scrive nessun numero che si possa dimenticare di cambiare.
function drawSeat(svg, pos, { kind, label, name, avatar = null, clickable = false }) {
  const w = pos.w ?? W_AVANTI;
  const g = svgEl('g', { class: `seat seat-${kind}${clickable ? ' seat-click' : ''}`, tabindex: clickable ? 0 : -1 });
  const title = svgEl('title', {});
  title.textContent = name;
  g.appendChild(title);
  // Tutto si ricava dalla seduta: dove comincia, quanto e' alta. Il centro del
  // cuscino porta la foto e le iniziali, cosi' restano al centro anche il giorno in
  // cui la seduta cambia altezza.
  const sedutaY = pos.y + Y_SEDUTA;
  const centroY = sedutaY + H_SEDUTA / 2;
  g.appendChild(svgEl('rect', { x: pos.x - (w - 4) / 2, y: sedutaY - H_SPALLIERA, width: w - 4, height: H_SPALLIERA, rx: 5, class: 'seat-back' }));
  g.appendChild(svgEl('rect', { x: pos.x - w / 2, y: sedutaY, width: w, height: H_SEDUTA, rx: 9, class: 'seat-base' }));
  // La piega del cuscino: e' quella che fa leggere il sedile come imbottitura.
  g.appendChild(svgEl('path', { d: `M ${pos.x - (w / 2 - 7)} ${sedutaY + 10} L ${pos.x + (w / 2 - 7)} ${sedutaY + 10}`, class: 'seat-piega' }));
  if (avatar) {
    // Il tondo della foto non puo' sfondare il sedile piu' stretto.
    const r = Math.min(15, w / 2 - 3);
    const clipId = 'seat-av-' + (++avatarClipId);
    const clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('circle', { cx: pos.x, cy: centroY, r }));
    svg.appendChild(clip);
    const img = svgEl('image', {
      x: pos.x - r, y: centroY - r, width: r * 2, height: r * 2,
      'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice',
    });
    img.setAttribute('href', avatar);
    // Se la foto non carica si torna alle iniziali
    img.addEventListener('error', () => { img.remove(); g.querySelector('text')?.removeAttribute('opacity'); });
    g.appendChild(img);
  }
  const t = svgEl('text', { x: pos.x, y: centroY + 6, class: 'seat-text' });
  t.textContent = label;
  if (avatar) t.setAttribute('opacity', '0'); // iniziali sotto la foto, visibili solo se la foto fallisce
  g.appendChild(t);
  svg.appendChild(g);
  if (clickable) {
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new Event('click')); } });
  }
  return g;
}

// --- Azioni sedili ---
async function claimSeat(ride, seatIndex) {
  if (bloccaSeSospeso('prenotare un posto')) return;
  const { error } = await supabase.from('seat_claims').insert({
    ride_id: ride.id, seat_index: seatIndex, passenger_id: currentUser.id,
  });
  if (error) {
    if (error.code === '23505') toast('Posto già occupato, oppure sei già su questa auto.');
    else toast(friendlyError(error));
    loadRides();
    return;
  }
  toast('Posto prenotato: sei a bordo.');
  await clearMyRequest();
  await proponiGemello(ride);
  loadRides();
}

// C31 — preso il posto all'andata, la domanda successiva e' sempre la stessa.
// Si chiede invece di farlo da soli: prenotare per conto di qualcuno e' la cosa
// che poi si scopre di aver fatto, e un posto occupato per sbaglio lo perde
// qualcun altro. Si chiede **una volta** e la risposta e' un tocco.
async function proponiGemello(ride) {
  const g = gemelloDi(ride);
  if (!g) return;
  if (g.seat_claims.some(mioPosto)) return;
  if (g.driver_id === currentUser.id) return;
  const occupati = new Set(g.seat_claims.map(c => c.seat_index));
  const libero = [...Array(g.seats).keys()].map(i => i + 1).find(i => !occupati.has(i));
  if (!libero) return;
  const versoCasa = Boolean(ride.ritorno_di) === false;
  if (!await conferma(versoCasa ? 'Prendi anche il ritorno?' : 'Prendi anche l\'andata?', {
    testo: `${g.origin || '—'} → ${g.destination || ''}`
      + (g.depart_time ? ` alle ${g.depart_time.slice(0, 5)}` : '')
      + `, con ${nomeDi(g.driver)}. È l'altra metà dello stesso viaggio.`,
    azione: 'Sì, prendo il posto',
  })) return;
  const { error } = await supabase.from('seat_claims').insert({
    ride_id: g.id, seat_index: libero, passenger_id: currentUser.id,
  });
  if (error) { toast(friendlyError(error)); return; }
  toast(versoCasa ? 'Preso anche il ritorno.' : 'Presa anche l\'andata.');
}

// --- C35: il posto per un ospite ---
// Un sedile con un nome libero invece di un `user_id`. Il database sa gia' dire di
// no a tutto il resto (031): che chi invita sia della comitiva, che non ci siano due
// ospiti con lo stesso nome, che un sospeso o un bloccato non passino. Qui si chiede
// il nome e si scrive.
async function aggiungiOspite(ride, seatIndex) {
  if (bloccaSeSospeso('portare un ospite')) return;
  const nome = await ask('Chi porti?', {
    text: 'Il nome di chi sale senza avere l\'app. Il posto risulta occupato a tutti, e la sua quota finisce nel tuo conto — non in uno suo, che non esiste.',
    placeholder: 'Enrico',
  });
  if (!nome) return;
  const { error } = await supabase.from('seat_claims').insert({
    ride_id: ride.id, seat_index: seatIndex,
    ospite_nome: nome.trim().slice(0, 40), invitato_da: currentUser.id,
  });
  if (error) {
    toast(error.code === '23505' ? 'Posto già occupato.' : friendlyError(error));
  } else {
    toast(`${nome.trim()} è a bordo come tuo ospite.`);
  }
  loadRides();
}

// --- C30: annunciare un ritardo ---
// Zero non e' un ritardo di zero minuti: e' «ho sbagliato, sono in orario». Il
// database tiene `null` per quello, cosi' il vincolo resta «da 1 a 180» e non
// esiste una seconda maniera di dire la stessa cosa.
async function annunciaRitardo(ride) {
  if (bloccaSeSospeso('annunciare un ritardo')) return;
  const risposta = await ask('Di quanto sei in ritardo?', {
    text: ride.ritardo_min > 0
      ? `Adesso dice ${ride.ritardo_min} minuti. Scrivi 0 per dire che sei di nuovo in orario.`
      : 'Chi ha un posto sulla tua auto lo vede subito, senza ricaricare.',
    value: String(ride.ritardo_min || ''), placeholder: '10', type: 'number',
    scelte: [[5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']],
  });
  if (risposta === null) return;
  const minuti = Math.round(Number(String(risposta).replace(',', '.')));
  if (!Number.isFinite(minuti) || minuti < 0 || minuti > 180) {
    toast('Da 1 a 180 minuti, oppure 0 per dire che sei in orario.');
    return;
  }
  const { error } = await supabase.from('rides')
    .update({ ritardo_min: minuti || null, ritardo_alle: minuti ? new Date().toISOString() : null })
    .eq('id', ride.id);
  if (error) { toast(friendlyError(error)); return; }
  toast(minuti
    ? `Annunciato: ${minuti} minuti di ritardo, si parte verso le ${oraPiu(ride.depart_time || '00:00', minuti)}.`
    : 'Ritardo tolto: risulti di nuovo in orario.');
  loadRides(true);
}

async function releaseSeat(ride, claim, mine) {
  // Tre casi e non due: il proprio posto, quello di una persona, quello di un
  // proprio ospite. Il terzo non e' il secondo con un nome diverso — «non riceve un
  // avviso» sarebbe una frase senza senso per chi non ha l'app.
  const ospite = !claim.passenger_id;
  const nome = nomeOccupante(claim);
  const titolo = mine ? 'Scendere da questa auto?' : `Liberare il posto di ${nome}?`;
  if (!await conferma(titolo, {
    testo: mine
      ? 'Il posto torna libero e chiunque della comitiva può prenderlo.'
      : ospite
        ? `Il posto torna libero e la quota di ${nome} esce dal conto di chi lo ha portato.`
        : 'Il posto torna libero e chiunque della comitiva può prenderlo. Chi ci stava non riceve un avviso.',
    azione: mine ? 'Scendi' : 'Libera il posto',
  })) return;
  const { error } = await supabase.from('seat_claims').delete()
    .eq('ride_id', ride.id).eq('seat_index', claim.seat_index);
  if (error) { toast(friendlyError(error)); return; }
  toast(mine ? 'Sei sceso dall\'auto.' : 'Posto liberato.');
  loadRides();
}

// --- Render passaggi ---
function renderRides(rides) {
  ridesList.innerHTML = '';
  emptyMessage.classList.toggle('hidden', rides.length > 0);
  // C31: `gemelloDi()` cerca qui dentro. Va assegnato prima di disegnare, perche'
  // le schede lo interrogano mentre si costruiscono.
  setPassaggiVisibili(rides);

  // Riepilogo del giorno
  const statsEl = document.getElementById('day-stats');
  statsEl.classList.toggle('hidden', rides.length === 0);
  if (rides.length > 0) {
    const totalFree = rides.reduce((n, r) => n + r.seats - r.seat_claims.length, 0);
    const aboard = rides.reduce((n, r) => n + 1 + r.seat_claims.length, 0);
    statsEl.innerHTML =
      `<span class="stat-chip"><svg width="15" height="15"><use href="#i-car"/></svg><strong>${rides.length}</strong> auto</span>` +
      `<span class="stat-chip"><svg width="15" height="15"><use href="#i-plus"/></svg><strong>${totalFree}</strong> posti liberi</span>` +
      `<span class="stat-chip"><svg width="15" height="15"><use href="#i-users"/></svg><strong>${aboard}</strong> a bordo</span>`;

    // Condividi il riepilogo dell'intera giornata (pronto per il gruppo WhatsApp)
    const shareDay = document.createElement('button');
    shareDay.className = 'btn btn-ghost btn-small';
    shareDay.innerHTML = '<svg width="14" height="14"><use href="#i-share"/></svg> Condividi riepilogo';
    shareDay.addEventListener('click', async () => {
      const lines = [`WeTransport — ${DAY_FMT.format(new Date(currentDate + 'T12:00:00'))}`];
      for (const r of rides) {
        const freeN = r.seats - r.seat_claims.length;
        lines.push('');
        lines.push(`${nomeDi(r.driver)} → ${r.destination}`
          + (r.depart_time ? ` (ore ${r.depart_time.slice(0, 5)})` : ''));
        lines.push('A bordo: ' + (r.seat_claims.map(nomeOccupante).join(', ') || 'nessuno'));
        lines.push(freeN > 0 ? `Liberi: ${freeN} → prenota su ${SITE_URL}` : 'Al completo');
      }
      condividi(lines.join('\n'));
    });
    statsEl.appendChild(shareDay);
  }
  for (const [idx, ride] of rides.entries()) {
    const card = document.createElement('article');
    card.className = 'ride-card' + (ride.driver_id === currentUser.id ? ' mia' : '');
    card.style.setProperty('--i', idx); // stagger dell'entrata

    const head = document.createElement('div');
    head.className = 'ride-head';

    // L'ora, e sta a sinistra grande come su un tabellone.
    //
    // Era «· ore 18:30» in coda al sottotitolo grigio, cioe' il dato piu' cercato
    // di tutta la scheda scritto come una nota a margine: la domanda del prodotto
    // e' «chi guida oggi, e c'e' posto per me», e la seconda cosa che si guarda
    // dopo il posto libero e' a che ora si parte. Qui e' una cifra monospaziata in
    // colonna sua, staccata dal resto da una riga: la matrice di un tabellone
    // delle partenze, che e' il riferimento fisico dichiarato in PRODUCT.md.
    //
    // Del colore del testo e non di quello del tocco, e non e' un dettaglio: in
    // questo foglio il colore pieno vuol dire «si tocca» o «e' tuo», e un orario non
    // e' nessuna delle due cose. La regola stava scritta e questo era uno dei punti
    // in cui il foglio non la rispettava. Valeva col viola di allora e vale con il
    // blu di adesso: e' la regola che conta, non la tinta.
    //
    // Senza orario la colonna non c'e' affatto, invece di un trattino: una casella
    // vuota su un tabellone dice «orario soppresso», e qui vorrebbe dire soltanto
    // che chi guida non l'ha scritto.
    //
    // **E gira.** Ogni carattere sta in un elemento suo perche' un tabellone delle
    // partenze non scrive l'ora, la **gira**: le palette calano una dopo l'altra
    // da sinistra, e l'ordine e' quello perche' e' l'ordine in cui si leggono. Il
    // foglio di stile ci attacca l'animazione e il ritardo, che sale col numero
    // della paletta (`--n`); qui si costruiscono solo le celle, cinque, quante
    // sono i caratteri di «18:30» compresi i due punti — sul tabellone vero anche
    // il separatore e' una paletta, e gira insieme alle altre.
    //
    // Con `prefers-reduced-motion` non gira niente e l'ora c'e' comunque: il
    // foglio spegne l'animazione, e senza animazione le celle sono cinque pezzi di
    // testo in fila, cioe' esattamente l'ora. Non c'e' uno stato di partenza da
    // cui l'informazione debba essere liberata.
    if (ride.depart_time) {
      const orario = ride.depart_time.slice(0, 5);
      const ora = document.createElement('div');
      ora.className = 'ride-ora';

      // **Per chi ascolta l'ora resta una frase, non cinque pezzi.** Cinque celle
      // `inline-block` non sono piu' un testo unico: un lettore di schermo le
      // annuncia una per una — «uno, otto, due punti, tre, zero» — ed e' il prezzo
      // che le palette si portano dietro per il fatto di dover girare (una
      // trasformazione non si applica a un elemento in linea, quindi le celle
      // devono essere blocchi). Il prezzo si paga qui: la frase vera sta scritta
      // per intero in un pixel ritagliato, e il disegno che la compone diventa
      // decorazione dichiarata. Anche la targhetta «parte» esce dall'albero,
      // perche' quella parola e' gia' dentro la frase.
      const letto = document.createElement('span');
      letto.className = 'solo-lettori';
      letto.textContent = `Parte alle ${orario}`;

      const cifre = document.createElement('b');
      cifre.className = 'ora';
      cifre.setAttribute('aria-hidden', 'true');
      for (const [n, carattere] of [...orario].entries()) {
        const paletta = document.createElement('i');
        paletta.textContent = carattere;
        paletta.style.setProperty('--n', n);
        cifre.appendChild(paletta);
      }
      const lab = document.createElement('span');
      lab.className = 'lab';
      lab.setAttribute('aria-hidden', 'true');
      lab.textContent = 'parte';
      ora.append(letto, cifre, lab);
      head.appendChild(ora);
    }

    const info = document.createElement('div');
    info.className = 'ride-info';
    const route = document.createElement('div');
    route.className = 'ride-route';
    route.textContent = ride.origin ? `${ride.origin} → ${ride.destination}` : ride.destination;
    info.appendChild(route);
    const ritrovo = linkRitrovo(ride);
    if (ritrovo) {
      const maps = document.createElement('a');
      maps.className = 'maps-link';
      maps.href = ritrovo.href;
      maps.target = '_blank';
      maps.rel = 'noopener';
      maps.innerHTML = '<svg width="13" height="13"><use href="#i-pin"/></svg> ' + ritrovo.testo;
      info.appendChild(maps);
    }
    const sub = document.createElement('div');
    sub.className = 'ride-sub';
    // Il giorno e basta: l'ora e' passata nella colonna a sinistra, e ripeterla
    // qui vorrebbe dire scrivere due volte lo stesso numero nella stessa scheda.
    sub.textContent = DAY_FMT.format(new Date(ride.ride_date + 'T12:00:00'));
    info.appendChild(sub);
    const drv = document.createElement('div');
    drv.className = 'ride-sub';
    // C33: che auto cercare. Sta accanto a chi guida e non fra le pastiglie in
    // fondo, perche' risponde alla stessa domanda — «chi passa a prendermi» — e
    // perche' si legge nel momento in cui si guarda la strada, non la scheda.
    const targa = ride.auto ? descriviAuto(ride.auto) : null;
    drv.textContent = `Guida ${nomeDi(ride.driver)}` + (targa ? ` · ${targa}` : '');
    // Da C9 in Home arrivano anche passaggi di comitive a cui non appartengo: senza
    // dirlo, sembrerebbero della propria e non si capirebbe chi sia chi guida.
    if (ride.group_id !== currentGroupId) {
      const fuori = document.createElement('span');
      fuori.className = 'badge-fuori';
      fuori.textContent = ride.visibilita === 'pubblico' ? 'fuori comitiva' : 'in zona';
      fuori.title = 'Questo passaggio è di un\'altra comitiva, aperto a chi sta fuori.';
      drv.appendChild(fuori);
    }
    if (ride.driver_id !== currentUser.id) {
      // Il guidatore qui puo' essere una persona bloccata: la sua auto resta visibile solo
      // finche' ci sono sopra, ed e' anche il punto da cui si sblocca.
      drv.appendChild(bottonePersona(ride.driver_id, nomeDi(ride.driver), ride.id));
    }
    info.appendChild(drv);
    head.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'ride-actions';
    const share = document.createElement('button');
    share.className = 'place-delete share';
    share.innerHTML = '<svg width="16" height="16"><use href="#i-share"/></svg>';
    share.title = 'Condividi';
    const free = ride.seats - ride.seat_claims.length;
    const shareText =
      `${nomeDi(ride.driver)} guida verso ${ride.destination}` +
      (ride.depart_time ? ` alle ${ride.depart_time.slice(0, 5)}` : '') +
      ` (${ride.ride_date.split('-').reverse().join('/')})` +
      (free > 0 ? ` — ${free} posti disponibili.` : ' — auto al completo.') +
      ` Prenota su ${SITE_URL}`;
    share.addEventListener('click', () => condividi(shareText, SITE_URL));
    actions.appendChild(share);
    const cal = document.createElement('button');
    cal.className = 'place-delete';
    cal.innerHTML = '<svg width="16" height="16"><use href="#i-calendar"/></svg>';
    cal.title = 'Aggiungi al calendario';
    cal.addEventListener('click', () => {
      scaricaIcs(ride);
      toast('File del calendario scaricato: aprilo e il passaggio entra nel tuo calendario.');
    });
    actions.appendChild(cal);
    if (ride.driver_id === currentUser.id || isAdmin) {
      const del = document.createElement('button');
      del.className = 'place-delete';
      del.innerHTML = '<svg width="16" height="16"><use href="#i-x"/></svg>';
      del.title = 'Annulla passaggio';
      del.addEventListener('click', async () => {
        // C28: l'avviso si accoda comunque (026), ma arriva sul telefono solo con le
        // chiavi delle notifiche in piedi. Prometterlo quando non puo' partire sarebbe
        // la stessa mezza verita' di un test che si salta da solo.
        if (!await conferma('Annullare il passaggio?', {
          testo: notifichePossibili()
            ? 'Chi aveva un posto sopra questa auto lo perde. Riceve un avviso, e lo riceve anche chi era in lista d\'attesa.'
            : 'Chi aveva un posto sopra questa auto lo perde, e per oggi resta a piedi.',
          azione: 'Annulla il passaggio',
          pericolo: true,
        })) return;
        const { error } = await supabase.from('rides').delete().eq('id', ride.id);
        if (error) { toast(friendlyError(error)); return; }
        toast('Passaggio annullato.');
        loadRides();
      });
      actions.appendChild(del);
    }
    head.appendChild(actions);
    card.appendChild(head);

    // L'auto va sulla sua piastra: alla luce e' quel rettangolo scuro a farla
    // vedere, al buio la piastra e' trasparente e il disegno e' identico.
    const piastra = document.createElement('div');
    piastra.className = 'car-piastra';
    piastra.appendChild(buildCar(ride));
    card.appendChild(piastra);

    // Chi è a bordo, in chiaro
    if (ride.seat_claims.length > 0) {
      const aboard = document.createElement('div');
      aboard.className = 'history-passengers';
      for (const c of ride.seat_claims) {
        const chip = document.createElement('span');
        chip.className = 'history-chip' + (mioPosto(c) ? ' driver' : '');
        chip.textContent = nomeOccupante(c) + (c.passenger_id ? '' : ' · ospite');
        aboard.appendChild(chip);
      }
      card.appendChild(aboard);
    }

    const foot = document.createElement('div');
    foot.className = 'ride-foot';
    const count = document.createElement('span');
    count.className = 'place-badge' + (free > 0 ? ' public' : '');
    count.textContent = free > 0
      ? `${ride.seat_claims.length}/${ride.seats} occupati · ${free} ${free === 1 ? 'libero' : 'liberi'}`
      : 'Al completo';
    foot.appendChild(count);
    if (ride.driver_id === currentUser.id) {
      const meBadge = document.createElement('span');
      meBadge.className = 'place-badge mine';
      meBadge.textContent = 'La tua auto';
      foot.appendChild(meBadge);
    } else if (ride.seat_claims.some(mioPosto)) {
      const meBadge = document.createElement('span');
      meBadge.className = 'place-badge mine';
      meBadge.textContent = 'Sei a bordo';
      foot.appendChild(meBadge);
    }
    if (ride.depart_time && currentDate === todayISO()) {
      const [h, m] = ride.depart_time.split(':').map(Number);
      const now = new Date();
      // C30: annunciato un ritardo, il conto alla rovescia deve contare verso l'ora
      // vera. Lasciarlo sull'ora pubblicata direbbe «Partita» a un'auto che sta
      // ancora arrivando, cioe' la cosa esattamente sbagliata da dire a chi aspetta.
      const mins = h * 60 + m + (ride.ritardo_min || 0) - (now.getHours() * 60 + now.getMinutes());
      const t = document.createElement('span');
      t.className = 'place-badge' + (mins > 0 && mins <= 60 ? ' mine' : '');
      t.textContent = mins <= 0 ? 'Partita'
        : mins < 60 ? `Parte tra ${mins} min`
        : `Parte tra ${Math.floor(mins / 60)} h ${mins % 60} min`;
      foot.appendChild(t);
    }
    // C31: le due meta' si riconoscono a colpo d'occhio. Il legame si dice sulla
    // scheda e non in una vista a parte, perche' la domanda («e per tornare?»)
    // nasce guardando l'andata.
    const gemello = gemelloDi(ride);
    if (gemello) {
      const par = document.createElement('span');
      par.className = 'place-badge coppia';
      par.textContent = ride.ritorno_di
        ? `Ritorno · andata alle ${(gemello.depart_time || '').slice(0, 5) || '—'}`
        : `Andata · ritorno alle ${(gemello.depart_time || '').slice(0, 5) || '—'}`;
      par.title = 'Andata e ritorno dello stesso viaggio: puoi prenderli entrambi.';
      foot.appendChild(par);
    }
    // Il ritardo si vede a tutti, sempre: chi apre l'app in quel momento deve
    // trovarlo scritto, non dedurlo dal conto alla rovescia.
    if (ride.ritardo_min > 0) {
      const rit = document.createElement('span');
      rit.className = 'place-badge ritardo';
      rit.textContent = `In ritardo di ${ride.ritardo_min} min`
        + (ride.depart_time ? ` · verso le ${oraPiu(ride.depart_time, ride.ritardo_min)}` : '');
      foot.appendChild(rit);
    }
    if (ride.fuel_per_person > 0) {
      const fuel = document.createElement('span');
      fuel.className = 'place-badge fuel';
      fuel.innerHTML = `<svg width="12" height="12"><use href="#i-fuel"/></svg> ${ride.fuel_per_person} € a testa`;
      foot.appendChild(fuel);
    }
    if (ride.note) {
      const note = document.createElement('span');
      note.className = 'ride-note';
      note.textContent = ride.note;
      foot.appendChild(note);
    }
    card.appendChild(foot);

    // ── C30: «sono in ritardo» ───────────────────────────────────────────
    // Solo a chi guida e solo il giorno stesso: annunciare un ritardo per
    // dopodomani non vuol dire niente, e il bottone in piu' su ogni scheda
    // renderebbe illeggibili le altre azioni. La cifra si sceglie da un elenco
    // corto invece che scriverla, perche' si preme col telefono in mano mentre
    // si esce di casa in ritardo — che e' l'unico momento in cui serve.
    if (ride.driver_id === currentUser.id && ride.ride_date === todayISO() && !sospeso) {
      const rBtn = document.createElement('button');
      rBtn.className = 'btn btn-ghost btn-small';
      rBtn.textContent = ride.ritardo_min > 0 ? `In ritardo di ${ride.ritardo_min} min · cambia` : 'Sono in ritardo';
      rBtn.addEventListener('click', () => annunciaRitardo(ride));
      card.appendChild(rBtn);
    }

    // Lista d'attesa: quando l'auto è piena ci si mette in coda,
    // il primo in lista prende il posto appena qualcuno scende (trigger DB)
    const waitlist = [...(ride.ride_waitlist ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ridePast = isPastDay() || hasDeparted(ride);
    const imAboard = ride.seat_claims.some(mioPosto);
    const imWaiting = waitlist.some(w => w.user_id === currentUser.id);
    if (waitlist.length > 0) {
      const wl = document.createElement('div');
      wl.className = 'ride-sub waitlist-row';
      wl.textContent = 'In attesa: ' + waitlist.map((w, i) =>
        `${i + 1}. ${nomeDi(w.profile)}${w.user_id === currentUser.id ? ' (tu)' : ''}`).join(' · ');
      card.appendChild(wl);
    }
    if (!ridePast && ride.driver_id !== currentUser.id && !imAboard && (free === 0 || imWaiting)) {
      const wBtn = document.createElement('button');
      wBtn.className = 'btn btn-ghost btn-small';
      wBtn.textContent = imWaiting ? 'Esci dalla lista d\'attesa' : 'Mettimi in lista d\'attesa';
      wBtn.addEventListener('click', async () => {
        if (imWaiting) {
          const { error } = await supabase.from('ride_waitlist').delete()
            .eq('ride_id', ride.id).eq('user_id', currentUser.id);
          if (error) { toast(friendlyError(error)); return; }
          toast('Tolto dalla lista d\'attesa.');
        } else {
          if (bloccaSeSospeso('metterti in lista d\'attesa')) return;
          const { error } = await supabase.from('ride_waitlist').insert({ ride_id: ride.id, user_id: currentUser.id });
          if (error && error.code !== '23505') { toast(friendlyError(error)); return; }
          toast('Sei in lista: se un posto si libera, sali in automatico.');
        }
        loadRides(true);
      });
      card.appendChild(wBtn);
    }

    // Commenti
    const nComments = ride.ride_comments?.[0]?.count ?? 0;
    const cBtn = document.createElement('button');
    cBtn.className = 'btn btn-ghost btn-small comments-btn';
    cBtn.textContent = nComments > 0 ? `Commenti (${nComments})` : 'Scrivi un commento';
    const panel = document.createElement('div');
    panel.className = 'comments-panel hidden';
    cBtn.addEventListener('click', async () => {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) await loadComments(ride.id, panel);
    });
    card.appendChild(cBtn);
    card.appendChild(panel);

    ridesList.appendChild(card);
  }
}

// --- Commenti ---
const TIME_FMT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

async function loadComments(rideId, panel) {
  panel.innerHTML = '<div class="skeleton" style="height:40px"></div>';
  const { data, error } = await supabase
    .from('ride_comments')
    .select('id, user_id, body, created_at, author:profiles(display_name)')
    .eq('ride_id', rideId)
    .order('created_at', { ascending: true })
    .limit(50);
  panel.innerHTML = '';
  if (error) { toast(friendlyError(error)); return; }

  const list = document.createElement('div');
  list.className = 'comments-list';
  for (const c of data ?? []) {
    const row = document.createElement('div');
    row.className = 'comment';
    const meta = document.createElement('span');
    meta.className = 'comment-meta';
    meta.textContent = `${nomeDi(c.author)} · ${TIME_FMT.format(new Date(c.created_at))}`;
    row.appendChild(meta);
    const body = document.createElement('span');
    body.textContent = c.body;
    row.appendChild(body);
    if (c.user_id === currentUser.id || isAdmin) {
      const del = document.createElement('button');
      del.className = 'comment-del';
      del.innerHTML = '<svg width="12" height="12"><use href="#i-x"/></svg>';
      del.title = 'Elimina commento';
      del.addEventListener('click', async () => {
        const { error } = await supabase.from('ride_comments').delete().eq('id', c.id);
        if (error) { toast(friendlyError(error)); return; }
        loadComments(rideId, panel);
      });
      row.appendChild(del);
    }
    list.appendChild(row);
  }
  panel.appendChild(list);

  const form = document.createElement('form');
  form.className = 'comment-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 300;
  input.placeholder = 'Scrivi qualcosa (es. "passo alle 15 in piazza")';
  form.appendChild(input);
  const send = document.createElement('button');
  send.className = 'btn btn-primary btn-small';
  send.textContent = 'Invia';
  form.appendChild(send);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    if (bloccaSeSospeso('commentare')) return;
    const { error } = await supabase.from('ride_comments').insert({ ride_id: rideId, user_id: currentUser.id, body });
    if (error) { toast(friendlyError(error)); return; }
    input.value = '';
    loadComments(rideId, panel);
  });
  panel.appendChild(form);
  input.focus();
}

export {
  renderRides,
};
