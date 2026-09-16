/**
 * Where the bytes go.
 *
 * A port, so the VPS's local disk is a choice rather than an assumption. If
 * this ever moves to object storage the only thing that changes is the adapter
 * — the upload use case, the hashing, the derivative ladder and the URL shape
 * all stay put.
 */
export interface MediaStorage {
  /**
   * Writes bytes at a path relative to the media root.
   *
   * Content-addressed paths make this idempotent: re-writing the same path
   * with the same bytes is a no-op, so a retried upload cannot corrupt
   * anything.
   */
  put(path: string, bytes: Buffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Buffer | null>;
  delete(path: string): Promise<boolean>;
  /**
   * Free space on the volume holding the media root, in bytes.
   *
   * Uploads are refused below a floor. On a single-disk VPS the images share a
   * spindle with Postgres, and a disk filled by a careless bulk upload does not
   * produce a failed upload — it produces a database that cannot write its WAL
   * and an application that is simply down. Failing the upload is the cheap
   * outcome, so the check is mandatory rather than advisory.
   */
  freeBytes(): Promise<number>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
