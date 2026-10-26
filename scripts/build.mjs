import { readFile, writeFile } from "node:fs/promises";

// Chrome deduplicates a content script path even across execution worlds.
// Keep an identical helper at a distinct path for MAIN-world injection.
const source = await readFile(
  new URL("../extension/media.js", import.meta.url),
  "utf8",
);
await writeFile(new URL("../extension/page-media.js", import.meta.url), source);
console.log("Synchronized MAIN-world media helper.");
