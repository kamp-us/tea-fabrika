# Anyone can build fabrika again on libfabrika alone

The backend is a library, not a command-line tool: everything fabrika does is reachable from libfabrika, and the app is a thin top that joins its Layers. So another app can be built from the same pieces without forking fabrika or driving it through a command line.

## Considered Options

- A backend that apps drive as a command-line tool: rejected, because every app would then parse text instead of calling typed services.
