// Edge Function "notifiche" — l'unico pezzo di WeTransport che gira fuori dal browser.
//
// Cantiere C13. Fa due cose, in quest'ordine, ed e' chiamata da `pg_cron` ogni dieci minuti:
//
//   1. chiede al database di accodare le partenze imminenti (nessun trigger puo' accorgersi
//      che sta passando il tempo);
//   2. svuota la coda: per ogni riga non ancora inviata, manda una notifica push a tutti i
//      dispositivi iscritti di quella persona.
//
// **Perche' esiste.** Spedire una push vuole due cose che dentro Postgres non devono stare:
// una chiave privata e una richiesta HTTP verso un servizio di terzi dentro una transazione.
// Qui la chiave sta nei segreti della funzione, e se la spedizione e' rotta l'app continua a
// funzionare: gli eventi restano in coda.
//
// **Non e' mai stata eseguita**: il deploy richiede la CLI di Supabase e un token, che questo
// repo non ha e non deve avere. Finche' non gira, l'unica conseguenza e' che le notifiche non
// arrivano — la coda si riempie e basta. Vedi supabase/README.md, sezione «Notifiche».

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
// La chiave di servizio salta le policy: qui serve, perche' la coda e' scritta apposta per
// non essere leggibile da nessun client. Vive nei segreti della funzione, mai nel repo.
const chiaveServizio = Deno.env.get('SUPABASE_SERVICE_KEY')!;
const vapidPubblica = Deno.env.get('VAPID_PUBLIC_KEY')!;
const vapidPrivata = Deno.env.get('VAPID_PRIVATE_KEY')!;
const contatto = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:wetransport@example.invalid';
// Chi puo' svegliare questa funzione. **Senza segreto non si parte**: prima il controllo
// era `if (segretoCron && ...)`, cioe' dimenticare di impostarlo lasciava l'indirizzo
// aperto a chiunque — e nessun errore lo diceva, perche' la funzione rispondeva benissimo.
// Una guardia che si spegne da sola quando manca la sua chiave e' peggio di nessuna
// guardia: chiudere e' l'unica scelta che si nota subito.
const segretoCron = Deno.env.get('CRON_SECRET') ?? '';

webpush.setVapidDetails(contatto, vapidPubblica, vapidPrivata);

const db = createClient(url, chiaveServizio, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (!segretoCron) {
    console.error('CRON_SECRET non impostato: la funzione resta chiusa.');
    return new Response('no', { status: 503 });
  }
  if (req.headers.get('x-cron-secret') !== segretoCron) {
    return new Response('no', { status: 401 });
  }

  // 1. Le partenze fra un'ora. La funzione e' idempotente: rilanciarla non duplica niente.
  const { error: erroreCoda } = await db.rpc('accoda_partenze_imminenti');
  if (erroreCoda) console.error('accoda_partenze_imminenti:', erroreCoda.message);

  // 2. La coda. Poche righe per giro: se ce ne fossero tante, il giro dopo arriva fra dieci
  //    minuti e nel frattempo la funzione non resta appesa oltre il suo tempo massimo.
  const { data: righe, error } = await db
    .from('notifiche_coda')
    .select('id, destinatario, tipo, titolo, corpo')
    .is('inviata_il', null)
    .order('creata_il', { ascending: true })
    .limit(100);

  if (error) return new Response(error.message, { status: 500 });
  if (!righe?.length) return Response.json({ inviate: 0, coda: 0 });

  const destinatari = [...new Set(righe.map((r) => r.destinatario))];
  const { data: iscrizioni } = await db
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', destinatari);

  const perUtente = new Map<string, typeof iscrizioni>();
  for (const i of iscrizioni ?? []) {
    if (!perUtente.has(i.user_id)) perUtente.set(i.user_id, []);
    perUtente.get(i.user_id)!.push(i);
  }

  let inviate = 0;
  const morte: string[] = [];

  for (const riga of righe) {
    const dispositivi = perUtente.get(riga.destinatario) ?? [];
    // Nessun dispositivo iscritto non e' un errore: la riga si chiude comunque, altrimenti
    // resterebbe in coda per sempre e verrebbe mandata il giorno che quella persona si
    // iscrive — cioe' una notifica su un passaggio di settimane prima.
    for (const d of dispositivi) {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          JSON.stringify({ titolo: riga.titolo, corpo: riga.corpo, tipo: riga.tipo, url: '/' }),
        );
        inviate++;
      } catch (e) {
        const stato = (e as { statusCode?: number }).statusCode;
        // 404 e 410: quell'endpoint non esiste piu' (app disinstallata, permesso revocato).
        // Si cancella, altrimenti si riprova a ogni giro per sempre.
        if (stato === 404 || stato === 410) morte.push(d.id);
        else console.error('push fallita:', stato, (e as Error).message);
      }
    }
    await db.from('notifiche_coda')
      .update({ inviata_il: new Date().toISOString() })
      .eq('id', riga.id);
  }

  if (morte.length) await db.from('push_subscriptions').delete().in('id', morte);

  return Response.json({ inviate, righe: righe.length, iscrizioni_rimosse: morte.length });
});
