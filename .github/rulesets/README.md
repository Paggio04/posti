# Protezione del ramo `main`

`main` è il deploy: quello che ci finisce dentro è online in un minuto. Questa cartella tiene la
protezione in un file versionato invece che nella memoria di chi l'ha configurata a mano.

## Come si applica

GitHub non legge questo file da solo — va importato una volta:

**Settings → Rules → Rulesets → New ruleset → Import a ruleset**, e si carica `main.json`.

Da lì in poi il pannello è la fonte di verità; se la si cambia lì, si riesporta qui
(**⋯ → Export ruleset**) così il repo resta allineato.

## Cosa impone

| Regola | Effetto |
|---|---|
| `required_status_checks` | Niente merge finché `checks`, `schema` ed `e2e-anteprima` non sono verdi. I nomi sono quelli dei job in `.github/workflows/ci.yml`: se un job viene rinominato lì, va rinominato anche qui. |
| `deletion` | `main` non si cancella. |
| `non_fast_forward` | Niente force-push su `main`: la storia di ciò che è stato pubblicato non si riscrive. |

`bypass_actors` è vuoto di proposito: senza eccezioni la regola vale anche per il proprietario del
repo, che qui è l'unico che scrive. Con un'eccezione per gli amministratori non fermerebbe nessuno.
Per un merge d'emergenza si mette il ruleset in `Disabled` per il tempo che serve.

Perché questi controlli e non altri: `docs/ROADMAP.md`, cantiere C1.
