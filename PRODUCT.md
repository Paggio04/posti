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

## Design Principles

1. **La tipografia fa il lavoro, non la decorazione.** Se un elemento si capisce grazie a un
   gradiente o a un'ombra, non si è capito: si riscrive con dimensione, peso e spazio.
2. **Il movimento dice lo stato, o non c'è.** Il tondo della navigazione si sposta sulla scheda
   attiva perché indica dove sei. Niente si muove per fare scena.
3. **L'auto è la protagonista.** L'SVG dei sedili è l'unica cosa qui dentro che nessun altro ha:
   è disegnata su misura per questo problema, e deve essere la prima cosa che si vede.
4. **Riferimento fisico, non digitale**: un tabellone degli orari, un biglietto, un cartello. La
   profondità finta non serve a un'informazione che si legge in tre secondi.
5. **Un accento solo, e deciso.** Un colore che significa "questo puoi toccarlo, questo è il tuo
   stato". Tutto il resto è inchiostro, carta e una riga di bordo.

## Accessibility & Inclusion

WCAG **AA** come soglia verificata, non dichiarata: 4.5:1 sul testo, 3:1 su titoli grandi e
elementi non testuali, e i rapporti si calcolano invece di stimarli a occhio.

`prefers-reduced-motion` non spegne l'informazione: dove il movimento indica uno stato, lo stato
cambia **di scatto** invece di scomparire. Un'animazione che porta significato non si può
semplicemente togliere, si può solo rendere istantanea.

Gli stati non si dicono col colore da solo: posto libero, occupato e tuo si distinguono anche per
forma o etichetta, perché un'auto piena e un'auto vuota non possono dipendere dal rosso e dal
verde.
