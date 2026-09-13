/**
 * `node-zklib`, narrowed to the three calls we are allowed to make.
 *
 * The package ships no types. Declaring them here is necessary, and the shape
 * of the declaration is a third guard on top of the two in
 * `fingerprint.readonly.test.ts`: the class really does carry
 * `clearAttendanceLog()`, `disableDevice()` and `executeCmd()`, and none of
 * them is declared below. Reaching for one does not fail a test — it fails to
 * compile, which is sooner and harder to argue with.
 *
 * Pinned at 1.3.0. If that ever moves, this file is the first place the change
 * will be felt.
 */
declare module "node-zklib" {
  export default class ZKLib {
    constructor(ip: string, port: number, timeout: number, inport: number);
    /**
     * Open the conversation.
     *
     * **`cbErr` is not optional in practice.** The library reports a socket
     * failure by emitting an `error` event, and an `error` event with no
     * listener is not a rejected promise — Node rethrows it as an uncaught
     * exception. Omitting this callback is how one unreachable machine killed
     * the whole API on 2026-09-12.
     */
    createSocket(
      cbErr?: (error: unknown) => void,
      cbClose?: (type: string) => void
    ): Promise<unknown>;
    /** Counts only — users, records, capacity. Reads nothing about a person. */
    getInfo(): Promise<{
      userCounts?: number;
      logCounts?: number;
      logCapacity?: number;
    }>;
    /** Close it. Always called, never allowed to throw out of a `finally`. */
    disconnect(): Promise<unknown>;

    /*
     * The two transports, exposed only far enough to reach their sockets.
     *
     * Both of the library's `createSocket` implementations listen with
     * `once('error', ...)`. Once is not enough: the listener is spent on the
     * first failure, and the *second* — `disconnect()` sending CMD_EXIT down
     * the same dead socket — arrives unheard and crashes the process. We
     * attach a lasting listener of our own, which is the only way to do it
     * without patching the package.
     *
     * Optional and readonly on purpose: this is a reach into somebody else's
     * internals, and it may be gone the day 1.3.0 moves.
     */
    readonly zklibTcp?: { socket?: SocketWithErrors | null };
    readonly zklibUdp?: { socket?: SocketWithErrors | null };
  }

  /** As much of a net/dgram socket as staying alive requires. */
  export interface SocketWithErrors {
    on(event: "error", listener: (error: unknown) => void): unknown;
    listenerCount(event: string): number;
  }
}

/**
 * The TCP transport on its own, for the live session.
 *
 * The live listener talks to the socket directly rather than through `ZKLib`,
 * because every method that would send a command for us — `connect()`,
 * `enableDevice()`, `getRealTimeLogs()` — routes through `executeCmd`, a
 * function that forwards an arbitrary command and would defeat every guard we
 * have. We build the four packets we are allowed to send ourselves.
 *
 * Declared without `executeCmd`, `disconnect`, `clearAttendanceLog` or any
 * other method for the same reason the main class is: what is not declared
 * cannot be called.
 */
declare module "node-zklib/zklibtcp" {
  export default class ZKLibTCP {
    constructor(ip: string, port: number, timeout: number);
    /** Opens the TCP socket only. No protocol handshake happens here. */
    createSocket(
      cbErr?: (error: unknown) => void,
      cbClose?: (type: string) => void
    ): Promise<unknown>;
    readonly socket?: ZkSocket | null;
  }

  /** As much of a `net.Socket` as a live session needs. */
  export interface ZkSocket {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
    on(event: "error", listener: (error: unknown) => void): unknown;
    on(event: "close", listener: () => void): unknown;
    once(event: "data", listener: (chunk: Buffer) => void): unknown;
    off(event: "data", listener: (chunk: Buffer) => void): unknown;
    write(data: Buffer): unknown;
    destroy(): unknown;
    listenerCount(event: string): number;
  }
}

/**
 * The two pure functions we borrow: one frames a packet, one reads an event.
 *
 * Neither sends anything. Writing our own framing would be a second
 * implementation of somebody else's wire format, and getting it subtly wrong
 * is how a tap is read as the wrong person.
 */
declare module "node-zklib/utils" {
  export function createTCPHeader(
    command: number,
    sessionId: number,
    replyId: number,
    data: Buffer | string
  ): Buffer;

  /**
   * A real-time attendance frame.
   *
   * `attTime` is built from the machine's wall-clock fields as though they were
   * UTC, so a tap at 18:49:41 local arrives as `...T10:49:41.000Z`. Read it
   * back with the UTC getters to recover what the machine actually said.
   */
  export function decodeRecordRealTimeLog52(data: Buffer): {
    userId: string;
    attTime: Date;
  };
}
