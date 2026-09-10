// Il client di Supabase, e dove sta girando l'app
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

// La libreria sta nel repo, non su un CDN di terzi: `vendor/README.md` dice perche' e
// come si aggiorna. Era l'idea 1 della revisione del 27/07, e ne chiude quattro in un
// colpo — l'informativa, la CSP, il peso alla partenza, e i test che fuori da GitHub
// Actions non potevano nemmeno girare.
import { createClient } from '../vendor/supabase-js.esm.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from '../config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SITE_URL = 'https://wetransport.netlify.app';

// **Dieci, e non sei.** Sei caratteri e' il default di Supabase, cioe' un numero
// scelto per non dare fastidio a nessuno: una password di sei caratteri si prova
// tutta. Questa riga vale per gli account **nuovi** — chi ne ha gia' uno rientra
// con la password che ha, perche' altrimenti l'app lo chiuderebbe fuori.
//
// Questo e' il controllo del browser, che serve a dirlo prima di mandare la
// richiesta: **quello che vale davvero e' il minimo impostato nella dashboard di
// Supabase**, che e' l'unico che un client non puo' saltare. Vanno tenuti uguali,
// e insieme al minimo va acceso il confronto con gli elenchi di password rubate
// (Auth → Policies). Sta scritto in README.md, sezione «Cosa si imposta a mano».
const PASSWORD_MINIMO = 10;

// ---- Su un'anteprima non si entra ----
//
// **Il problema che chiude, e quello che non chiude.** `config.js` e' committato con
// l'indirizzo del progetto Supabase vero, quindi ogni anteprima di deploy e'
// WeTransport **con i dati veri dentro**, a un indirizzo pubblico. La separazione
// vera sarebbe un secondo progetto Supabase; finche' non c'e', questo impedisce il
// modo realistico in cui quel difetto diventa un danno: qualcuno apre il link di
// un'anteprima da una pull request, entra col proprio account e pubblica un'auto
// vera in una comitiva vera, convinto di essere sul sito.
//
// **Non e' una difesa contro un attacco, ed e' importante non crederlo.** La chiave
// anon e' pubblica per progetto: chi vuole parla col database direttamente, senza
// passare da questa pagina. Cio' che protegge i dati sono le policy RLS, non questa
// riga. Questa riga protegge dalle distrazioni.
//
// `localhost` resta fuori dal blocco: li' chi apre l'app e' chi la scrive, e sa con
// che database sta parlando. Il caso che questo intercetta e' l'indirizzo condiviso
// in una discussione, aperto da qualcun altro.
const AMBIENTE_VERO = 'wetransport.netlify.app';
const IN_LOCALE = ['localhost', '127.0.0.1', '[::1]'];
// La scappatoia serve ai test dei flussi, che su un'anteprima devono poter entrare
// davvero. E' volutamente debole — una riga di memoria locale — perche' proteggere
// da chi la cerca non e' il suo mestiere: quello e' delle RLS.
const ANTEPRIMA_CONSAPEVOLE = 'wt_anteprima_consapevole';

function ambienteEstraneo() {
  const host = location.hostname;
  if (host === AMBIENTE_VERO || IN_LOCALE.includes(host)) return false;
  try {
    return localStorage.getItem(ANTEPRIMA_CONSAPEVOLE) !== '1';
  } catch {
    // Memoria locale chiusa: si sta dalla parte prudente e si blocca.
    return true;
  }
}

export {
  AMBIENTE_VERO,
  PASSWORD_MINIMO,
  SITE_URL,
  VAPID_PUBLIC_KEY,
  ambienteEstraneo,
  supabase,
};
