# The desk is one platform-free core, and its state lives in the brain

The desktop is one core with Electron, browser and headless backends, every window dials the brain over a WebSocket, and the desk's own state (tiles, focus, layout) is a process in the brain, like a tmux server any client attaches to. Terminals and jobs live in the brain under ids that are never reused, and a tile attaches to one, so two tiles can show the same terminal, as in WezTerm and tmux.
