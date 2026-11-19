# Oxlint lints, oxfmt formats, and our rules are oxlint plugins

Oxlint lints and oxfmt formats the repo, and Biome is gone. Our custom rules are oxlint JS plugin rules that fire on the same lines they did under Biome, and the two tools together take about 1.5 seconds where Biome's step took about 12.7. CSS gets stylelint for now.

## Consequences

Oxlint does not read CSS or HTML, and oxfmt only formats CSS, so those rules are lost; CSS is the largest loss. JS plugins are alpha, so a rule file may need work when oxlint moves on; exact versions are pinned in the catalog, and the plants fail if a rule stops firing.
