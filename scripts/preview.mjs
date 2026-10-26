import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Render the real popup using authored sample data, with all network blocked.
const extension = fileURLToPath(new URL("../extension/", import.meta.url));
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  viewport: { width: 420, height: 720 },
  deviceScaleFactor: 2,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
try {
  await context.route(/^https?:/, (route) => route.abort());
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForFunction(
    () => !document.querySelector("#refresh").disabled,
  );
  await page.evaluate(() => {
    document.querySelector("#empty").hidden = true;
    setStatus("2 items ready to save.");
    renderMedia(
      {
        tweetId: "123456789",
        mediaId: "700",
        kind: "video",
        author: "NASA",
        text: "A new perspective, worth keeping. A short video from the journey beyond Earth.",
        variants: [
          {
            url: "https://video.twimg.com/example/1920x1080/clip.mp4",
            width: 1920,
            height: 1080,
          },
          {
            url: "https://video.twimg.com/example/1280x720/clip.mp4",
            width: 1280,
            height: 720,
          },
        ],
      },
      0,
    );
    renderMedia(
      {
        tweetId: "123456790",
        mediaId: "900",
        kind: "image",
        author: "NASA",
        text: "The Moon, in all its detail. Keep the original image at its full resolution.",
        variants: [
          {
            url: "https://pbs.twimg.com/media/example?format=jpg&name=orig",
            width: 3372,
            height: 2248,
          },
        ],
      },
      1,
    );
  });
  const output = new URL("../docs/", import.meta.url);
  await mkdir(output, { recursive: true });
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator("body").screenshot({
      path: fileURLToPath(new URL(`popup-${scheme}.png`, output)),
    });
  }
  console.log(
    "Generated light and dark popup previews from authored sample data.",
  );
} finally {
  await context.close();
}
