# Every protocol is one a browser tab can speak

Every protocol fabrika speaks is written so that a browser tab could speak it, so a protocol may not need anything a browser lacks: no Node, no Unix socket, no files, and no ping at the WebSocket level. The browser is the narrowest place a client can run, so a protocol a browser can speak runs in Node, in workerd, in a test, and on a phone, without changes. The backbone is cheap to keep open now and expensive to open later: a protocol that leans on a Unix socket or a key file works until the first browser client, and then every layer above it changes.

## Consequences

When a browser tab could not be a client of a design, the protocol changes, not the browser. CI gets one more test job, with a browser, once the protocol code exists, and a browser client needs its person to grant its key.
