import { fileURLToPath } from "node:url";

export const root = new URL("../", import.meta.url);
export const plugins = [
  {
    id: "rd-downloader",
    matches: [
      "https://www.reddit.com/*",
      "https://reddit.com/*",
      "https://old.reddit.com/*",
      "https://new.reddit.com/*",
    ],
    permissions: ["downloads", "offscreen"],
    hosts: ["https://v.redd.it/*", "https://api.redgifs.com/*"],
  },
  {
    id: "tw-downloader",
    matches: [
      "https://x.com/*",
      "https://www.x.com/*",
      "https://twitter.com/*",
      "https://www.twitter.com/*",
    ],
  },
  {
    id: "ig-downloader",
    matches: ["https://www.instagram.com/*", "https://instagram.com/*"],
  },
];
export function selectedPlugins() {
  const requested = process.argv[2];
  if (!requested || requested === "all") return plugins;
  const plugin = plugins.find(({ id }) => id === requested);
  if (!plugin) throw new Error(`Unknown plugin: ${requested}`);
  return [plugin];
}
export const extensionUrl = (plugin) =>
  new URL(`plugins/${plugin.id}/extension/`, root);
export const extensionPath = (plugin) => fileURLToPath(extensionUrl(plugin));
