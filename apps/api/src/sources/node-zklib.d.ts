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
    /** Open the conversation. Throws when the machine will not answer. */
    createSocket(): Promise<unknown>;
    /** Counts only — users, records, capacity. Reads nothing about a person. */
    getInfo(): Promise<{
      userCounts?: number;
      logCounts?: number;
      logCapacity?: number;
    }>;
    /** Close it. Always called, never allowed to throw out of a `finally`. */
    disconnect(): Promise<unknown>;
  }
}
