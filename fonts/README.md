# Caratteri

IBM Plex Sans (400, 600, 700) e IBM Plex Mono (500), sottoinsieme latino, in `woff2`.
84 KB in tutto, `LICENSE` compresa: SIL Open Font License 1.1, che permette di ospitarli qui.

**Stanno nel repo e non su un CDN di terzi per due ragioni, non per gusto.** La prima e' C15:
la tipografia e' il modo piu' economico di avere un'identita', e finche' il carattere e'
quello che usano tutti l'interfaccia resta indistinguibile. La seconda e' l'informativa:
prenderli da Google Fonts vuol dire che il browser di chi apre l'app contatta Google, che
diventa un terzo a cui si dice chi sta usando WeTransport e da che indirizzo. `privacy.html`
elenca fra i responsabili solo Supabase e Netlify, e deve restare vero.

Ospitandoli qui si possono anche **togliere** due voci dalla CSP (`fonts.googleapis.com` da
`style-src`, `fonts.gstatic.com` da `font-src`) invece di aggiungerne: la stessa direzione di
D6, che vale per i font come per gli SDK.

Aggiornarli: scaricare il peso che serve da `@fontsource/ibm-plex-sans` (o `-mono`) e
aggiungere la sua `@font-face` in `style.css`. Nessun passo di build, come tutto il resto.
