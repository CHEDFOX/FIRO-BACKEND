import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../../bootstrap/config';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorKind } from '../../../shared/errors/error-codes';
import { uuidv7 } from '../../../shared/ids';
import {
  ACCEPTED_IMAGE_FORMATS,
  extensionFor,
  type MediaAsset,
  type MediaVariant,
  MIN_IMAGE_HEIGHT,
  MIN_IMAGE_WIDTH,
  originalPathFor,
  VARIANT_WIDTHS,
  variantPathFor,
} from '../domain/media-asset';
import {
  MEDIA_ASSET_REPOSITORY,
  type MediaAssetRepository,
} from '../domain/media-asset.repository';
import { MEDIA_STORAGE, type MediaStorage } from '../domain/media-storage';
import { IMAGE_PROCESSOR, type ImageProcessor } from '../domain/image-processor';

export interface UploadImageCommand {
  readonly bytes: Buffer;
  readonly filename: string | null;
  /** What the client claimed. Recorded, never trusted. */
  readonly declaredContentType: string | null;
  readonly alt?: string | null;
  readonly attribution?: string | null;
  readonly uploadedBy: string;
}

@Injectable()
export class UploadImageUseCase {
  private readonly logger = new Logger(UploadImageUseCase.name);

  constructor(
    @Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(IMAGE_PROCESSOR) private readonly images: ImageProcessor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(command: UploadImageCommand): Promise<{ asset: MediaAsset; deduped: boolean }> {
    if (command.bytes.length === 0) {
      throw AppError.validation('media.empty_upload', 'The uploaded file was empty.');
    }
    if (command.bytes.length > this.config.MEDIA_MAX_UPLOAD_BYTES) {
      throw AppError.validation(
        'media.too_large',
        `That file is ${mb(command.bytes.length)}MB. The limit is ${mb(
          this.config.MEDIA_MAX_UPLOAD_BYTES,
        )}MB — export it smaller rather than raising the limit, because every byte here is bandwidth on every view.`,
      );
    }

    // Dedupe before doing any work: the hash is cheap, decoding and three
    // re-encodes are not, and re-uploading the same photo is a normal mistake.
    const sha256 = createHash('sha256').update(command.bytes).digest('hex');
    const existing = await this.assets.findBySha256(sha256);
    if (existing) {
      return { asset: existing, deduped: true };
    }

    // The bytes decide what this is. A filename and a Content-Type are both
    // supplied by whoever is uploading.
    const facts = await this.images.inspect(command.bytes);
    if (!facts) {
      throw AppError.validation(
        'media.not_an_image',
        'That file could not be decoded as an image. Check it opens locally, and that it is not a RAW file — export a JPEG or WebP first.',
      );
    }

    const contentType = ACCEPTED_IMAGE_FORMATS[facts.format];
    if (!contentType) {
      throw AppError.validation(
        'media.unsupported_format',
        `${facts.format.toUpperCase()} is not accepted. Use JPEG, PNG, WebP, AVIF, TIFF or HEIF.`,
      );
    }
    if (facts.width < MIN_IMAGE_WIDTH || facts.height < MIN_IMAGE_HEIGHT) {
      throw AppError.validation(
        'media.too_small',
        `That image is ${facts.width}×${facts.height}. Firo needs at least ${MIN_IMAGE_WIDTH}×${MIN_IMAGE_HEIGHT} — anything smaller is visibly soft once it fills a card.`,
      );
    }

    // Space check before writing. On a single-disk VPS the images share a
    // volume with Postgres, so a disk filled by a bulk upload is not a failed
    // upload — it is a database that cannot write and an app that is down.
    const free = await this.storage.freeBytes();
    const needed = command.bytes.length * 2; // original plus the variant ladder
    if (free < this.config.MEDIA_MIN_FREE_BYTES + needed) {
      this.logger.error(
        `Refusing upload: ${mb(free)}MB free, floor is ${mb(this.config.MEDIA_MIN_FREE_BYTES)}MB.`,
      );
      // UNAVAILABLE (503, retryable) rather than a validation error: nothing is
      // wrong with the file, and the caller should try again after someone
      // frees space.
      throw AppError.of({
        kind: ErrorKind.UNAVAILABLE,
        code: 'media.disk_full',
        message:
          'The server is low on disk space, so uploads are paused to keep the database writable. Free space on the VPS and try again.',
      });
    }

    const extension = extensionFor(facts.format);
    const originalPath = originalPathFor(sha256, extension);

    // The variant ladder, skipping widths the source cannot fill: upscaling
    // produces a larger file carrying a blurrier picture.
    const widths = VARIANT_WIDTHS.filter((width) => width <= facts.width);
    if (widths.length === 0) {
      widths.push(VARIANT_WIDTHS[0]);
    }

    const written: string[] = [];
    const variants: MediaVariant[] = [];

    try {
      // The original is the master copy, kept so the ladder can be regenerated
      // if the design ever wants different widths. Never served.
      await this.storage.put(originalPath, command.bytes);
      written.push(originalPath);

      for (const width of widths) {
        const derived = await this.images.derive(command.bytes, width);
        const path = variantPathFor(sha256, derived.width);
        await this.storage.put(path, derived.data);
        written.push(path);
        variants.push({
          width: derived.width,
          height: derived.height,
          bytes: derived.bytes,
          path,
        });
      }
    } catch (error) {
      // A half-written ladder would leave an asset whose URLs 404. Roll the
      // files back; the row was never written, so there is nothing else to
      // undo.
      await Promise.all(written.map((path) => this.storage.delete(path).catch(() => false)));
      throw AppError.internal(
        'media.write_failed',
        'Could not store the image. Nothing was saved.',
        error,
      );
    }

    const asset: MediaAsset = {
      id: uuidv7(),
      sha256,
      originalFilename: command.filename,
      originalContentType: contentType,
      originalBytes: command.bytes.length,
      originalPath,
      width: facts.width,
      height: facts.height,
      dominantColor: facts.dominantColor,
      variants,
      attribution: command.attribution?.trim() || null,
      alt: command.alt?.trim() || null,
      uploadedBy: command.uploadedBy,
      createdAt: new Date().toISOString(),
    };

    await this.assets.save(asset);
    this.logger.log(
      `stored ${sha256.slice(0, 12)} (${facts.width}×${facts.height}, ${variants.length} variants, ${mb(
        command.bytes.length,
      )}MB original)`,
    );

    return { asset, deduped: false };
  }
}

function mb(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1);
}
