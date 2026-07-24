/**
 * generate-favicon.js
 * 
 * Extracts the icon graphic from the existing logo and generates all favicon sizes.
 * The logo is 600x200 with the text on the left and the icon on the right.
 * We extract the right portion (approximately the rightmost 200px of a 600x200 image)
 * to get a square icon, then generate all required sizes.
 * 
 * The user attached the icon separately — we use the right half of logo.png
 * which contains the SMC icon graphic (two figures + bar chart + arrow).
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SRC = path.resolve("public/logo.png");
const OUT_PUBLIC = path.resolve("public");
const OUT_APP    = path.resolve("src/app");

async function main() {
  // Read source logo metadata
  const meta = await sharp(SRC).metadata();
  const { width, height } = meta;
  console.log(`Source logo: ${width}x${height}`);

  // The logo is 600x200:
  // - Left ~310px = text ("SHAABI" + "MANAGEMENT CONSULTANCY")
  // - Right ~290px = icon graphic (two figures + bar chart)
  // Extract the right portion as a square crop for the favicon icon
  const iconLeft   = Math.round(width * 0.47); // start at ~47% across
  const iconWidth  = width - iconLeft;          // ~53% of width
  const iconHeight = height;
  
  // Pad to square using the larger dimension (iconWidth or iconHeight)
  const squareSize = Math.max(iconWidth, iconHeight);
  const padLeft    = Math.round((squareSize - iconWidth) / 2);
  const padTop     = Math.round((squareSize - iconHeight) / 2);

  // Extract icon crop and pad to square with transparent background
  const squareIconBuffer = await sharp(SRC)
    .extract({ left: iconLeft, top: 0, width: iconWidth, height: iconHeight })
    .extend({
      top:    padTop,
      bottom: squareSize - iconHeight - padTop,
      left:   padLeft,
      right:  squareSize - iconWidth - padLeft,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  console.log(`Icon crop: ${iconWidth}x${iconHeight} → padded to ${squareSize}x${squareSize}`);

  // ─── Generate all sizes ───────────────────────────────────────────────────
  const sizes = [16, 32, 48, 64, 180, 192, 512];

  for (const size of sizes) {
    const buf = await sharp(squareIconBuffer).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const outPath = path.join(OUT_PUBLIC, `favicon-${size}.png`);
    fs.writeFileSync(outPath, buf);
    console.log(`  ✓ ${outPath}`);
  }

  // ─── apple-touch-icon (180x180) ───────────────────────────────────────────
  const apple = await sharp(squareIconBuffer)
    .resize(180, 180, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(OUT_PUBLIC, "apple-touch-icon.png"), apple);
  console.log(`  ✓ public/apple-touch-icon.png`);

  // ─── icon.png → src/app/icon.png (Next.js auto-favicon) ─────────────────
  // Next.js App Router: placing icon.png in app/ serves it as the favicon
  const icon512 = await sharp(squareIconBuffer)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(OUT_APP, "icon.png"), icon512);
  console.log(`  ✓ src/app/icon.png  (Next.js auto-favicon)`);

  // ─── favicon.ico (32x32 ICO using PNG) ───────────────────────────────────
  // Next.js competes: icon.png takes priority; we also replace favicon.ico
  // as a fallback. We write a 32x32 PNG and rename to .ico (browsers accept PNG-in-ICO)
  const ico32 = await sharp(squareIconBuffer)
    .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(OUT_APP, "favicon.ico"), ico32);
  console.log(`  ✓ src/app/favicon.ico (replaced)`);

  // ─── public/favicon-icon.png (512x512, the master source) ────────────────
  fs.writeFileSync(path.join(OUT_PUBLIC, "favicon-icon.png"), icon512);
  console.log(`  ✓ public/favicon-icon.png (master source)`);

  console.log("\n✅ All favicon files generated.");
}

main().catch((e) => { console.error(e); process.exit(1); });
