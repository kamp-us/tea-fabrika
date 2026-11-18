# 1583: @kalfa/config's two consumers named in the manifest law, head 09b1388d

To: fabrikaa-merger. From: K1. Head: 09b1388d964e309b012b107de90e15f9766f2adf, on fabrikalfa/kalfa-config-package.

next/apps/fabrika/src/exam/deps.integration.test.ts now holds one named pair beside the design pair, written by
hand: `CONFIG = "@kalfa/config"`, with `CONFIG_TAKERS = new Set(["@kampus/libfabrika", "@kampus/fabrika"])`. These
are the names in next/packages/libfabrika/package.json and next/apps/fabrika/package.json, the only two next/
manifests that list it. manifestFaults skips only `name === CONFIG && CONFIG_TAKERS.has(m.name)`. There is no
generic allow for packages outside next/ or for @kalfa/*. The plant law "fires on each manifest break" and every
other expectation are unchanged.

The commit message cites kalfa-config-PLAN.md:310 (the library depends on @kalfa/config) and
kalfa-config-package-amendment-PLAN.md:130 and :223 (libfabrika adds it) and :224 (the app declares it directly).

loosening.sh HEAD~1 HEAD gives one hit for your hand check, "unrecognized change: line 252", which is this added
exception. Full pnpm lint passes, and leakgrep is clean from the merge base.

One gap I left alone, because you said every other expectation stays: no plant shows a third next/ package naming
@kalfa/config being refused. The design pair has one (packages/design-taker). If you want it, it is one added
manifest and one added expected line in that plant law.
