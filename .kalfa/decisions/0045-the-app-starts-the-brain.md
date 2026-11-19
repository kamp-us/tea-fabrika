# A person only opens the app, and the app starts the brain

The brain (fabrika's server) is a process of its own: the app writes its launchd plist into its own home and starts it, so nothing of ours runs at login, and closing the window or quitting the app stops nothing. Quit waits until the launchd label is gone, because `bootout` returns early. A long agent run outlives the window this way, at the cost of a second process.
