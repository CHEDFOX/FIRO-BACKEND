import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { APP_CONFIG, type AppConfig } from '../../../../bootstrap/config';
import { AppError } from '../../../../shared/errors/app-error';
import type { MediaStorage } from '../../domain/media-storage';

/**
 * Images on the VPS's own disk, served by nginx.
 *
 * This is the deliberate choice for now: nginx serves static files far better
 * than Node ever will, Cloudflare's free tier in front provides the edge
 * caching that object storage would otherwise buy, and content-addressed
 * immutable paths mean everything can be cached forever. The MediaStorage port
 * is what makes it reversible.
 */
@Injectable()
export class LocalMediaStorage implements MediaStorage, OnModuleInit {
  private readonly logger = new Logger(LocalMediaStorage.name);
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = resolve(config.MEDIA_DIR);
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const free = await this.freeBytes();
    this.logger.log(`media root ${this.root} (${(free / 1_073_741_824).toFixed(1)}GB free)`);
  }

  async put(path: string, bytes: Buffer): Promise<void> {
    const absolute = this.absolute(path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.absolute(path));
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<Buffer | null> {
    try {
      return await readFile(this.absolute(path));
    } catch {
      return null;
    }
  }

  async delete(path: string): Promise<boolean> {
    const absolute = this.absolute(path);
    try {
      await stat(absolute);
    } catch {
      return false;
    }
    await rm(absolute, { force: true });
    return true;
  }

  async freeBytes(): Promise<number> {
    try {
      const fs = await statfs(this.root);
      return Number(fs.bsize) * Number(fs.bavail);
    } catch (error) {
      this.logger.warn(
        `could not read free space (${error instanceof Error ? error.message : error}); assuming none`,
      );
      // Zero means "refuse uploads". If the free-space check cannot run, the
      // safe answer is to stop writing rather than to write blindly next to a
      // database that needs the same disk.
      return 0;
    }
  }

  /**
   * Resolves a relative path inside the media root, and refuses anything that
   * escapes it.
   *
   * Every path this class receives is derived from a SHA-256 hash, so today
   * traversal is impossible by construction. The check is here because that is
   * a property of the *callers*, and the next caller — a serving route taking
   * a path from a URL — is exactly where `../../etc/passwd` would arrive.
   */
  private absolute(path: string): string {
    const candidate = resolve(join(this.root, normalize(path)));
    if (candidate !== this.root && !candidate.startsWith(this.root + sep)) {
      throw AppError.validation('media.invalid_path', 'That media path is not allowed.');
    }
    return candidate;
  }
}
