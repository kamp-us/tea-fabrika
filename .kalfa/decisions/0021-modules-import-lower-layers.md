# libfabrika's modules import only from lower layers

A folder in libfabrika is a module with one subject, and its layer is one line in a rule file, so moving a module changes one line and no path. A module imports only from lower layers, never from a higher one and never from another module on its own layer; if two peers need each other, one moves down a layer in the open. `pnpm lint` checks both directions.
