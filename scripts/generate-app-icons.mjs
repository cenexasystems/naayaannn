import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

/**
 * Safe Utility Script: generate-app-icons.mjs
 *
 * Generates every raster asset from the single master logo file public/naayan-logo.png:
 *  - PWA icons (standard + Android maskable with safe-zone padding)
 *  - iOS Apple Touch icon
 *  - Favicons
 *  - src/lib/logoBase64.ts (PNG data URI used by the PDF / thermal / print templates)
 *
 * To use the real logo later: replace public/naayan-logo.png (or the .svg/.jpg/.jpeg/.webp
 * variant of the same name) and run `npm run generate:icons`. No other code changes are needed.
 *
 * Safe to commit to GitHub (no secrets/credentials).
 */

const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CANDIDATES = ['png', 'svg', 'jpg', 'jpeg', 'webp'].map((ext) => path.join(PUBLIC_DIR, `naayan-logo.${ext}`));
const SRC_ICON = CANDIDATES.find((p) => fs.existsSync(p));
const BG = { r: 39, g: 39, b: 42, alpha: 1 };

async function main() {
  if (!SRC_ICON) {
    console.error(`Source logo not found. Expected one of:\n${CANDIDATES.join('\n')}`);
    process.exit(1);
  }
  console.log(`Using master logo: ${SRC_ICON}`);

  // Square icon with the logo contained inside `logoSize` and centred on the canvas.
  async function generateSquareIcon(canvasSize, logoSize, outputPath, background) {
    const logo = await sharp(SRC_ICON, { density: 384 })
      .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const offset = Math.round((canvasSize - logoSize) / 2);
    await sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: background || { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: logo, left: offset, top: offset }])
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
    console.log(`-> Generated ${path.basename(outputPath)} (${canvasSize}x${canvasSize})`);
  }

  // 1. Android Adaptive / PWA Maskable Icons (logo inside the ~70% safe zone on a solid background)
  await generateSquareIcon(512, 360, path.join(PUBLIC_DIR, 'naayan-icon-maskable-512.png'), BG);
  await generateSquareIcon(192, 135, path.join(PUBLIC_DIR, 'naayan-icon-maskable-192.png'), BG);

  // 2. Standard "any" icons
  await generateSquareIcon(512, 512, path.join(PUBLIC_DIR, 'naayan-icon-512.png'));
  await generateSquareIcon(192, 192, path.join(PUBLIC_DIR, 'naayan-icon-192.png'));
  await generateSquareIcon(512, 512, path.join(PUBLIC_DIR, 'naayan-icon.png'));

  // 3. Apple Touch Icon for iOS (opaque)
  await generateSquareIcon(180, 150, path.join(PUBLIC_DIR, 'apple-touch-icon.png'), BG);

  // 4. Favicons
  await generateSquareIcon(64, 64, path.join(PUBLIC_DIR, 'naayan-favicon.png'));
  await generateSquareIcon(64, 64, path.join(PUBLIC_DIR, 'favicon.png'));

  // 5. PNG data URI used by jsPDF / thermal / print templates
  const logoPng = await sharp(SRC_ICON, { density: 384 })
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(
    path.join(ROOT_DIR, 'src', 'lib', 'logoBase64.ts'),
    `export const LOGO_BASE64 = 'data:image/png;base64,${logoPng.toString('base64')}'\n`,
  );
  console.log('-> Generated src/lib/logoBase64.ts');

  console.log('\nAll NAAYAN PWA icons and print logo generated successfully.');
}

main().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
