# Product

## Register

product

## Users

Una comitiva di amici che si organizza i passaggi in auto, e — dopo T2 — chi sta nella stessa
zona senza conoscere nessuno. Il contesto d'uso non è una scrivania: è in piedi, di corsa, con
una mano sola, spesso al buio davanti a un portone, cinque minuti prima di partire. Da qui in
avanti ogni scelta visiva si giudica in quella situazione, non su uno schermo grande e fermo.

Il lavoro da fare è uno e si legge in tre secondi: **chi guida oggi, e c'è posto per me.**

## Product Purpose

Chi guida pubblica la propria auto, gli altri prenotano un sedile preciso. Sostituisce il gruppo
di messaggi dove i passaggi si perdono fra cento messaggi. Funziona quando nessuno deve chiedere
"allora chi passa a prendermi?".

## Brand Personality

**Diretta, di paese, artigianale.** Parla come parla la comitiva — "chi guida oggi", "restano due
posti", "l'auto di Marco è piena" — e allo stesso tempo si vede che l'ha fatta una persona con
delle opinioni: scelte visibili, niente compromessi morbidi, cura anche dove nessuno guarda. Lo
stesso tono dei commenti nel codice e della roadmap. Mai il registro da prodotto: niente
"Bentornato", niente "Gestisci le tue preferenze".

## Anti-references

Scritte dal proprietario in D7, e sono la ragione per cui questo cantiere esiste: **il difetto non
è che sia brutta, è che sembra generata.** Aurora animata sull'accesso, nav flottante a pillola,
tutto arrotondato allo stesso raggio, animazioni a molla, gradienti morbidi decorativi, palette
morbida buona per qualsiasi cosa, stati vuoti con icona grigia centrata e frase gentile.

Due riflessi da evitare anche dopo aver tolto quelli sopra:

- **il secondo riflesso**: togliere l'aurora e finire in "Linear-like" — grigi, densità, calma —
  che è l'aspirazione predefinita di metà delle app;
- **il terzo**: dominio automobilistico → "terminal dark mode" da quadro strumenti.

### Cosa di questo elenco è stato scambiato, e da chi (10/09/2026)

Il restyling della fase 12 non è nato da questa pagina: il proprietario ha bocciato i due campioni
costruiti dalle anti-referenze e ha consegnato **un'immagine di riferimento** — una dashboard SaaS
chiara. Cioè lo standard di categoria, che è esattamente la cosa che l'elenco qui sopra vieta. La
scelta è sua e vale; quello che non vale è lasciare scritto il contrario di quello che il sito fa.

Scambiati, consapevolmente:

- **la palette morbida**: le due terzine di C53 sono pastello (`#F4FEFF` / `#A9C0E0` / `#0E2F76`
  alla luce) e non sono state scelte per essere ruvide, ma per reggere i rapporti nei due temi;
- **gli angoli arrotondati ovunque**: restano su **quattro** raggi dichiarati (6, 10, 16, 20px),
  non su uno solo, ma nel foglio non c'è più nessuno spigolo vivo;
- **i gradienti**: ne restano quattro, e nessuno decora — la perforazione a passo fisso, la luce
  sulla lamiera dell'auto e lo scheletro di caricamento. Il gradiente morbido dietro a un titolo
  resta vietato.

Non scambiati, e ancora banditi: aurora animata, nav flottante a pillola, animazioni a molla,
stati vuoti con icona grigia e frase gentile, e i due riflessi qui sopra.

## Design Principles

1. **La tipografia fa il lavoro, la decorazione non lo fa al posto suo.** Dimensione, peso e
   spazio vengono prima. L'ombra non è più vietata però: con la carta chiara a L 0,990 su un fondo
   a 0,999, una scheda **non si distingue per il riempimento** — la staccano il filo del bordo e
   l'ombra, ed è l'unico mestiere che hanno (C53). Al buio si torna al riempimento.
2. **Il movimento dice lo stato, o non c'è.** Il tondo della navigazione si sposta sulla scheda
   attiva perché indica dove sei. Niente si muove per fare scena.
3. **L'auto è la protagonista.** L'SVG dei sedili è l'unica cosa qui dentro che nessun altro ha:
   è disegnata su misura per questo problema, e deve essere la prima cosa che si vede.
4. **Il riferimento è una dashboard, e l'ha scelto il proprietario** (C51, decisione 4): pelle
   ovunque, Home e Riepilogo ricomposti sull'immagine consegnata. Il riferimento fisico —
   tabellone, biglietto, cartello — era la direzione dei due campioni bocciati; resta nei dettagli
   che hanno superato il cambio, come la perforazione e la targa, non nella composizione.
5. **Tre colori per tema, e ognuno ha un mestiere.** Carta, ciò che è tuo, e l'inchiostro che è
   anche ciò che si tocca; tutti gli altri 94 token sono **ricavati** da questi tre, non scelti.
   L'unico posto dove le tinte si moltiplicano sono le quattro pastiglie delle tessere del
   Riepilogo (C52), perché lì distinguono quattro conti diversi.

## Accessibility & Inclusion

WCAG **AA** come soglia verificata, non dichiarata: 4.5:1 sul testo, 3:1 su titoli grandi e
elementi non testuali, e i rapporti si calcolano invece di stimarli a occhio.

`prefers-reduced-motion` non spegne l'informazione: dove il movimento indica uno stato, lo stato
cambia **di scatto** invece di scomparire. Un'animazione che porta significato non si può
semplicemente togliere, si può solo rendere istantanea.

Gli stati non si dicono col colore da solo: posto libero, occupato e tuo si distinguono anche per
forma o etichetta, perché un'auto piena e un'auto vuota non possono dipendere dal rosso e dal
verde.
