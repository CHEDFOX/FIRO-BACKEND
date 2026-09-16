import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../../../bootstrap/config';
import { AppError } from '../../../../shared/errors/app-error';
import { RawResponse } from '../../../../shared/http/raw-response.decorator';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import { Role } from '../../../identity/domain/role';
import type { AuthenticatedUser } from '../../../identity/infrastructure/http/authenticated-user';
import { CurrentUser, Public, Roles } from '../../../identity/infrastructure/http/decorators';
import { JwtAuthGuard } from '../../../identity/infrastructure/http/jwt-auth.guard';
import { RolesGuard } from '../../../identity/infrastructure/http/roles.guard';
import {
  DeleteMediaUseCase,
  GetMediaUseCase,
  ListMediaUseCase,
  ServeMediaUseCase,
} from '../../application/media.usecases';
import { UploadImageUseCase } from '../../application/upload-image.usecase';
import { toMediaRef } from '../../domain/media-asset';
import { MediaListQuerySchema, type MediaListQueryInput } from './media.dto';

/** A year, which is safe only because paths are content-addressed. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/**
 * The image library, as the console sees it.
 *
 * Under /v1/admin like the rest of the console, because uploading and deleting
 * images is an operator action, not a product feature. Serving lives in the
 * separate controller below.
 */
@Controller('admin/media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminMediaController {
  constructor(
    private readonly upload: UploadImageUseCase,
    private readonly listMedia: ListMediaUseCase,
    private readonly getMedia: GetMediaUseCase,
    private readonly deleteMedia: DeleteMediaUseCase,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Multipart upload of a single image.
   *
   * Reads the file through Fastify's multipart parser rather than a Nest
   * interceptor: the Fastify adapter has no multer, and going straight to the
   * underlying request keeps the size limit enforced by the parser instead of
   * after a large body is already in memory.
   */
  @Post()
  @HttpCode(201)
  async uploadImage(@Req() request: FastifyRequest, @CurrentUser() principal: AuthenticatedUser) {
    if (!request.isMultipart()) {
      throw AppError.validation(
        'media.not_multipart',
        'Send the image as multipart/form-data with a "file" field.',
      );
    }

    const file = await request.file({
      limits: { fileSize: this.config.MEDIA_MAX_UPLOAD_BYTES },
    });
    if (!file) {
      throw AppError.validation('media.no_file', 'No file was included in the upload.');
    }

    const bytes = await file.toBuffer();
    // The parser truncates rather than throwing when the limit is hit, so a
    // silently half-read file would otherwise be stored as a corrupt image.
    if (file.file.truncated) {
      throw AppError.validation(
        'media.too_large',
        `That file exceeds the ${(this.config.MEDIA_MAX_UPLOAD_BYTES / 1_048_576).toFixed(
          0,
        )}MB limit.`,
      );
    }

    const result = await this.upload.execute({
      bytes,
      filename: file.filename ?? null,
      declaredContentType: file.mimetype ?? null,
      alt: readField(file, 'alt'),
      attribution: readField(file, 'attribution'),
      uploadedBy: principal.userId,
    });

    return {
      // Ready to drop straight into an experience's `media` array.
      media: toMediaRef(result.asset, this.config.mediaBaseUrl),
      asset: result.asset,
      // Honest about having stored nothing: the same photo was already here.
      deduped: result.deduped,
    };
  }

  @Get()
  async list(@Query(new ZodValidationPipe(MediaListQuerySchema)) query: MediaListQueryInput) {
    const page = await this.listMedia.execute({
      limit: query.limit,
      offset: query.offset,
      search: query.search,
    });
    return { rows: page.rows, assets: page.raw.rows, total: page.total };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.getMedia.execute(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.deleteMedia.execute(id);
  }
}

/**
 * Serves the stored bytes.
 *
 * Deliberately at `/media/...` with **no `/v1` prefix**: these are static
 * assets, not a versioned API, and — more importantly — the URL is written
 * into the database when an image is attached to an experience. If the path
 * differed between "the API served it" and "nginx served it", every stored URL
 * would break the moment nginx went in front. It does not, so they do not.
 *
 * **In production nginx answers these directly** and this handler is never
 * reached; Node has no business in the path of an image byte. It exists so the
 * app is complete on its own in development and on a first deploy.
 */
@Controller('media')
export class MediaFileController {
  constructor(private readonly serveMedia: ServeMediaUseCase) {}

  /**
   * The wildcard goes to the storage adapter, which rejects anything escaping
   * the media root. That check lives there rather than here because this is
   * exactly the route where `../../etc/passwd` arrives.
   */
  @Get('*')
  @Public()
  @RawResponse()
  async serve(@Param('*') path: string, @Res() reply: FastifyReply): Promise<void> {
    const file = await this.serveMedia.execute(path);
    await reply
      .header('content-type', file.contentType)
      .header('cache-control', IMMUTABLE_CACHE)
      // Cross-origin by design: the web client and the app are on other hosts,
      // and these are public images.
      .header('access-control-allow-origin', '*')
      .send(file.bytes);
  }
}

/**
 * Reads a sibling text field from the same multipart body.
 *
 * A field can arrive repeated, in which case the parser hands back an array;
 * the first one wins rather than the request failing over something cosmetic.
 */
function readField(file: MultipartFile, name: string): string | null {
  const field = file.fields[name];
  const first = Array.isArray(field) ? field[0] : field;
  if (!first || first.type !== 'field') {
    return null;
  }
  const value = first.value;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
