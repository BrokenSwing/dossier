import type { DocumentFormat, WatermarkConfig } from "@dossier/shared";
import { WatermarkFailedError } from "@dossier/shared";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import sharp from "sharp";

interface WatermarkServiceInterface {
  readonly apply: (content: Uint8Array, format: DocumentFormat, config: WatermarkConfig) => Effect.Effect<Uint8Array, WatermarkFailedError>;
}

export class WatermarkService extends Context.Tag("@dossier/compute/WatermarkService")<WatermarkService, WatermarkServiceInterface>() {}

const applyPdfWatermark = async (content: Uint8Array, text: string): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.load(content);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  for (const page of pages) {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 4,
      y: height / 2,
      size: 50,
      font,
      color: rgb(0.8, 0.8, 0.8),
      opacity: 0.3,
      rotate: degrees(45),
    });
  }
  return pdfDoc.save();
};

const applyImageWatermark = async (content: Uint8Array, text: string): Promise<Uint8Array> => {
  const metadata = await sharp(content).metadata();
  const width = metadata.width ?? 800;
  const height = metadata.height ?? 600;
  const fontSize = Math.round(Math.min(width, height) / 10);
  const safe = text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"` +
      ` font-size="${fontSize}" font-family="sans-serif" fill="rgba(200,200,200,0.5)"` +
      ` transform="rotate(-45 ${width / 2} ${height / 2})">${safe}</text>` +
      `</svg>`,
  );
  return new Uint8Array(
    await sharp(content)
      .composite([{ input: svg, blend: "over" }])
      .toBuffer(),
  );
};

export const WatermarkServiceLive = Layer.succeed(WatermarkService, {
  apply: (content, format, config) =>
    Effect.tryPromise({
      try: () => (format === "pdf" ? applyPdfWatermark(content, config.text) : applyImageWatermark(content, config.text)),
      catch: (e) => new WatermarkFailedError({ message: `Watermark failed: ${String(e)}` }),
    }),
});
