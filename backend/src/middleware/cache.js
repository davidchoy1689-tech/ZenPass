/**
 * ZenPass 禪流 - 輕量 Response Caching
 * 為 GET endpoints 加 ETag + Cache-Control
 */

/**
 * 為 GET endpoints 加入 Cache-Control 同 ETag
 * @param {number} maxAge - 快取秒數 (default 60s)
 */
function cache(maxAge = 60) {
  return (req, res, next) => {
    if (req.method !== "GET") return next();

    const originalJson = res.json.bind(res);
    res.json = function (body) {
      const etag = require("crypto")
        .createHash("md5")
        .update(JSON.stringify(body))
        .digest("hex");

      res.set("Cache-Control", `public, max-age=${maxAge}`);
      res.set("ETag", `"${etag}"`);

      // 如果 client 有 If-None-Match 且 match → 304
      const clientEtag = req.headers["if-none-match"];
      if (clientEtag === `"${etag}"`) {
        return res.status(304).end();
      }

      return originalJson(body);
    };
    next();
  };
}

module.exports = { cache };
