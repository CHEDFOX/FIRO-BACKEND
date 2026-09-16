import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { DerivedVariant, ImageFacts, ImageProcessor } from '../../domain/image-processor';
import { VARIANT_FORMAT } from '../../domain/media-asset';

/** Balance point for photographs: visually clean, roughly a third of JPEG size. */
const WEBP_QUALITY = 82;

/**
 * Guard against decompression bombs — a 3KB file that expands to 40 000 ×
 * 40 000 pixels and exhausts memory. sharp needs to be told the ceiling; it
 * will not guess one.
 */
const MAX_PIXELS = 80_000_000; // ~8000 × 10000, far above any real photograph

@Injectable()
export class SharpImageProcessor implements ImageProcessor {
  private readonly logger = new Logger(SharpImageProcessor.name);

  async inspect(bytes: Buffer): Promise<ImageFacts | null> {
    try {
      const pipeline = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
      const metadata = await pipeline.metadata();

      if (!metadata.format || !metadata.width || !metadata.height) {
        return null;
      }

      // `stats()` fully decodes the image, which is also the point: it proves
      // the file is a real image rather than a header with garbage behind it.
      const stats = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).stats();
      const { r, g, b } = stats.dominant;

      // EXIF orientation means the stored width/height can be the transposed
      // ones. autoOrient resolves it so the recorded dimensions match what a
      // viewer will actually see.
      const oriented = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).autoOrient().metadata();

      return {
        format: metadata.format,
        width: oriented.width ?? metadata.width,
        height: oriented.height ?? metadata.height,
        dominantColor: toHex(r, g, b),
      };
    } catch (error) {
      this.logger.debug(
        `rejected an upload: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async derive(bytes: Buffer, width: number): Promise<DerivedVariant> {
    const output = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
      // Honour EXIF rotation before resizing, or a portrait phone photo comes
      // out sideways.
      .autoOrient()
      // `withoutEnlargement` keeps a small source from being blown up into a
      // larger, blurrier file.
      .resize({ width, withoutEnlargement: true, fit: 'inside' })
      // Strips EXIF by default, which removes the GPS coordinates and camera
      // serial numbers that come with a photograph — we are publishing these
      // publicly, and that metadata is not ours to publish.
      .toFormat(VARIANT_FORMAT, { quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      width: output.info.width,
      height: output.info.height,
      bytes: output.info.size,
      data: output.data,
    };
  }
}

function toHex(r: number, g: number, b: number): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
