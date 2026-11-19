# Each client signs in with its own key, granted by a person key

Every client (browser tab, app window, agent bridge) signs in with its own key, granted by a person key in SSHSIG's shape, and a revoke is one event. Every device a person owns holds an equal person key and is a root, as on Apple and Keybase, so dropping one device never drops another; tabs and agents hang under the device that let them in and drop with it. An agent never holds a person key, and a key is never let in because GitHub lists it for a login.
