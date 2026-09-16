import {
  DEFAULT_VARIANT_WIDTH,
  extensionFor,
  type MediaAsset,
  originalPathFor,
  storageDirectory,
  toMediaRef,
  urlFor,
  VARIANT_WIDTHS,
  variantPathFor,
} from './media-asset';

const SHA = 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd';

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-1',
    sha256: SHA,
    originalFilename: 'lofoten.jpg',
    originalContentType: 'image/jpeg',
    originalBytes: 2_400_000,
    originalPath: originalPathFor(SHA, 'jpg'),
    width: 2400,
    height: 1600,
    dominantColor: '#1b2a3a',
    variants: VARIANT_WIDTHS.map((width) => ({
      width,
      height: Math.round((width / 2400) * 1600),
      bytes: width * 40,
      path: variantPathFor(SHA, width),
    })),
    attribution: 'Someone',
    alt: 'Red cabins under a blue sky',
    uploadedBy: 'user-1',
    createdAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('media asset paths and projection', () => {
  describe('storage layout', () => {
    it('fans a hash out over two directory levels', () => {
      expect(storageDirectory(SHA)).toBe('a1/b2');
    });

    it('puts the original and every variant in the same directory', () => {
      const directory = storageDirectory(SHA);
      expect(originalPathFor(SHA, 'jpg').startsWith(`${directory}/`)).toBe(true);
      for (const width of VARIANT_WIDTHS) {
        expect(variantPathFor(SHA, width).startsWith(`${directory}/`)).toBe(true);
      }
    });

    // Immutability is what makes a one-year cache header honest, and it holds
    // only because the filename contains the hash of the contents.
    it('gives different content different paths', () => {
      const other = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      expect(variantPathFor(SHA, 800)).not.toBe(variantPathFor(other, 800));
    });

    it('distinguishes variants by width, and the original from all of them', () => {
      const paths = new Set([
        originalPathFor(SHA, 'jpg'),
        ...VARIANT_WIDTHS.map((width) => variantPathFor(SHA, width)),
      ]);
      expect(paths.size).toBe(VARIANT_WIDTHS.length + 1);
    });

    it('normalises jpeg to the conventional extension', () => {
      expect(extensionFor('jpeg')).toBe('jpg');
      expect(extensionFor('png')).toBe('png');
      expect(extensionFor('webp')).toBe('webp');
    });
  });

  describe('urlFor', () => {
    it('joins without doubling the slash, however the base is written', () => {
      expect(urlFor('https://cdn.firo.app/media', 'a1/b2/x.webp')).toBe(
        'https://cdn.firo.app/media/a1/b2/x.webp',
      );
      expect(urlFor('https://cdn.firo.app/media/', 'a1/b2/x.webp')).toBe(
        'https://cdn.firo.app/media/a1/b2/x.webp',
      );
    });
  });

  describe('toMediaRef', () => {
    const base = 'https://cdn.firo.app/media';

    it('defaults the single url to the middle variant, not the largest', () => {
      const ref = toMediaRef(asset(), base);
      expect(ref.url).toContain(`-${DEFAULT_VARIANT_WIDTH}.webp`);
      expect(ref.width).toBe(DEFAULT_VARIANT_WIDTH);
    });

    it('exposes every variant so a phone need not download the 1600px copy', () => {
      const ref = toMediaRef(asset(), base);
      expect(ref.variants.map((variant) => variant.width)).toEqual([...VARIANT_WIDTHS]);
      for (const variant of ref.variants) {
        expect(variant.url.startsWith(base)).toBe(true);
      }
    });

    it('carries the dominant colour, so the client can paint before the image lands', () => {
      expect(toMediaRef(asset(), base).dominantColor).toBe('#1b2a3a');
    });

    it('falls back to the largest variant when the default width was never made', () => {
      // A source narrower than 800px produces only the 400px rung.
      const narrow = asset({
        variants: [{ width: 400, height: 267, bytes: 16_000, path: variantPathFor(SHA, 400) }],
      });
      const ref = toMediaRef(narrow, base);
      expect(ref.url).toContain('-400.webp');
      expect(ref.width).toBe(400);
    });

    // An asset whose ladder failed to generate should still render something
    // rather than producing an empty src attribute.
    it('falls back to the original when there are no variants at all', () => {
      const ref = toMediaRef(asset({ variants: [] }), base);
      expect(ref.url).toBe(`${base}/${originalPathFor(SHA, 'jpg')}`);
      expect(ref.variants).toEqual([]);
    });

    it('keeps alt text and attribution, which are the parts a human wrote', () => {
      const ref = toMediaRef(asset(), base);
      expect(ref.alt).toBe('Red cabins under a blue sky');
      expect(ref.attribution).toBe('Someone');
    });
  });
});
