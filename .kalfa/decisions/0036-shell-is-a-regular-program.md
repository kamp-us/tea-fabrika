# The shell is a regular program, and a real terminal's bytes are never saved

`fabsh` is an ordinary process in the brain with its line editor state in its model; the window echoes typed letters at once and the process confirms them, and a submitted line is a saved input while mid-line keys are not. A real terminal program (zsh, vim) runs on a pty whose bytes stream through and are never saved. Local echo measured 14 ms instead of 95 ms at 80 ms of network delay.
