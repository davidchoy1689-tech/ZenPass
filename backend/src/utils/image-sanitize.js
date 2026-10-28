/**
 * ZenPass 禪流 — 收據圖片清洗（Receipt Image Sanitizer）
 * 2026-10-28
 *
 * 目的（零外部依賴，唔需要 sharp）：
 *  1. 只接受 data URL（jpeg / png / heic / webp），用 magic bytes 判斷，唔信副檔名或聲稱 MIME
 *  2. 解碼後上限 5MB，防止用大圖塞爆 DB／拖死後台
 *  3. 移除 JPEG EXIF（APP1/APP2，含 GPS 座標）同 PNG eXIf／tEXt／iTXt／zTXt 區塊
 *     → 避免家長住址 GPS、拍攝裝置資料外洩
 *  4. 移除所有其他可疑 data URL（svg、html 等一律拒絕）
 *
 * 注意：唔做「重繪」（re-encode）—— 重繪需要 sharp/canvas 原生依賴，
 * 喺 VPS 上增加部署風險；移除 metadata + 嚴格 magic byte 檢查已可擋走
 * polyglot／EXIF 個資兩個主要風險。若日後要更強保證，可加 sharp 重編碼。
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5MB decoded

// magic bytes
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "png";
  // RIFF....WEBP
  if (
    buf.slice(0, 4).toString("latin1") === "RIFF" &&
    buf.slice(8, 12).toString("latin1") === "WEBP"
  ) return "webp";
  // HEIC / HEIF: ....ftypheic / ftypmif1 / ftypheix
  if (buf.slice(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.slice(8, 12).toString("latin1").toLowerCase();
    if (["heic", "heix", "hevc", "mif1", "msf1", "avif"].includes(brand)) return "heic";
  }
  return null;
}

/**
 * 移除 JPEG 內含 metadata 嘅 APP segments（APP1 Exif/XMP、APP2 ICC、APP13 IPTC、COM）
 * 保留 APP0 JFIF 同其餘影像資料，結構不變（仍然係合法 JPEG）。
 */
function stripJpegMetadata(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { out.push(buf.slice(i)); break; }
    const marker = buf[i + 1];
    // marker without length
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.slice(i, i + 2)); i += 2; continue;
    }
    if (marker === 0xda) { // start of scan → 之後全部係影像資料
      out.push(buf.slice(i)); break;
    }
    if (i + 4 > buf.length) { out.push(buf.slice(i)); break; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) { out.push(buf.slice(i)); break; }
    const seg = buf.slice(i, i + 2 + len);
    const isMeta =
      marker === 0xe1 || // APP1 (EXIF / XMP)
      marker === 0xe2 || // APP2 (ICC / MPF)
      marker === 0xed || // APP13 (IPTC)
      marker === 0xfe;   // COM
    if (!isMeta) out.push(seg);
    i += 2 + len;
  }
  return Buffer.concat(out);
}

const PNG_STRIP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

/**
 * 移除 PNG 內 eXIf / text chunks（保留 IHDR/IDAT/PLTE/IEND 等必要結構）
 */
function stripPngMetadata(buf) {
  const sig = buf.slice(0, 8);
  const out = [sig];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString("latin1");
    const total = 12 + len;
    if (i + total > buf.length) break;
    if (!PNG_STRIP.has(type)) out.push(buf.slice(i, i + total));
    i += total;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

function isHeicContainer(buf) {
  return buf.slice(4, 8).toString("latin1") === "ftyp";
}

/**
 * 主入口：清洗一張 data URL 收據
 * @returns {{ ok: true, dataUrl: string, kind: string, bytes: number } | { ok: false, code: string, error: string }}
 */
function sanitizeReceiptImage(input) {
  if (input == null || input === "") return { ok: true, dataUrl: null, kind: "none", bytes: 0 };
  if (typeof input !== "string") return { ok: false, code: "RECEIPT_INVALID", error: "收據格式不正確" };
  const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(input.trim());
  if (!m) {
    return { ok: false, code: "RECEIPT_INVALID", error: "收據必須係 base64 圖片（data URL）" };
  }
  // 快速體積檢查（base64 大約 4/3）
  if (m[2].length > Math.ceil((MAX_BYTES * 4) / 3) + 1024) {
    return { ok: false, code: "RECEIPT_TOO_LARGE", error: "收據圖片過大（上限 5MB）" };
  }
  let buf;
  try {
    buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  } catch (e) {
    return { ok: false, code: "RECEIPT_INVALID", error: "收據圖片解碼失敗" };
  }
  if (!buf.length) return { ok: false, code: "RECEIPT_INVALID", error: "收據圖片係空檔" };
  if (buf.length > MAX_BYTES) {
    return { ok: false, code: "RECEIPT_TOO_LARGE", error: "收據圖片過大（上限 5MB）" };
  }
  // 🔒 用 magic bytes 判斷真正格式，唔信聲稱嘅 MIME
  const kind = sniff(buf);
  if (!kind) {
    return { ok: false, code: "RECEIPT_UNSUPPORTED_TYPE", error: "只接受 JPEG／PNG／WebP／HEIC 圖片" };
  }
  let cleaned = buf;
  if (kind === "jpeg") cleaned = stripJpegMetadata(buf);
  else if (kind === "png") cleaned = stripPngMetadata(buf);
  else if (kind === "heic" && isHeicContainer(buf)) {
    // HEIC 結構複雜；唔敢亂改，但至少唔會當成其他格式執行。原樣保留 bytes。
    cleaned = buf;
  }
  const mime = kind === "heic" ? "image/heic" : `image/${kind}`;
  return {
    ok: true,
    dataUrl: `data:${mime};base64,${cleaned.toString("base64")}`,
    kind,
    bytes: cleaned.length,
  };
}

module.exports = { sanitizeReceiptImage, sniff, stripJpegMetadata, stripPngMetadata, MAX_BYTES };
