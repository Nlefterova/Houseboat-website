#!/usr/bin/env node
/**
 * Generate responsive image variants for every JPG/PNG under public/.
 *
 *   public/hero/hero.jpg  →  public/hero/hero-480.{jpg,webp,avif}
 *                            public/hero/hero-800.{jpg,webp,avif}
 *                            public/hero/hero-1200.{jpg,webp,avif}
 *                            public/hero/hero-2400.{jpg,webp,avif}
 *
 * The original file stays put as the legacy fallback (referenced by the <img>
 * inside <picture>). Components reference the variants via the
 * ResponsiveImage helper, which builds the srcset URLs.
 *
 * Skipped:
 *   - any source already smaller than the target width (sharp upscales by default,
 *     which we don't want — we cap at the source's natural width)
 *   - files in public/images-skip/ (none currently — placeholder for future)
 *   - SVGs (vector, no variants needed)
 *
 * Idempotent: rerunning skips up-to-date variants by mtime comparison.
 * Run with: node scripts/generate-image-variants.mjs
 */

import sharp from "sharp";
import { readdir, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC_DIR = join(ROOT, "public");

const WIDTHS = [480, 800, 1200, 2400];
const FORMATS = [
  { ext: "avif", opts: { quality: 50, effort: 4 } },   // ~50% smaller than JPG
  { ext: "webp", opts: { quality: 78, effort: 4 } },   // ~30% smaller than JPG
  { ext: "jpg",  opts: { quality: 82, mozjpeg: true } }, // legacy fallback
];

const stats = { processed: 0, generated: 0, skipped: 0, errors: 0 };

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(jpe?g|png)$/i.test(e.name) && !/-(\d+)\.(jpg|webp|avif)$/.test(e.name)) {
      // Skip the variants themselves on reruns (they match the size-suffix pattern).
      out.push(full);
    }
  }
  return out;
}

async function processOne(srcPath) {
  stats.processed++;
  const dir = dirname(srcPath);
  const stem = basename(srcPath, extname(srcPath));
  const srcStat = await stat(srcPath);

  let meta;
  try {
    meta = await sharp(srcPath).metadata();
  } catch (e) {
    console.error(`✗ ${relative(ROOT, srcPath)}: ${e.message}`);
    stats.errors++;
    return;
  }
  const naturalW = meta.width ?? 0;

  for (const w of WIDTHS) {
    if (w > naturalW) continue; // no upscale
    for (const f of FORMATS) {
      const outPath = join(dir, `${stem}-${w}.${f.ext}`);
      // Skip if up-to-date.
      if (existsSync(outPath)) {
        const outStat = await stat(outPath);
        if (outStat.mtimeMs >= srcStat.mtimeMs) {
          stats.skipped++;
          continue;
        }
      }
      try {
        const pipe = sharp(srcPath).resize({ width: w, withoutEnlargement: true });
        if (f.ext === "avif") await pipe.avif(f.opts).toFile(outPath);
        else if (f.ext === "webp") await pipe.webp(f.opts).toFile(outPath);
        else await pipe.jpeg(f.opts).toFile(outPath);
        stats.generated++;
      } catch (e) {
        console.error(`✗ ${relative(ROOT, outPath)}: ${e.message}`);
        stats.errors++;
      }
    }
  }
  if (stats.processed % 5 === 0) {
    process.stdout.write(`  ${stats.processed} sources · ${stats.generated} written · ${stats.skipped} skipped\r`);
  }
}

console.log("Scanning public/ for JPG/PNG sources…");
const sources = await walk(PUBLIC_DIR);
console.log(`Found ${sources.length} source images.`);
console.log(`Generating ${WIDTHS.length} sizes × ${FORMATS.length} formats per source…\n`);

const start = Date.now();
for (const s of sources) await processOne(s);
const secs = ((Date.now() - start) / 1000).toFixed(1);

console.log(`\n\nDone in ${secs}s.`);
console.log(`  Sources:   ${stats.processed}`);
console.log(`  Generated: ${stats.generated}`);
console.log(`  Up-to-date: ${stats.skipped}`);
if (stats.errors) console.log(`  Errors:    ${stats.errors}`);
