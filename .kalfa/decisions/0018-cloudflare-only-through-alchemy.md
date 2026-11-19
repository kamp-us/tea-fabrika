# Cloudflare is reached only through Alchemy

`next/` code never imports `cloudflare:*`, miniflare, workerd or wrangler, or uses raw platform types; everything, cloud and laptop alike, goes through Alchemy. A gap in Alchemy is patched locally and reported upstream, never answered by hand-writing the piece, because a young library is a reason to file issues, not to build around it.
