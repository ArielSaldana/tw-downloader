import { mkdir, readdir, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync(process.execPath, ["scripts/check.mjs"], {
  cwd: root,
  stdio: "inherit",
});
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
const output = new URL("../dist/tw-downloader-0.1.0.zip", import.meta.url);
await rm(output, { force: true });
const source = fileURLToPath(new URL("../extension/", import.meta.url));
const files = (await readdir(source)).sort();
execFileSync("zip", ["-X", "-q", fileURLToPath(output), ...files], {
  cwd: source,
});
const digest = createHash("sha256")
  .update(await readFile(output))
  .digest("hex");
console.log(`Created ${fileURLToPath(output)}\nSHA-256: ${digest}`);
