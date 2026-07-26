// Config Supabase — la anon key è pubblica per design (la sicurezza è nelle RLS policies)
export const SUPABASE_URL = 'https://ggjhvsnhzwapdulcjgkh.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_YYVtbp0ieGamsotE9vhIsQ_0Iw3sVXw';

// Chiave pubblica VAPID delle notifiche push (cantiere C13). È **pubblica per definizione**:
// il browser la manda al servizio push del produttore, e da sola non permette di spedire
// niente — a firmare è la chiave privata, che vive solo nei segreti della Edge Function e
// non entra qui. Finché questa riga è vuota, l'app non mostra nemmeno l'interruttore.
// Come si generano le due chiavi: supabase/README.md, sezione «Notifiche».
export const VAPID_PUBLIC_KEY = '';
