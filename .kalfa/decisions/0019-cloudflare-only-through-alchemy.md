# Cloudflare is reached only through Alchemy

`next/` code never imports `cloudflare:*`, miniflare, workerd or wrangler, or uses raw platform types; everything, cloud and laptop alike, goes through Alchemy. A Durable Object class is an empty Alchemy class plus a `.make()` Layer that returns a plain service's methods, so the logic also runs on Node in tests. A gap in Alchemy is patched locally and reported upstream, never written around, because plain Worker classes need a Promise edge on every method.
