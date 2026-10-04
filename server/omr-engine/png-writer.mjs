import fs from "node:fs";
import path from "node:path";

export const writePng = async (cv, bgrMat, outputPath) => {
  const { Jimp } = await import("jimp");
  const w = bgrMat.cols;
  const h = bgrMat.rows;
  const channels = bgrMat.channels();
  const rgba = Buffer.allocUnsafe(w * h * 4);
  const rowBytes = w * channels;
  for (let r = 0; r < h; r++) {
    const row = bgrMat.data.subarray(r * rowBytes, (r + 1) * rowBytes);
    const outRow = r * w * 4;
    for (let x = 0; x < w; x++) {
      const idx = outRow + x * 4;
      rgba[idx] = row[x * channels + 2];
      rgba[idx + 1] = row[x * channels + 1];
      rgba[idx + 2] = row[x * channels];
      rgba[idx + 3] = 255;
    }
  }
  const img = new Jimp({ width: w, height: h });
  img.bitmap.data.set(rgba);
  const buf = await img.getBuffer("image/png");
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, buf);
};