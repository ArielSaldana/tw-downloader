const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const clip = "https://www.redgifs.com/watch/calmblueotter";
const data = () => ({
  gif: {
    id: "calmblueotter",
    width: 1920,
    height: 1080,
    urls: {
      hd: "https://thumbs2.redgifs.com/CalmBlueOtter.mp4",
      sd: "https://thumbs2.redgifs.com/CalmBlueOtter-mobile.mp4",
    },
  },
});
function setup(handler) {
  const requests = [];
  const context = vm.createContext({
    URL,
    AbortSignal,
    TextDecoder,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return handler(url, options, requests.length);
    },
  });
  for (const file of ["media.js", "redgifs.js"])
    vm.runInContext(
      fs.readFileSync(`plugins/rd-downloader/extension/${file}`, "utf8"),
      context,
    );
  return { requests, resolve: context.__RD_DOWNLOADER_REDGIFS_V1__.resolve };
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
test("Redgifs resolves HD locally, reuses anonymous access, and never sends cookies", async () => {
  const client = setup((url) =>
    json(
      url.endsWith("auth/temporary") ? { token: "temporary-token" } : data(),
    ),
  );
  const resolved = await client.resolve(clip);
  assert.equal(resolved.url, data().gif.urls.hd);
  assert.equal(resolved.height, 1080);
  await client.resolve(clip);
  assert.equal(client.requests.length, 3);
  assert.equal(
    client.requests[1].options.headers.Authorization,
    "Bearer temporary-token",
  );
  assert.equal(
    client.requests[1].url,
    "https://api.redgifs.com/v2/gifs/calmblueotter",
  );
  for (const { options } of client.requests) {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
  }
});
test("Redgifs retries an expired temporary token once and shares concurrent authentication", async () => {
  let tokens = 0;
  const client = setup((url, options) => {
    if (url.endsWith("auth/temporary"))
      return json({ token: `token-${++tokens}` });
    return options.headers.Authorization === "Bearer token-1"
      ? json({}, 401)
      : json(data());
  });
  await Promise.all([client.resolve(clip), client.resolve(clip)]);
  assert.equal(tokens, 2);
  const failing = setup((url) =>
    json(
      url.endsWith("auth/temporary") ? { token: "token" } : {},
      url.endsWith("auth/temporary") ? 200 : 401,
    ),
  );
  await assert.rejects(failing.resolve(clip), /401/);
  assert.equal(failing.requests.length, 4);
});
test("Redgifs falls back to SD only when a validated HD MP4 is unavailable", async () => {
  const payload = data();
  payload.gif.urls.hd = "https://evil.test/clip.mp4";
  const client = setup((url) =>
    json(url.endsWith("auth/temporary") ? { token: "token" } : payload),
  );
  const resolved = await client.resolve(clip);
  assert.equal(resolved.url, payload.gif.urls.sd);
  assert.equal(resolved.height, 480);
});
test("Redgifs rejects mismatched clips, unsafe assets, invalid tokens, and unavailable media", async () => {
  for (const payload of [
    { gif: { ...data().gif, id: "different" } },
    {
      gif: {
        ...data().gif,
        urls: { hd: "https://thumbs2.redgifs.com.evil.test/Clip.mp4" },
      },
    },
    {},
  ]) {
    const client = setup((url) =>
      json(url.endsWith("auth/temporary") ? { token: "token" } : payload),
    );
    await assert.rejects(
      client.resolve(clip),
      /different|unavailable|downloadable/,
    );
  }
  const badToken = setup(() => json({ token: "bad\r\nheader" }));
  await assert.rejects(badToken.resolve(clip), /temporary/);
  const blocked = setup(() => json({}, 403));
  await assert.rejects(blocked.resolve(clip), /403/);
  const invalid = setup(() => {
    throw new Error("must not fetch");
  });
  await assert.rejects(
    invalid.resolve("https://evil.test/watch/id"),
    /Invalid/,
  );
  assert.equal(invalid.requests.length, 0);
});
test("Redgifs rejects oversized JSON and propagates network errors without a silent fallback", async () => {
  const oversized = setup(() => new Response("x".repeat(512 * 1024 + 1)));
  await assert.rejects(oversized.resolve(clip), /oversized/);
  const network = setup(() => {
    throw new Error("Network unavailable");
  });
  await assert.rejects(network.resolve(clip), /Network unavailable/);
});
