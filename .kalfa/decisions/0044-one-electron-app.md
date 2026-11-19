# The app is one Electron app

The fabrika app is an Electron app, and only one copy runs. We rejected a local web page because it needed a port, a secret and an `Origin` check, and Electron needs none. Safety follows Electron's own checklist: a sandboxed window with no Node, a preload with a few named calls, and only the app's own files.
