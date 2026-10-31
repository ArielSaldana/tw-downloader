import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { root, extensionPath, selectedPlugins } from "./plugins.mjs";

for (const plugin of selectedPlugins()) {
  const extension = extensionPath(plugin);
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
    const id = new URL(worker.url()).host,
      page = await context.newPage();
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.waitForFunction(
      () => !document.querySelector("#refresh").disabled,
    );
    await page.evaluate((pluginId) => {
      const instagram = pluginId === "ig-downloader",
        reddit = pluginId === "rd-downloader";
      document.querySelector("#empty").hidden = true;
      setStatus("2 items ready to save.");
      const common = {
        author: instagram ? "nasa" : "NASA",
        code: "DemoPost",
        postId: "abc123",
        tweetId: "123456789",
      };
      renderMedia(
        {
          ...common,
          mediaId: "700",
          kind: "video",
          text: "A new perspective, worth keeping. A short video from the journey beyond Earth.",
          variants: [
            {
              url: reddit
                ? "https://v.redd.it/democlip/DASH_1080.mp4"
                : instagram
                  ? "https://scontent.cdninstagram.com/example.mp4?oh=demo"
                  : "https://video.twimg.com/example/1920x1080/clip.mp4",
              width: 1920,
              height: 1080,
            },
            {
              url: reddit
                ? "https://v.redd.it/democlip/DASH_720.mp4"
                : instagram
                  ? "https://scontent.cdninstagram.com/smaller.mp4?oh=demo"
                  : "https://video.twimg.com/example/1280x720/clip.mp4",
              width: 1280,
              height: 720,
            },
          ],
        },
        0,
      );
      renderMedia(
        {
          ...common,
          mediaId: "900",
          kind: "image",
          text: "The Moon, in all its detail. Keep the best available image at its full resolution.",
          variants: [
            {
              url: reddit
                ? "https://i.redd.it/example.jpg"
                : instagram
                  ? "https://scontent.cdninstagram.com/example.jpg?oh=demo"
                  : "https://pbs.twimg.com/media/example?format=jpg&name=orig",
              width: 3372,
              height: 2248,
            },
          ],
        },
        1,
      );
    }, plugin.id);
    const output = new URL(`plugins/${plugin.id}/docs/`, root);
    await mkdir(output, { recursive: true });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.locator("body").screenshot({
        path: fileURLToPath(new URL(`popup-${scheme}.png`, output)),
      });
    }
    console.log(
      `Generated ${plugin.id} previews from authored sample data with network blocked.`,
    );
  } finally {
    await context.close();
  }
}
