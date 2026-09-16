/**
 * Media — the images the whole product rests on.
 *
 * Firo's premise is "inspire first", and a travel feed without photographs
 * cannot inspire anyone. This module owns getting an image in, deriving the
 * sizes the clients actually need, and handing back URLs that can be cached
 * forever.
 *
 * Two decisions shape everything here:
 *
 * 1. **Content-addressed storage.** A file is stored under the hash of its
 *    bytes, so the same photo uploaded twice is stored once, and a URL's
 *    contents can never change. That is what makes `Cache-Control: immutable`
 *    honest, and it means a CDN in front never needs invalidating.
 *
 * 2. **Derivatives at upload, never on request.** Resizing when the client
 *    asks looks convenient until a popular card resizes the same image for
 *    five hundred people at once and the single VPS falls over. The CPU is
 *    spent once, by an admin who is waiting for a form anyway.
 */

/** Widths generated for every upload, smallest first. */
export const VARIANT_WIDTHS = [400, 800, 1600] as const;

export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

/** The width a single-URL consumer gets when it does not pick one. */
export const DEFAULT_VARIANT_WIDTH: VariantWidth = 800;

/**
 * WebP only, no JPEG fallback.
 *
 * Every browser has supported it since 2020, as have iOS 14+ and Android 4.2+,
 * which is a wider floor than the app itself will ever have. A parallel JPEG
 * ladder would double storage and upload time to serve browsers no user has.
 */
export const VARIANT_FORMAT = 'webp';
export const VARIANT_CONTENT_TYPE = 'image/webp';

export interface MediaVariant {
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /** Path relative to the media root, e.g. "ab/cd/abcd…-800.webp". */
  readonly path: string;
}

export interface MediaAsset {
  readonly id: string;
  /** SHA-256 of the original bytes — the storage key and the dedupe key. */
  readonly sha256: string;
  readonly originalFilename: string | null;
  readonly originalContentType: string;
  readonly originalBytes: number;
  /** Path of the untouched upload. Kept as the master, never served. */
  readonly originalPath: string;
  readonly width: number;
  readonly height: number;
  /** Hex, from the image itself — the placeholder the client paints while loading. */
  readonly dominantColor: string;
  readonly variants: readonly MediaVariant[];
  readonly attribution: string | null;
  readonly alt: string | null;
  readonly uploadedBy: string;
  readonly createdAt: string;
}

/**
 * Where a hash lives on disk.
 *
 * Two levels of fan-out from the first four hex characters: a flat directory
 * with a million files is slow to list and unpleasant to back up, and 256
 * directories of 256 is plenty for anything this project will hold.
 */
export function storageDirectory(sha256: string): string {
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}`;
}

export function originalPathFor(sha256: string, extension: string): string {
  return `${storageDirectory(sha256)}/${sha256}-original.${extension}`;
}

export function variantPathFor(sha256: string, width: number): string {
  return `${storageDirectory(sha256)}/${sha256}-${width}.${VARIANT_FORMAT}`;
}

/** Absolute URL for a stored path, given the configured public prefix. */
export function urlFor(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path}`;
}

/**
 * The catalog's view of an asset.
 *
 * `url` stays a single string so every existing consumer keeps working;
 * `variants` is additive, for clients that can pick a width (a phone has no
 * business downloading the 1600px copy).
 */
export interface MediaRefProjection {
  readonly id: string;
  readonly url: string;
  readonly dominantColor: string;
  readonly width: number;
  readonly height: number;
  readonly attribution: string | null;
  readonly alt: string | null;
  readonly variants: readonly { readonly width: number; readonly url: string }[];
}

export function toMediaRef(asset: MediaAsset, baseUrl: string): MediaRefProjection {
  const preferred =
    asset.variants.find((variant) => variant.width === DEFAULT_VARIANT_WIDTH) ??
    asset.variants[asset.variants.length - 1];

  return {
    id: asset.id,
    url: preferred ? urlFor(baseUrl, preferred.path) : urlFor(baseUrl, asset.originalPath),
    dominantColor: asset.dominantColor,
    width: preferred?.width ?? asset.width,
    height: preferred?.height ?? asset.height,
    attribution: asset.attribution,
    alt: asset.alt,
    variants: asset.variants.map((variant) => ({
      width: variant.width,
      url: urlFor(baseUrl, variant.path),
    })),
  };
}

/**
 * Accepted upload types.
 *
 * An allowlist, not a denylist, and checked against the bytes rather than the
 * filename or the client's declared type — both of which the uploader
 * controls. SVG is deliberately absent: it is a document that can carry
 * script, and serving user-supplied SVG from the API's own origin is a
 * cross-site scripting hole, not an image feature.
 */
export const ACCEPTED_IMAGE_FORMATS: Readonly<Record<string, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  tiff: 'image/tiff',
  heif: 'image/heif',
};

export function extensionFor(format: string): string {
  return format === 'jpeg' ? 'jpg' : format;
}

/** Smaller than this and it cannot fill a card without looking broken. */
export const MIN_IMAGE_WIDTH = 800;
export const MIN_IMAGE_HEIGHT = 600;
