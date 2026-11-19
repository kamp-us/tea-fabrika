# The library turns an app's choices into a running instance

libfabrika offers one entry, `Fabrika.make` (the entry 0601 calls `fabrika.run(checklist)`, one entry, not two), that turns an app's choices (which programs, settings, window and Layers) into a running instance. The brain's Durable Object classes and the deploy stack live in the library behind it, and the app keeps only choices, so a second client is not a fork of the first app.
