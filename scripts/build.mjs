import { readFile, writeFile, copyFile } from "node:fs/promises";
import { redditBundle } from "./reddit-bundle.mjs";
import { root, extensionUrl, selectedPlugins } from "./plugins.mjs";

// Different paths let Chrome inject this helper into both execution worlds.
for (const plugin of selectedPlugins()) {
  const directory = extensionUrl(plugin);
  const source = await readFile(new URL("media.js", directory), "utf8");
  await writeFile(new URL("page-media.js", directory), source);
  for (const file of ["popup.html", "popup.js", "popup.css"]) {
    await copyFile(new URL(`shared/${file}`, root), new URL(file, directory));
  }
  if (plugin.id === "rd-downloader") await redditBundle(true);
  console.log(`Synchronized ${plugin.id}.`);
}
