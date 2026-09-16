import type { Server } from 'node:http';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';

/**
 * Image upload and serving, end to end.
 *
 * Uses real bytes through the real encoder, into a real temporary directory,
 * because every interesting failure here is about bytes: a file that is not an
 * image, one that is too small, one that is the same as an earlier upload, and
 * a path that tries to escape the media root.
 */
describe('Media (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let mediaDir: string;
  let adminToken: string;
  let userToken: string;

  /**
   * Generous, because these tests do real image work: a few hundred thousand
   * pixels generated in JS and then WebP-encoded three times. Shrinking the
   * fixtures to fit a 5s default would stop them resembling photographs, which
   * is the only thing being tested.
   */
  const SLOW = 30_000;

  /** A photograph-like image: gradient plus noise, so it compresses realistically. */
  async function photo(width: number, height: number): Promise<Buffer> {
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 3;
        raw[index] = Math.min(255, 20 + (x / width) * 120 + Math.random() * 15);
        raw[index + 1] = Math.min(255, 60 + (y / height) * 90 + Math.random() * 15);
        raw[index + 2] = Math.min(255, 110 + (x / width) * 70 + Math.random() * 15);
      }
    }
    return sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  beforeAll(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), 'firo-media-test-'));
    process.env['MEDIA_DIR'] = mediaDir;
    process.env['API_BASE_URL'] = 'http://127.0.0.1:3000';
    process.env['ADMIN_EMAILS'] = 'media-admin@firo.app';
    delete process.env['MEDIA_BASE_URL'];

    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;

    const admin = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'media-admin@firo.app', password: 'sup3r-secret-pw', handle: 'media_admin' })
      .expect(201);
    adminToken = admin.body.data.tokens.accessToken;

    const user = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'media-user@firo.app', password: 'sup3r-secret-pw', handle: 'media_user' })
      .expect(201);
    userToken = user.body.data.tokens.accessToken;
  }, 45_000);

  afterAll(async () => {
    await app?.close();
    await rm(mediaDir, { recursive: true, force: true });
    delete process.env['MEDIA_DIR'];
    delete process.env['ADMIN_EMAILS'];
    delete process.env['API_BASE_URL'];
  });

  const upload = (bytes: Buffer, filename = 'photo.jpg') =>
    request(server)
      .post('/v1/admin/media')
      .set('authorization', `Bearer ${adminToken}`)
      .attach('file', bytes, filename);

  describe('access control', () => {
    it(
      'refuses an ordinary signed-in user',
      async () => {
        const res = await request(server)
          .post('/v1/admin/media')
          .set('authorization', `Bearer ${userToken}`)
          .attach('file', await photo(1200, 800), 'photo.jpg')
          .expect(403);
        expect(res.body.error.code).toBe('auth.insufficient_role');
      },
      SLOW,
    );

    it(
      'refuses an anonymous uploader',
      async () => {
        await request(server)
          .post('/v1/admin/media')
          .attach('file', await photo(1200, 800), 'photo.jpg')
          .expect(401);
      },
      SLOW,
    );
  });

  describe('uploading', () => {
    let firstUrl: string;
    let firstSha: string;
    let assetId: string;

    it(
      'accepts a photograph and derives the variant ladder',
      async () => {
        const res = await upload(await photo(2400, 1600), 'lofoten.jpg').expect(201);
        const { media, asset, deduped } = res.body.data;

        expect(deduped).toBe(false);
        expect(asset.width).toBe(2400);
        expect(asset.height).toBe(1600);
        expect(asset.originalContentType).toBe('image/jpeg');
        // 400, 800 and 1600 all fit inside a 2400px source.
        expect(asset.variants.map((v: { width: number }) => v.width)).toEqual([400, 800, 1600]);
        expect(media.variants).toHaveLength(3);

        firstUrl = media.url;
        firstSha = asset.sha256;
        assetId = asset.id;
      },
      SLOW,
    );

    // The colour is what the client paints while the photograph loads. A grey
    // rectangle is the difference between "loading" and "broken".
    it(
      'samples a dominant colour from the image itself',
      async () => {
        const res = await upload(await photo(1200, 900), 'colour.jpg').expect(201);
        expect(res.body.data.media.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
        expect(res.body.data.media.dominantColor).not.toBe('#000000');
      },
      SLOW,
    );

    it(
      're-encodes to WebP, smaller than the JPEG it came from',
      async () => {
        const original = await photo(2000, 1400);
        const res = await upload(original, 'compress.jpg').expect(201);
        const largest = res.body.data.asset.variants.at(-1);
        expect(largest.bytes).toBeLessThan(original.length);
        expect(largest.path.endsWith('.webp')).toBe(true);
      },
      SLOW,
    );

    it(
      'stores the same photo once, however many times it is uploaded',
      async () => {
        const bytes = await photo(1600, 1200);
        const first = await upload(bytes, 'again-a.jpg').expect(201);
        const second = await upload(bytes, 'again-b.jpg').expect(201);

        expect(first.body.data.deduped).toBe(false);
        expect(second.body.data.deduped).toBe(true);
        expect(second.body.data.asset.id).toBe(first.body.data.asset.id);
        expect(second.body.data.media.url).toBe(first.body.data.media.url);
      },
      SLOW,
    );

    it(
      'never upscales: a small source gets only the rungs it can fill',
      async () => {
        const res = await upload(await photo(900, 700), 'small.jpg').expect(201);
        const widths = res.body.data.asset.variants.map((v: { width: number }) => v.width);
        expect(widths).toEqual([400, 800]);
        expect(widths).not.toContain(1600);
      },
      SLOW,
    );

    it('writes the original and every variant to disk', async () => {
      const directory = join(mediaDir, firstSha.slice(0, 2), firstSha.slice(2, 4));
      const files = await readdir(directory);
      const mine = files.filter((file) => file.startsWith(firstSha));
      expect(mine).toHaveLength(4); // original + three variants
      expect(mine.some((file) => file.includes('-original.'))).toBe(true);
    });

    it('lists what has been uploaded', async () => {
      const res = await request(server)
        .get('/v1/admin/media?limit=50')
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.data.total).toBeGreaterThanOrEqual(4);
      expect(res.body.data.rows[0].url).toContain('/media/');
    });

    it('serves the exact url it handed back, cacheable forever', async () => {
      const path = firstUrl.replace('http://127.0.0.1:3000', '');
      const res = await request(server).get(path).expect(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['cache-control']).toContain('immutable');

      // And the bytes are a real, decodable image of the promised width.
      const meta = await sharp(res.body).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(800);
    });

    it('serves images to anonymous visitors, because inspiration precedes sign-up', async () => {
      const path = firstUrl.replace('http://127.0.0.1:3000', '');
      await request(server).get(path).expect(200);
    });

    it('deletes an unreferenced asset and removes its files', async () => {
      const directory = join(mediaDir, firstSha.slice(0, 2), firstSha.slice(2, 4));

      await request(server)
        .delete(`/v1/admin/media/${assetId}`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(204);

      const files = await readdir(directory).catch(() => []);
      expect(files.filter((file) => file.startsWith(firstSha))).toHaveLength(0);

      await request(server).get(firstUrl.replace('http://127.0.0.1:3000', '')).expect(404);
    });
  });

  describe('rejections', () => {
    it('rejects a text file named .jpg, because the bytes decide', async () => {
      const res = await upload(
        Buffer.from('<html><script>alert(1)</script></html>'),
        'evil.jpg',
      ).expect(400);
      expect(res.body.error.code).toBe('media.not_an_image');
    });

    it(
      'rejects an image too small to fill a card',
      async () => {
        const res = await upload(await photo(320, 240), 'tiny.jpg').expect(400);
        expect(res.body.error.code).toBe('media.too_small');
        expect(res.body.error.message).toContain('320×240');
      },
      SLOW,
    );

    it('rejects a request with no file', async () => {
      const res = await request(server)
        .post('/v1/admin/media')
        .set('authorization', `Bearer ${adminToken}`)
        .field('alt', 'nothing attached')
        .expect(400);
      expect(res.body.error.code).toBe('media.no_file');
    });

    it('rejects a non-multipart body', async () => {
      const res = await request(server)
        .post('/v1/admin/media')
        .set('authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://example.com/photo.jpg' })
        .expect(400);
      expect(res.body.error.code).toBe('media.not_multipart');
    });

    // The serving route is the one place a path arrives from outside, so it is
    // the one place traversal has to be impossible.
    it('cannot be walked out of the media root', async () => {
      for (const attempt of [
        '/media/../../../../etc/passwd',
        '/media/..%2f..%2f..%2fetc%2fpasswd',
        '/media/a1/../../../../etc/passwd',
      ]) {
        const res = await request(server).get(attempt);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(String(res.text ?? '')).not.toContain('root:');
      }
    });

    it('404s a file that was never stored', async () => {
      const res = await request(server).get('/media/aa/bb/missing-400.webp').expect(404);
      expect(res.body.error.code).toBe('media.file_not_found');
    });
  });

  describe('attaching an image to an experience', () => {
    it(
      'flows from upload into the catalogue and out to the public API',
      async () => {
        const uploaded = await upload(await photo(2000, 1300), 'attach.jpg').expect(201);
        const media = uploaded.body.data.media;

        const created = await request(server)
          .post('/v1/admin/content')
          .set('authorization', `Bearer ${adminToken}`)
          .send({
            placeId: 'plc_reine',
            slug: 'a-photographed-place',
            title: 'A photographed place',
            summary: 'This one has a real image attached to it, uploaded moments ago.',
            tags: ['cold', 'photography'],
            budgetBand: 'moderate',
            status: 'published',
            media: [
              {
                id: media.id,
                url: media.url,
                dominantColor: media.dominantColor,
                width: media.width,
                height: media.height,
                attribution: null,
              },
            ],
          })
          .expect(201);
        expect(created.body.data.media).toHaveLength(1);

        // The client sees it on the public endpoint...
        const publicView = await request(server)
          .get('/v1/experiences/a-photographed-place')
          .expect(200);
        const ref = publicView.body.data.experience.media[0];
        expect(ref.url).toBe(media.url);
        expect(ref.dominantColor).toBe(media.dominantColor);

        // ...and the url actually resolves to bytes.
        const image = await request(server)
          .get(ref.url.replace('http://127.0.0.1:3000', ''))
          .expect(200);
        expect((await sharp(image.body).metadata()).format).toBe('webp');

        // While it is in use, it cannot be deleted out from under the card.
        const refused = await request(server)
          .delete(`/v1/admin/media/${media.id}`)
          .set('authorization', `Bearer ${adminToken}`)
          .expect(409);
        expect(refused.body.error.code).toBe('media.still_in_use');
        expect(refused.body.error.message).toContain('1 experience');
      },
      SLOW,
    );
  });

  describe('the media directory', () => {
    it('never stores anything outside its own root', async () => {
      const entries = await readdir(mediaDir, { withFileTypes: true });
      for (const entry of entries) {
        expect(entry.isDirectory()).toBe(true);
        // Two hex characters: the first level of the hash fan-out.
        expect(entry.name).toMatch(/^[0-9a-f]{2}$/);
      }
      const info = await stat(mediaDir);
      expect(info.isDirectory()).toBe(true);
    });
  });
});
