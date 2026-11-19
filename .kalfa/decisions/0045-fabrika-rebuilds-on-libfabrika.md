# Anyone can build fabrika again on libfabrika alone

Anyone can take `@kampus/libfabrika` alone and build a client from scratch that works exactly like fabrika does; fabrika is one libfabrika client, the way Ghostty is one libghostty client. The backend is a library of typed Effect services that code imports, not a command-line tool that drivers and agents start as a separate process. The door, the ledger, the program runtime and the rules for who may write are all in the library, so a second client cannot drift from fabrika, and the app holds only fabrika's own choices: which programs, settings and Layers it hands in.

## Considered Options

- A backend that drivers and agents run as a command-line tool: rejected. In the first two live runs the machine started 60 and 83 separate command-line processes, more than half of them re-reading the same ticket state, and the wrapper had to map 31 exit codes by hand. A typed call can be checked by the compiler and faked in a test; printed text and exit codes cannot.

## Consequences

The test for any file in the app is whether a from-scratch client would have to write it again. If yes, it belongs in libfabrika; if no, it may stay in the app (its choices: which programs, which settings, its window).
