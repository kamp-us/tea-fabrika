/**
 * The Cloudflare entry point of `@kalfa/transport`: the gateway a Durable Object class mounts, and the seam to the platform under it.
 */
/**
 * The gateway service.
 *
 * @category services
 */
export {
  /**
   * The service a Durable Object class mounts to hold sockets that sleep.
   *
   * @category services
   */
  Gateway,
} from "./Gateway.ts";

export {
  /**
   * The service that accepts a socket the object may sleep with, and its Cloudflare Layer.
   *
   * @category services
   */
  Hibernation,
} from "./Hibernation.ts";

export type {
  /**
   * What a gateway needs of a held socket.
   *
   * @category models
   */
  HeldSocket,
} from "./Hibernation.ts";
