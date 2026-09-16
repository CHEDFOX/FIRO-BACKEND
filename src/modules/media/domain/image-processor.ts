import type { MediaVariant } from './media-asset';

export interface ImageFacts {
  readonly format: string;
  readonly width: number;
  readonly height: number;
  /** Hex, sampled from the image itself. */
  readonly dominantColor: string;
}

export interface DerivedVariant extends Omit<MediaVariant, 'path'> {
  readonly bytes: number;
  readonly data: Buffer;
}

/**
 * Port for image inspection and resizing.
 *
 * Behind a port because it is the one piece of this module that is a native
 * dependency: sharp ships prebuilt binaries per platform, and a port means an
 * environment where those will not install can substitute a pure-JS decoder or
 * an external service without the upload use case noticing.
 */
export interface ImageProcessor {
  /**
   * Reads format and dimensions FROM THE BYTES.
   *
   * Never from the filename or the client's Content-Type: both are supplied by
   * the uploader, so trusting them is how a .jpg that is really an HTML
   * document ends up being served from your own origin.
   *
   * Returns null when the bytes are not a decodable image.
   */
  inspect(bytes: Buffer): Promise<ImageFacts | null>;

  /**
   * Re-encodes to the variant format at the given width, preserving aspect
   * ratio and never enlarging — an upscaled 400px source is a blurry 1600px
   * file that costs bandwidth to deliver a worse picture.
   */
  derive(bytes: Buffer, width: number): Promise<DerivedVariant>;
}

export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR');
