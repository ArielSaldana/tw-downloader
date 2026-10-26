import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const svg = await readFile(
  new URL("../extension/icon.svg", import.meta.url),
  "utf8",
);

const browser = await chromium.launch({ channel: "chromium" });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const png = await page.evaluate(
      async ({ size, svg }) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await image.decode();
        ctx.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { size, svg },
    );
    await writeFile(
      new URL(`../extension/icon${size}.png`, import.meta.url),
      Buffer.from(png, "base64"),
    );
  }
} finally {
  await browser.close();
}
console.log("Generated packaged toolbar icons.");
