/* Resolve only an explicitly selected Redgifs clip. No account credentials. */
(() => {
  const { redgifsId, redgifsMediaUrl } = globalThis.__RD_DOWNLOADER_MEDIA_V1__;
  const API = "https://api.redgifs.com/v2/";
  let token = "",
    authenticating;
  async function request(endpoint, headers = {}) {
    const response = await fetch(API + endpoint, {
      headers: { Accept: "application/json", ...headers },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = new Error(
        `Redgifs request failed (${response.status}). Refresh the post and try again.`,
      );
      error.status = response.status;
      throw error;
    }
    const limit = 512 * 1024,
      reader = response.body.getReader(),
      decoder = new TextDecoder();
    let text = "",
      size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit)
          throw new Error("Redgifs returned an oversized response.");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  async function authenticate() {
    if (token) return token;
    if (!authenticating)
      authenticating = (async () => {
        const data = await request("auth/temporary");
        if (
          typeof data.token !== "string" ||
          !/^[a-z0-9._-]{1,8192}$/i.test(data.token)
        )
          throw new Error("Could not obtain temporary Redgifs access.");
        token = data.token;
        return token;
      })().finally(() => {
        authenticating = null;
      });
    return authenticating;
  }
  async function resolve(value) {
    const id = redgifsId(value);
    if (!id) throw new Error("Invalid Redgifs clip.");
    for (let attempt = 0; attempt < 2; attempt++) {
      const access = await authenticate();
      let data;
      try {
        data = await request(`gifs/${id}`, {
          Authorization: `Bearer ${access}`,
          "X-CustomHeader": `https://www.redgifs.com/watch/${id}`,
        });
      } catch (error) {
        if (error.status === 401 && attempt === 0) {
          if (token === access) token = "";
          continue;
        }
        throw error;
      }
      const gif = data.gif;
      if (!gif || String(gif.id).toLowerCase() !== id)
        throw new Error("Redgifs returned a different or unavailable clip.");
      for (const quality of ["hd", "sd", "gif"]) {
        const url = redgifsMediaUrl(gif.urls?.[quality]);
        if (!url) continue;
        const height =
          Number.isInteger(gif.height) && gif.height > 0 && gif.height <= 50000
            ? Math.min(
                gif.height,
                quality === "hd" ? gif.height : quality === "sd" ? 480 : 250,
              )
            : 0;
        const width =
          height &&
          Number.isInteger(gif.width) &&
          gif.width > 0 &&
          gif.width <= 50000
            ? Math.round((gif.width * height) / gif.height)
            : 0;
        return { url, width, height };
      }
      throw new Error(
        "Redgifs did not provide a downloadable MP4 for this clip.",
      );
    }
  }
  globalThis.__RD_DOWNLOADER_REDGIFS_V1__ = Object.freeze({ resolve });
})();
