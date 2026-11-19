# The desk is one platform-free core, and its state lives in the brain

The desktop is one core with Electron, browser and headless backends, so it runs in a browser tab too. Every window dials the brain over a WebSocket, and the desk's own state (tiles, focus, layout) is a process in the brain, like a tmux server any client attaches to.
