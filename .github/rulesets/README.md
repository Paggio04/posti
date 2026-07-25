# Protezione del ramo `main`

`main` è il deploy: quello che ci finisce dentro è online in un minuto.

**La protezione è attiva** dal 25/07/2026 (ruleset `Claude`, creato dal pannello dieci minuti dopo
la pubblicazione della PR #1). `main.json` è la **copia versionata** di quella configurazione, non
qualcosa da applicare: serve a poterla leggere in un diff, e a ricrearla identica se sparisce.

## Cosa impone

| Regola | Effetto |
|---|---|
| `required_status_checks` | Niente merge finché `checks`, `schema` ed `e2e-anteprima` non sono verdi. I nomi sono quelli dei job in `.github/workflows/ci.yml`: se un job viene rinominato lì, il controllo obbligatorio resta appeso a un nome che non esiste più e **smette di proteggere senza dirlo**. Vanno cambiati insieme. |
| `deletion` | `main` non si cancella. |
| `non_fast_forward` | Niente force-push su `main`: la storia di ciò che è stato pubblicato non si riscrive. |

`bypass_actors` è vuoto: la regola vale anche per il proprietario del repo, che qui è l'unico che
scrive (`current_user_can_bypass: never`). Per un merge d'emergenza si mette il ruleset in
`Disabled` per il tempo che serve, e lo si rimette attivo dopo.

`integration_id: 15368` è GitHub Actions: lega il controllo a chi lo pubblica, così un servizio
esterno non può soddisfarlo al posto suo.

## Tenerlo allineato

Il pannello è la fonte di verità; questo file è la copia. Se la protezione cambia:

- si riesporta da **Settings → Rules → Rulesets → `Claude` → ⋯ → Export ruleset** e si sostituisce
  `main.json`;
- oppure `curl -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/Paggio04/posti/rulesets/19714986`.

Nella direzione opposta (file → pannello) si usa **New ruleset → Import a ruleset**, che però ne
crea uno **nuovo**: se quello esistente è ancora lì, se ne ritrovano due sovrapposti.

Perché questi controlli e non altri: `docs/ROADMAP.md`, cantiere C1.
