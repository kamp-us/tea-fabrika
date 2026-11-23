/**
 * The frame, the one piece of text that crosses a socket.
 */

/**
 * One piece of text on a socket, holding one message of the format.
 *
 * **Details**
 *
 * Any text read from a socket is a frame, whether it is a message of the format or not. A frame that is no message fails `Transport.decode` with a `FormatError`.
 *
 * @category models
 */
export type Frame = string;
