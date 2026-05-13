const DEFAULT_TEXT_FONT = "3";
const DEFAULT_X_MULTIPLIER = 1;
const DEFAULT_Y_MULTIPLIER = 1;

const DEFAULT_SETTINGS = Object.freeze({
  dpi: 203,
  width: 576,
  height: 320,
  gap: 24,
  gapOffset: 0,
  measurementUnit: "dot",
  widthValue: 576,
  heightValue: 320,
  gapValue: 24,
  gapOffsetValue: 0,
  direction: 1,
  mirror: 0,
  referenceX: 0,
  referenceY: 0,
  sets: 1,
  copies: 1,
});

export const PROJECT_FILE_SCHEMA = "labelme-project";
export const PROJECT_FILE_FORMAT = "1.0";

const FONT_METRICS = {
  0: { width: 18, height: 28 },
  1: { width: 8, height: 12 },
  2: { width: 12, height: 20 },
  3: { width: 16, height: 24 },
  4: { width: 24, height: 32 },
  5: { width: 32, height: 48 },
  6: { width: 14, height: 19 },
  7: { width: 21, height: 27 },
  8: { width: 14, height: 25 },
};

function resolveFontMetric(fontName) {
  const normalized = String(fontName ?? "").trim().toUpperCase();
  const bitmapFontMatch = normalized.match(/^TS[ST](\d+)\.BF2$/);
  if (bitmapFontMatch) {
    const size = clampNumber(bitmapFontMatch[1], 8, 96, 24);
    return { width: size, height: size, fontName: normalized };
  }

  const resolved = FONT_METRICS[fontName] ?? FONT_METRICS[normalized] ?? FONT_METRICS[3];
  return { ...resolved, fontName: normalized };
}

function estimateTextLineWidth(text, metric, multiplier) {
  const normalizedFont = String(metric.fontName ?? "").trim().toUpperCase();
  const asciiWidthRatio = /^TS[ST]\d+\.BF2$/.test(normalizedFont) ? 0.5 : 0.6;
  let width = 0;
  for (const char of Array.from(String(text ?? ""))) {
    const codePoint = char.codePointAt(0) ?? 0;
    width += codePoint <= 0x7f ? metric.width * asciiWidthRatio : metric.width;
  }
  return Math.max(metric.width, Math.round(width * multiplier));
}

const utf8TextEncoder = new TextEncoder();
let gbkReverseMap = null;

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseFloat(value);
  if (Number.isNaN(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function maybeInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isNaN(number) ? fallback : number;
}

function normalizeRotation(value, allowed = [0, 90, 180, 270]) {
  return allowed.includes(value) ? value : allowed[0];
}

function normalizeLineBreaks(source) {
  return String(source ?? "").replace(/\r\n?/g, "\n");
}

function normalizeBitmap(bitmap) {
  if (!bitmap || !bitmap.width || !bitmap.height || !Array.isArray(bitmap.pixels)) {
    return null;
  }

  return {
    width: clampNumber(bitmap.width, 1, 4096, 1),
    height: clampNumber(bitmap.height, 1, 4096, 1),
    pixels: bitmap.pixels.map((pixel) => (pixel ? 1 : 0)),
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function pseudoSeed(source) {
  let hash = 2166136261;
  for (const char of String(source)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state + 0x6d2b79f5, 1);
    state ^= state >>> 15;
    state = Math.imul(state, state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeTextEncoding(encoding) {
  return String(encoding ?? "utf-8").trim().toLowerCase() === "gbk" ? "gbk" : "utf-8";
}

function getGbkReverseMap() {
  if (gbkReverseMap) {
    return gbkReverseMap;
  }

  if (typeof TextDecoder === "undefined") {
    throw new Error("当前环境不支持 GBK 编码转换。");
  }

  let decoder;
  try {
    decoder = new TextDecoder("gbk");
  } catch (error) {
    throw new Error("当前浏览器不支持 GBK 编码。");
  }

  const map = new Map();
  for (let byte = 0; byte <= 0xff; byte += 1) {
    const decoded = decoder.decode(Uint8Array.of(byte));
    if (decoded && decoded !== "\uFFFD" && decoded.length === 1 && !map.has(decoded)) {
      map.set(decoded, Uint8Array.of(byte));
    }
  }

  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x40; trail <= 0xfe; trail += 1) {
      if (trail === 0x7f) {
        continue;
      }
      const bytes = Uint8Array.of(lead, trail);
      const decoded = decoder.decode(bytes);
      if (decoded && decoded !== "\uFFFD" && decoded.length === 1 && !map.has(decoded)) {
        map.set(decoded, bytes);
      }
    }
  }

  gbkReverseMap = map;
  return map;
}

function encodeGbkText(value) {
  const map = getGbkReverseMap();
  const bytes = [];
  for (const char of Array.from(String(value))) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }

    const encoded = map.get(char);
    if (!encoded) {
      throw new Error(`字符 ${JSON.stringify(char)} 无法编码为 GBK`);
    }
    bytes.push(...encoded);
  }
  return Uint8Array.from(bytes);
}

function encodeText(value, encoding = "utf-8") {
  return normalizeTextEncoding(encoding) === "gbk"
    ? encodeGbkText(value)
    : utf8TextEncoder.encode(String(value));
}

function appendChunk(target, chunk, encoding = "utf-8") {
  target.push(chunk instanceof Uint8Array ? chunk : encodeText(chunk, encoding));
}

function concatUint8Arrays(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}

function encodeAsciiLine(line, encoding = "utf-8") {
  return encodeText(`${line}\r\n`, encoding);
}

function rotateBitmap(bitmap, rotation) {
  const normalized = normalizeBitmap(bitmap);
  if (!normalized) {
    return null;
  }

  const degrees = normalizeRotation(rotation);
  if (degrees === 0) {
    return normalized;
  }

  let width = normalized.width;
  let height = normalized.height;
  if (degrees === 90 || degrees === 270) {
    width = normalized.height;
    height = normalized.width;
  }

  const pixels = new Array(width * height).fill(0);
  for (let y = 0; y < normalized.height; y += 1) {
    for (let x = 0; x < normalized.width; x += 1) {
      const source = normalized.pixels[y * normalized.width + x] ? 1 : 0;
      let nextX = x;
      let nextY = y;
      if (degrees === 90) {
        nextX = normalized.height - 1 - y;
        nextY = x;
      } else if (degrees === 180) {
        nextX = normalized.width - 1 - x;
        nextY = normalized.height - 1 - y;
      } else if (degrees === 270) {
        nextX = y;
        nextY = normalized.width - 1 - x;
      }

      pixels[nextY * width + nextX] = source;
    }
  }

  return {
    width,
    height,
    pixels,
  };
}

export function bitmapToHex(bitmap) {
  const normalized = normalizeBitmap(bitmap);
  if (!normalized) {
    return "";
  }

  const byteWidth = Math.ceil(normalized.width / 8);
  let result = "";

  for (let row = 0; row < normalized.height; row += 1) {
    for (let byteIndex = 0; byteIndex < byteWidth; byteIndex += 1) {
      let value = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const column = byteIndex * 8 + bit;
        if (column >= normalized.width) {
          continue;
        }

        const pixel = normalized.pixels[row * normalized.width + column] ? 1 : 0;
        value |= pixel << (7 - bit);
      }
      result += value.toString(16).padStart(2, "0");
    }
  }

  return result.toUpperCase();
}

function bitmapToBytes(bitmap, blackBitsAreZero = false) {
  const normalized = normalizeBitmap(bitmap);
  if (!normalized) {
    return new Uint8Array();
  }

  const byteWidth = Math.ceil(normalized.width / 8);
  const bytes = new Uint8Array(byteWidth * normalized.height);
  let cursor = 0;

  for (let row = 0; row < normalized.height; row += 1) {
    for (let byteIndex = 0; byteIndex < byteWidth; byteIndex += 1) {
      let value = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const column = byteIndex * 8 + bit;
        if (column >= normalized.width) {
          continue;
        }

        const pixel = normalized.pixels[row * normalized.width + column] ? 1 : 0;
        const bitValue = blackBitsAreZero ? (pixel ? 0 : 1) : pixel;
        value |= bitValue << (7 - bit);
      }
      bytes[cursor] = value;
      cursor += 1;
    }
  }

  return bytes;
}

function bytesToBitmap(byteWidth, height, bytes, blackBitsAreZero = false) {
  const pixels = [];
  const expected = byteWidth * height;

  for (let index = 0; index < expected; index += 1) {
    const value = bytes[index] ?? 0;
    for (let bit = 7; bit >= 0; bit -= 1) {
      const bitValue = (value >> bit) & 1;
      pixels.push(blackBitsAreZero ? (bitValue ? 0 : 1) : bitValue);
    }
  }

  return {
    width: byteWidth * 8,
    height,
    pixels,
  };
}

export function bitmapToSvgDataUrl(bitmap, scale = 1) {
  const normalized = normalizeBitmap(bitmap);
  if (!normalized) {
    return "";
  }

  const rects = [];
  for (let row = 0; row < normalized.height; row += 1) {
    for (let col = 0; col < normalized.width; col += 1) {
      if (normalized.pixels[row * normalized.width + col]) {
        rects.push(`<rect x="${col}" y="${row}" width="1" height="1" fill="#111111" />`);
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${normalized.width * scale}" height="${normalized.height * scale}" viewBox="0 0 ${normalized.width} ${normalized.height}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff" />${rects.join("")}</svg>`;
  return svgToDataUrl(svg);
}

export function scaleBitmap(bitmap, targetWidth, targetHeight) {
  const normalized = normalizeBitmap(bitmap);
  const width = clampNumber(targetWidth, 1, 4096, normalized?.width ?? 1);
  const height = clampNumber(targetHeight, 1, 4096, normalized?.height ?? 1);
  if (!normalized) {
    return {
      width,
      height,
      pixels: Array(width * height).fill(0),
    };
  }

  const pixels = new Array(width * height).fill(0);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = Math.min(normalized.height - 1, Math.floor((row / height) * normalized.height));
    for (let col = 0; col < width; col += 1) {
      const sourceCol = Math.min(normalized.width - 1, Math.floor((col / width) * normalized.width));
      pixels[row * width + col] = normalized.pixels[sourceRow * normalized.width + sourceCol] ? 1 : 0;
    }
  }

  return {
    width,
    height,
    pixels,
  };
}

export async function rasterizeImageFromDataUrl(dataUrl, width, height, threshold = 150, invert = false) {
  if (typeof document === "undefined") {
    throw new Error("rasterizeImageFromDataUrl can only run in a browser context.");
  }

  const image = await new Promise((resolve, reject) => {
    const next = new Image();
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error("无法加载图片"));
    next.src = dataUrl;
  });

  const targetWidth = clampNumber(width, 1, 4096, image.width);
  const targetHeight = clampNumber(height, 1, 4096, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  const pixels = new Array(targetWidth * targetHeight).fill(0);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const alpha = imageData.data[index + 3];
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    const on = alpha > 15 && luminance < threshold;
    pixels[index / 4] = invert ? (on ? 0 : 1) : on ? 1 : 0;
  }

  const bitmap = {
    width: targetWidth,
    height: targetHeight,
    pixels,
  };

  return {
    bitmap,
    byteWidth: Math.ceil(targetWidth / 8),
    bitmapWidth: targetWidth,
    bitmapHeight: targetHeight,
    bitmapHex: bitmapToHex(bitmap),
    previewDataUrl: bitmapToSvgDataUrl(bitmap, 1),
  };
}

function parseBitmapHex(byteWidth, height, hex) {
  const cleanHex = String(hex ?? "").replace(/\s+/g, "").toUpperCase();
  const expectedBytes = byteWidth * height;
  const bytes = new Uint8Array(expectedBytes);

  for (let index = 0; index < expectedBytes; index += 1) {
    const value = cleanHex.slice(index * 2, index * 2 + 2);
    bytes[index] = Number.parseInt(value || "00", 16);
  }

  const bitmap = bytesToBitmap(byteWidth, height, bytes, false);
  return {
    bitmap,
    bytes,
    previewDataUrl: bitmapToSvgDataUrl(bitmap, 1),
  };
}

function toDots(value, unit, dpi) {
  if (unit === "dot") {
    return Math.round(value);
  }
  if (unit === "mm") {
    return Math.round((value * dpi) / 25.4);
  }
  return Math.round(value * dpi);
}

function fromDots(dots, unit, dpi) {
  if (unit === "dot") {
    return Math.round(dots);
  }
  if (unit === "mm") {
    return Number.parseFloat(((dots * 25.4) / dpi).toFixed(2));
  }
  return Number.parseFloat((dots / dpi).toFixed(4));
}

function normalizeMeasurementUnit(unit) {
  return unit === "mm" ? "mm" : "dot";
}

function measurementValueKey(name) {
  return `${name}Value`;
}

function getStoredMeasurementValue(settings, name) {
  const unit = normalizeMeasurementUnit(settings.measurementUnit);
  const dpi = clampNumber(settings.dpi, 100, 600, DEFAULT_SETTINGS.dpi);
  const fallbackDots = clampNumber(settings[name], 0, 4096, DEFAULT_SETTINGS[name]);
  const rawValue = settings?.[measurementValueKey(name)];
  const parsed = Number.parseFloat(rawValue);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return fromDots(fallbackDots, unit, dpi);
}

function formatMeasurementForTspl(value) {
  return Number.isFinite(value) ? String(Number.parseFloat(value.toFixed(2))) : "0";
}

function parseMeasurementToken(token, dpi) {
  const match = String(token ?? "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*(mm|dot)?$/i);

  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  const unit = match[2] ? match[2].toLowerCase() : "inch";
  return {
    rawValue: value,
    unit,
    dots: toDots(value, unit, dpi),
  };
}

function splitCsvArguments(source) {
  const text = String(source ?? "");
  const parts = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && text[index - 1] !== "\\") {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (char === "," && !inQuotes) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || text.endsWith(",")) {
    parts.push(current.trim());
  }

  return parts;
}

function stripTsplQuotes(value) {
  const text = String(value ?? "").trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\\["\]/g, '"')
      .replace(/\\"/g, '"');
  }
  return text;
}

function escapeTsplString(value) {
  return String(value ?? "")
    .replace(/"/g, '\\["]')
    .replace(/\r/g, "[R]")
    .replace(/\n/g, "[L]");
}

function formatQuoted(value) {
  return `"${escapeTsplString(value)}"`;
}

function normalizeModel(value) {
  const model = String(value ?? "M2").toUpperCase();
  return ["M1", "M2"].includes(model) ? model : "M2";
}

function normalizeMask(value) {
  const mask = String(value ?? "S7").toUpperCase();
  return /^S[0-8]$/.test(mask) ? mask : "S7";
}

function normalizeReadable(value) {
  return clampNumber(value, 0, 3, 1);
}

function normalizeVariableEntry(entry, index = 0) {
  return {
    name: String(entry?.name ?? `变量${index + 1}`),
    key: String(entry?.key ?? `var${index + 1}`),
    value: String(entry?.value ?? ""),
  };
}

export function normalizeVariables(variables) {
  return Array.isArray(variables) ? variables.map((entry, index) => normalizeVariableEntry(entry, index)) : [];
}

export function extractTemplateVariables(source, existingVariables = []) {
  const matches = String(source ?? "").matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g);
  const existingMap = new Map(
    normalizeVariables(existingVariables).map((variable) => [String(variable.key ?? "").trim(), variable]),
  );
  const seen = new Set();
  const variables = [];

  for (const match of matches) {
    const key = String(match[1] ?? "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);

    const existing = existingMap.get(key);
    variables.push(
      normalizeVariableEntry(
        existing
          ? { ...existing, key }
          : {
              name: key,
              key,
              value: "",
            },
        variables.length,
      ),
    );
  }

  return variables;
}

function buildVariableMap(variables) {
  const map = new Map();
  for (const variable of normalizeVariables(variables)) {
    const key = String(variable.key ?? "").trim();
    if (!key) {
      continue;
    }
    map.set(key, String(variable.value ?? ""));
  }
  return map;
}

export function renderTemplateString(value, variables) {
  const map = buildVariableMap(variables);
  return String(value ?? "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => (map.has(key) ? map.get(key) : match));
}

export function createNode(kind, partial = {}) {
  switch (kind) {
    case "text":
      return {
        id: partial.id ?? createId("text"),
        kind,
        name: partial.name ?? "文字",
        x: maybeInteger(partial.x, 30),
        y: maybeInteger(partial.y, 30),
        rotation: normalizeRotation(maybeInteger(partial.rotation, 0)),
        font: String(partial.font ?? DEFAULT_TEXT_FONT),
        xMultiplier: clampNumber(partial.xMultiplier, 1, 10, DEFAULT_X_MULTIPLIER),
        yMultiplier: clampNumber(partial.yMultiplier, 1, 10, DEFAULT_Y_MULTIPLIER),
        alignment: partial.alignment === null || partial.alignment === undefined ? null : clampNumber(partial.alignment, 0, 3, 0),
        text: String(partial.text ?? "示例文字"),
      };
    case "barcode":
      return {
        id: partial.id ?? createId("barcode"),
        kind,
        name: partial.name ?? "条码",
        x: maybeInteger(partial.x, 30),
        y: maybeInteger(partial.y, 80),
        rotation: normalizeRotation(maybeInteger(partial.rotation, 0)),
        barcodeType: String(partial.barcodeType ?? "128"),
        height: clampNumber(partial.height, 10, 1200, 80),
        humanReadable: normalizeReadable(partial.humanReadable),
        narrow: clampNumber(partial.narrow, 1, 20, 2),
        wide: clampNumber(partial.wide, 1, 20, 4),
        alignment: partial.alignment === null || partial.alignment === undefined ? null : clampNumber(partial.alignment, 0, 3, 0),
        data: String(partial.data ?? "1234567890"),
      };
    case "qr":
      return {
        id: partial.id ?? createId("qr"),
        kind,
        name: partial.name ?? "二维码",
        x: maybeInteger(partial.x, 30),
        y: maybeInteger(partial.y, 190),
        rotation: normalizeRotation(maybeInteger(partial.rotation, 0)),
        errorCorrection: /^(L|M|Q|H)$/i.test(partial.errorCorrection ?? "M")
          ? String(partial.errorCorrection).toUpperCase()
          : "M",
        cellWidth: clampNumber(partial.cellWidth, 1, 10, 5),
        mode: String(partial.mode ?? "A").toUpperCase() === "M" ? "M" : "A",
        model: normalizeModel(partial.model),
        mask: normalizeMask(partial.mask),
        data: String(partial.data ?? "https://example.com"),
      };
    case "image": {
      const bitmap =
        normalizeBitmap(partial.bitmap) ??
        normalizeBitmap(parseBitmapHex(partial.byteWidth ?? 8, partial.bitmapHeight ?? 8, partial.bitmapHex ?? "FFFFFFFFFFFFFFFF").bitmap);

      return {
        id: partial.id ?? createId("image"),
        kind,
        name: partial.name ?? "图片",
        x: maybeInteger(partial.x, 260),
        y: maybeInteger(partial.y, 40),
        rotation: 0,
        mode: clampNumber(partial.mode, 0, 2, 0),
        threshold: clampNumber(partial.threshold, 0, 255, 150),
        invert: Boolean(partial.invert ?? false),
        sourceDataUrl: typeof partial.sourceDataUrl === "string" ? partial.sourceDataUrl : null,
        bitmap,
        bitmapHex: String(partial.bitmapHex ?? bitmapToHex(bitmap)),
        byteWidth: clampNumber(partial.byteWidth ?? Math.ceil(bitmap.width / 8), 1, 9999, Math.ceil(bitmap.width / 8)),
        bitmapWidth: clampNumber(partial.bitmapWidth ?? bitmap.width, 1, 4096, bitmap.width),
        bitmapHeight: clampNumber(partial.bitmapHeight ?? bitmap.height, 1, 4096, bitmap.height),
        previewDataUrl:
          typeof partial.previewDataUrl === "string" && partial.previewDataUrl.length > 0
            ? partial.previewDataUrl
            : bitmapToSvgDataUrl(bitmap, 1),
      };
    }
    case "bar":
      return {
        id: partial.id ?? createId("bar"),
        kind,
        name: partial.name ?? "线条",
        x: maybeInteger(partial.x, 30),
        y: maybeInteger(partial.y, 120),
        rotation: 0,
        width: clampNumber(partial.width, 1, 4096, 240),
        height: clampNumber(partial.height, 1, 4096, 4),
      };
    case "box":
      return {
        id: partial.id ?? createId("box"),
        kind,
        name: partial.name ?? "方框",
        x: maybeInteger(partial.x, 30),
        y: maybeInteger(partial.y, 120),
        rotation: 0,
        width: clampNumber(partial.width, 1, 4096, 240),
        height: clampNumber(partial.height, 1, 4096, 120),
        thickness: clampNumber(partial.thickness, 1, 128, 4),
      };
    case "raw":
      return {
        id: partial.id ?? createId("raw"),
        kind,
        name: partial.name ?? "原始 TSPL",
        text: String(partial.text ?? "BAR 20,180,300,4"),
      };
    default:
      throw new Error(`Unsupported node kind: ${kind}`);
  }
}

export function createEmptyDocument() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    nodes: [],
  };
}

export function createSampleDocument() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    nodes: [
      createNode("text", {
        name: "标题",
        x: 26,
        y: 24,
        font: "3",
        xMultiplier: 1,
        yMultiplier: 1,
        text: "SKU A-1024 / BLACK / M",
      }),
      createNode("barcode", {
        name: "商品条码",
        x: 26,
        y: 86,
        barcodeType: "128",
        height: 78,
        humanReadable: 1,
        narrow: 2,
        wide: 4,
        data: "SKU-A1024-BLACK-M",
      }),
      createNode("qr", {
        name: "商品二维码",
        x: 392,
        y: 72,
        errorCorrection: "M",
        cellWidth: 5,
        mode: "A",
        rotation: 0,
        model: "M2",
        mask: "S7",
        data: "https://example.com/p/SKU-A1024-BLACK-M",
      }),
      createNode("bar", {
        name: "分隔线",
        x: 20,
        y: 188,
        width: 536,
        height: 2,
      }),
      createNode("text", {
        name: "价格",
        x: 28,
        y: 214,
        font: "4",
        xMultiplier: 1,
        yMultiplier: 1,
        text: "RMB 129.00",
      }),
    ],
  };
}

export function normalizeDocument(document) {
  const settings = document?.settings ?? DEFAULT_SETTINGS;
  const nodes = Array.isArray(document?.nodes) ? document.nodes : [];
  const dpi = clampNumber(settings.dpi, 100, 600, DEFAULT_SETTINGS.dpi);
  const measurementUnit = normalizeMeasurementUnit(settings.measurementUnit);
  const width = clampNumber(settings.width, 80, 4096, DEFAULT_SETTINGS.width);
  const height = clampNumber(settings.height, 40, 4096, DEFAULT_SETTINGS.height);
  const gap = clampNumber(settings.gap, 0, 4096, DEFAULT_SETTINGS.gap);
  const gapOffset = clampNumber(settings.gapOffset, 0, 4096, DEFAULT_SETTINGS.gapOffset);

  return {
    settings: {
      dpi,
      width,
      height,
      gap,
      gapOffset,
      measurementUnit,
      widthValue: getStoredMeasurementValue({ ...settings, dpi, measurementUnit, width }, "width"),
      heightValue: getStoredMeasurementValue({ ...settings, dpi, measurementUnit, height }, "height"),
      gapValue: getStoredMeasurementValue({ ...settings, dpi, measurementUnit, gap }, "gap"),
      gapOffsetValue: getStoredMeasurementValue({ ...settings, dpi, measurementUnit, gapOffset }, "gapOffset"),
      direction: clampNumber(settings.direction, 0, 1, DEFAULT_SETTINGS.direction),
      mirror: clampNumber(settings.mirror, 0, 1, DEFAULT_SETTINGS.mirror),
      referenceX: clampNumber(settings.referenceX, 0, 4096, DEFAULT_SETTINGS.referenceX),
      referenceY: clampNumber(settings.referenceY, 0, 4096, DEFAULT_SETTINGS.referenceY),
      sets: clampNumber(settings.sets, 1, 999999999, DEFAULT_SETTINGS.sets),
      copies: clampNumber(settings.copies, 1, 999999999, DEFAULT_SETTINGS.copies),
    },
    nodes: nodes.map((node) => createNode(node.kind, node)),
  };
}

function formatSettingsLines(settings) {
  const unit = normalizeMeasurementUnit(settings.measurementUnit);
  const widthValue = unit === "mm" ? formatMeasurementForTspl(settings.widthValue) : Math.round(settings.width);
  const heightValue = unit === "mm" ? formatMeasurementForTspl(settings.heightValue) : Math.round(settings.height);
  const gapValue = unit === "mm" ? formatMeasurementForTspl(settings.gapValue) : Math.round(settings.gap);
  const gapOffsetValue = unit === "mm" ? formatMeasurementForTspl(settings.gapOffsetValue) : Math.round(settings.gapOffset);

  return [
    `SIZE ${widthValue} ${unit},${heightValue} ${unit}`,
    `GAP ${gapValue} ${unit},${gapOffsetValue} ${unit}`,
    `DIRECTION ${settings.direction},${settings.mirror}`,
    `REFERENCE ${settings.referenceX},${settings.referenceY}`,
    "CLS",
  ];
}

function generateTextLine(node) {
  const parts = [
    `TEXT ${node.x}`,
    `${node.y}`,
    formatQuoted(node.font),
    String(node.rotation),
    String(node.xMultiplier),
    String(node.yMultiplier),
  ];

  if (node.alignment !== null) {
    parts.push(String(node.alignment));
  }

  parts.push(formatQuoted(node.text));
  return parts.join(",");
}

function generateBarcodeLine(node) {
  const parts = [
    `BARCODE ${node.x}`,
    `${node.y}`,
    formatQuoted(node.barcodeType),
    String(node.height),
    String(node.humanReadable),
    String(node.rotation),
    String(node.narrow),
    String(node.wide),
  ];

  if (node.alignment !== null) {
    parts.push(String(node.alignment));
  }

  parts.push(formatQuoted(node.data));
  return parts.join(",");
}

function generateQrLine(node) {
  return [
    `QRCODE ${node.x}`,
    `${node.y}`,
    node.errorCorrection,
    String(node.cellWidth),
    node.mode,
    String(node.rotation),
    node.model,
    node.mask,
    formatQuoted(node.data),
  ].join(",");
}

function generateBarLine(node) {
  return `BAR ${node.x},${node.y},${Math.max(1, Math.round(node.width))},${Math.max(1, Math.round(node.height))}`;
}

function generateBoxLine(node) {
  return `BOX ${node.x},${node.y},${Math.round(node.x + node.width)},${Math.round(node.y + node.height)},${Math.max(1, Math.round(node.thickness))}`;
}

function bitmapNodeToWorkingBitmap(node) {
  const rotated = rotateBitmap(node.bitmap, node.rotation);
  const bitmap = normalizeBitmap(rotated ?? node.bitmap);
  return {
    bitmap,
    byteWidth: Math.ceil(bitmap.width / 8),
    height: bitmap.height,
    bytes: bitmapToBytes(bitmap, true),
    hex: bitmapToHex(bitmap),
  };
}

export function generateTsplSource(document) {
  const normalized = normalizeDocument(document);
  const lines = [...formatSettingsLines(normalized.settings)];

  for (const node of normalized.nodes) {
    if (node.kind === "raw") {
      lines.push(
        ...normalizeLineBreaks(node.text)
          .split("\n")
          .map((line) => line.trimEnd()),
      );
      continue;
    }

    if (node.kind === "text") {
      lines.push(generateTextLine(node));
      continue;
    }

    if (node.kind === "barcode") {
      lines.push(generateBarcodeLine(node));
      continue;
    }

    if (node.kind === "qr") {
      lines.push(generateQrLine(node));
      continue;
    }

    if (node.kind === "image") {
      const working = bitmapNodeToWorkingBitmap(node);
      lines.push(`BITMAPHEX ${node.x},${node.y},${working.byteWidth},${working.height},${node.mode}`);
      lines.push(working.hex);
      lines.push("ENDBITMAPHEX");
      continue;
    }

    if (node.kind === "bar") {
      lines.push(generateBarLine(node));
      continue;
    }

    if (node.kind === "box") {
      lines.push(generateBoxLine(node));
    }
  }

  lines.push(`PRINT ${normalized.settings.sets},${normalized.settings.copies}`);
  return `${lines.join("\n")}\n`;
}

export function generateTsplPayload(document, options = {}) {
  const normalized = normalizeDocument(document);
  const textEncoding = normalizeTextEncoding(options.textEncoding);
  const chunks = [];

  for (const line of formatSettingsLines(normalized.settings)) {
    appendChunk(chunks, encodeAsciiLine(line, textEncoding));
  }

  for (const node of normalized.nodes) {
    if (node.kind === "raw") {
      const rawLines = normalizeLineBreaks(node.text)
        .split("\n")
        .map((line) => line.trimEnd());
      for (const line of rawLines) {
        appendChunk(chunks, encodeAsciiLine(line, textEncoding));
      }
      continue;
    }

    if (node.kind === "text") {
      appendChunk(chunks, encodeAsciiLine(generateTextLine(node), textEncoding));
      continue;
    }

    if (node.kind === "barcode") {
      appendChunk(chunks, encodeAsciiLine(generateBarcodeLine(node), textEncoding));
      continue;
    }

    if (node.kind === "qr") {
      appendChunk(chunks, encodeAsciiLine(generateQrLine(node), textEncoding));
      continue;
    }

    if (node.kind === "image") {
      const working = bitmapNodeToWorkingBitmap(node);
      appendChunk(chunks, encodeText(`BITMAP ${node.x},${node.y},${working.byteWidth},${working.height},${node.mode},`, textEncoding));
      appendChunk(chunks, working.bytes);
      appendChunk(chunks, encodeText("\r\n", textEncoding));
      continue;
    }

    if (node.kind === "bar") {
      appendChunk(chunks, encodeAsciiLine(generateBarLine(node), textEncoding));
      continue;
    }

    if (node.kind === "box") {
      appendChunk(chunks, encodeAsciiLine(generateBoxLine(node), textEncoding));
    }
  }

  appendChunk(chunks, encodeAsciiLine(`PRINT ${normalized.settings.sets},${normalized.settings.copies}`, textEncoding));
  return concatUint8Arrays(chunks);
}

function maybeWarnUnitConversion(command, token, warnings) {
  if (token.unit === "inch") {
    warnings.push(`${command} 使用 inch 单位，编辑器会按当前 DPI 换算为 dots 并以 dot/mm 工作流继续编辑。`);
  }
}

function parseSizeLine(line, document, warnings) {
  const body = line.replace(/^SIZE\s+/i, "");
  const tokens = splitCsvArguments(body);
  if (tokens.length < 2) {
    return false;
  }

  const width = parseMeasurementToken(tokens[0], document.settings.dpi);
  const height = parseMeasurementToken(tokens[1], document.settings.dpi);
  if (!width || !height) {
    return false;
  }

  maybeWarnUnitConversion("SIZE", width, warnings);
  maybeWarnUnitConversion("SIZE", height, warnings);
  if (width.unit === height.unit && (width.unit === "mm" || width.unit === "dot")) {
    document.settings.measurementUnit = width.unit;
    document.settings.widthValue = width.unit === "mm" ? width.rawValue : width.dots;
    document.settings.heightValue = height.unit === "mm" ? height.rawValue : height.dots;
  }
  document.settings.width = width.dots;
  document.settings.height = height.dots;
  return true;
}

function parseGapLine(line, document, warnings) {
  const body = line.replace(/^GAP\s+/i, "");
  const tokens = splitCsvArguments(body);
  if (tokens.length < 1) {
    return false;
  }

  const gap = parseMeasurementToken(tokens[0], document.settings.dpi);
  const gapOffset = parseMeasurementToken(tokens[1] ?? "0", document.settings.dpi);
  if (!gap || !gapOffset) {
    return false;
  }

  maybeWarnUnitConversion("GAP", gap, warnings);
  maybeWarnUnitConversion("GAP", gapOffset, warnings);
  if (gap.unit === gapOffset.unit && (gap.unit === "mm" || gap.unit === "dot")) {
    document.settings.measurementUnit = gap.unit;
    document.settings.gapValue = gap.unit === "mm" ? gap.rawValue : gap.dots;
    document.settings.gapOffsetValue = gap.unit === "mm" ? gapOffset.rawValue : gapOffset.dots;
  }
  document.settings.gap = gap.dots;
  document.settings.gapOffset = gapOffset.dots;
  return true;
}

function parseDirectionLine(line, document) {
  const body = line.replace(/^DIRECTION\s+/i, "");
  const tokens = splitCsvArguments(body);
  if (tokens.length < 1) {
    return false;
  }

  document.settings.direction = clampNumber(tokens[0], 0, 1, document.settings.direction);
  document.settings.mirror = clampNumber(tokens[1] ?? 0, 0, 1, document.settings.mirror);
  return true;
}

function parseReferenceLine(line, document) {
  const body = line.replace(/^REFERENCE\s+/i, "");
  const tokens = splitCsvArguments(body);
  if (tokens.length < 2) {
    return false;
  }

  document.settings.referenceX = maybeInteger(tokens[0], document.settings.referenceX);
  document.settings.referenceY = maybeInteger(tokens[1], document.settings.referenceY);
  return true;
}

function parsePrintLine(line, document) {
  const body = line.replace(/^PRINT\s+/i, "");
  const tokens = splitCsvArguments(body);
  if (tokens.length < 1) {
    return false;
  }

  document.settings.sets = clampNumber(tokens[0], 1, 999999999, document.settings.sets);
  document.settings.copies = clampNumber(tokens[1] ?? 1, 1, 999999999, document.settings.copies);
  return true;
}

function parseTextLine(line) {
  const match = line.match(/^TEXT\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const args = splitCsvArguments(match[1]);
  if (args.length !== 7 && args.length !== 8) {
    return null;
  }

  return createNode("text", {
    x: maybeInteger(args[0], 0),
    y: maybeInteger(args[1], 0),
    font: stripTsplQuotes(args[2]),
    rotation: maybeInteger(args[3], 0),
    xMultiplier: maybeInteger(args[4], 1),
    yMultiplier: maybeInteger(args[5], 1),
    alignment: args.length === 8 ? maybeInteger(args[6], 0) : null,
    text: stripTsplQuotes(args.at(-1)),
  });
}

function parseBarcodeLine(line) {
  const match = line.match(/^BARCODE\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const args = splitCsvArguments(match[1]);
  if (args.length !== 9 && args.length !== 10) {
    return null;
  }

  return createNode("barcode", {
    x: maybeInteger(args[0], 0),
    y: maybeInteger(args[1], 0),
    barcodeType: stripTsplQuotes(args[2]),
    height: maybeInteger(args[3], 80),
    humanReadable: maybeInteger(args[4], 1),
    rotation: maybeInteger(args[5], 0),
    narrow: maybeInteger(args[6], 2),
    wide: maybeInteger(args[7], 4),
    alignment: args.length === 10 ? maybeInteger(args[8], 0) : null,
    data: stripTsplQuotes(args.at(-1)),
  });
}

function parseQrLine(line) {
  const match = line.match(/^QRCODE\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const args = splitCsvArguments(match[1]);
  if (args.length !== 7 && args.length !== 9) {
    return null;
  }

  return createNode("qr", {
    x: maybeInteger(args[0], 0),
    y: maybeInteger(args[1], 0),
    errorCorrection: String(args[2]).toUpperCase(),
    cellWidth: maybeInteger(args[3], 5),
    mode: String(args[4]).toUpperCase(),
    rotation: maybeInteger(args[5], 0),
    model: args.length === 9 ? String(args[6]).toUpperCase() : "M2",
    mask: args.length === 9 ? String(args[7]).toUpperCase() : "S7",
    data: stripTsplQuotes(args.at(-1)),
  });
}

function parseBarLine(line) {
  const match = line.match(/^BAR\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const args = splitCsvArguments(match[1]);
  if (args.length !== 4) {
    return null;
  }

  return createNode("bar", {
    x: maybeInteger(args[0], 0),
    y: maybeInteger(args[1], 0),
    width: maybeInteger(args[2], 1),
    height: maybeInteger(args[3], 1),
  });
}

function parseBoxLine(line) {
  const match = line.match(/^BOX\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const args = splitCsvArguments(match[1]);
  if (args.length !== 5) {
    return null;
  }

  const x1 = maybeInteger(args[0], 0);
  const y1 = maybeInteger(args[1], 0);
  const x2 = maybeInteger(args[2], x1 + 1);
  const y2 = maybeInteger(args[3], y1 + 1);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);

  return createNode("box", {
    x: left,
    y: top,
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
    thickness: maybeInteger(args[4], 1),
  });
}

function parseBitmapHexBlock(lines, index) {
  const match = lines[index].match(/^BITMAPHEX\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const args = splitCsvArguments(match[1]);
  if (args.length !== 5) {
    return null;
  }

  const hexLines = [];
  let cursor = index + 1;
  while (cursor < lines.length && !/^ENDBITMAPHEX$/i.test(lines[cursor].trim())) {
    hexLines.push(lines[cursor].trim());
    cursor += 1;
  }

  if (cursor >= lines.length) {
    return null;
  }

  const byteWidth = maybeInteger(args[2], 1);
  const height = maybeInteger(args[3], 1);
  const parsed = parseBitmapHex(byteWidth, height, hexLines.join(""));

  return {
    length: cursor - index + 1,
    node: createNode("image", {
      x: maybeInteger(args[0], 0),
      y: maybeInteger(args[1], 0),
      mode: maybeInteger(args[4], 0),
      bitmap: parsed.bitmap,
      bitmapHex: bitmapToHex(parsed.bitmap),
      byteWidth,
      bitmapWidth: parsed.bitmap.width,
      bitmapHeight: parsed.bitmap.height,
      previewDataUrl: parsed.previewDataUrl,
    }),
  };
}

function isStructuralLine(line) {
  const source = line.trim().toUpperCase();
  return !source || source === "CLS";
}

function parseTextDocument(lines) {
  const document = createEmptyDocument();
  const warnings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^SIZE\s+/i.test(trimmed)) {
      if (!parseSizeLine(trimmed, document, warnings)) {
        warnings.push(`SIZE 语法无法解析: ${trimmed}`);
      }
      continue;
    }

    if (/^GAP\s+/i.test(trimmed)) {
      if (!parseGapLine(trimmed, document, warnings)) {
        warnings.push(`GAP 语法无法解析: ${trimmed}`);
      }
      continue;
    }

    if (/^DIRECTION\s+/i.test(trimmed)) {
      if (!parseDirectionLine(trimmed, document)) {
        warnings.push(`DIRECTION 语法无法解析: ${trimmed}`);
      }
      continue;
    }

    if (/^REFERENCE\s+/i.test(trimmed)) {
      if (!parseReferenceLine(trimmed, document)) {
        warnings.push(`REFERENCE 语法无法解析: ${trimmed}`);
      }
      continue;
    }

    if (/^PRINT\s+/i.test(trimmed)) {
      if (!parsePrintLine(trimmed, document)) {
        warnings.push(`PRINT 语法无法解析: ${trimmed}`);
      }
      continue;
    }

    if (isStructuralLine(trimmed)) {
      continue;
    }

    if (trimmed === "__BITMAP_BINARY__") {
      document.nodes.push(createNode("raw", { text: trimmed }));
      continue;
    }

    const bitmapHex = parseBitmapHexBlock(lines, index);
    if (bitmapHex) {
      document.nodes.push(bitmapHex.node);
      index += bitmapHex.length - 1;
      continue;
    }

    const textNode = parseTextLine(trimmed);
    if (textNode) {
      document.nodes.push(textNode);
      continue;
    }

    const barcodeNode = parseBarcodeLine(trimmed);
    if (barcodeNode) {
      document.nodes.push(barcodeNode);
      continue;
    }

    const qrNode = parseQrLine(trimmed);
    if (qrNode) {
      document.nodes.push(qrNode);
      continue;
    }

    const barNode = parseBarLine(trimmed);
    if (barNode) {
      document.nodes.push(barNode);
      continue;
    }

    const boxNode = parseBoxLine(trimmed);
    if (boxNode) {
      document.nodes.push(boxNode);
      continue;
    }

    warnings.push(`以下 TSPL 保留为原始块: ${trimmed}`);
    document.nodes.push(createNode("raw", { text: line }));
  }

  return {
    document: normalizeDocument(document),
    warnings,
  };
}

function startsWithKeyword(bytes, index, keyword) {
  const upper = keyword.toUpperCase();
  let cursor = index;
  while (cursor < bytes.length && (bytes[cursor] === 32 || bytes[cursor] === 9)) {
    cursor += 1;
  }

  for (let offset = 0; offset < upper.length; offset += 1) {
    const code = bytes[cursor + offset];
    if (!code) {
      return false;
    }
    const char = String.fromCharCode(code).toUpperCase();
    if (char !== upper[offset]) {
      return false;
    }
  }
  return true;
}

function parseBinaryBitmapAt(bytes, index) {
  let cursor = index;
  let header = "";

  while (cursor < bytes.length && header.length < 120) {
    const byte = bytes[cursor];
    if (byte === 10 || byte === 13) {
      break;
    }

    if (byte < 32 || byte > 126) {
      break;
    }

    header += String.fromCharCode(byte);
    cursor += 1;

    const trimmed = header.trimStart();
    if (/^BITMAP\s+-?\d+\s*,\s*-?\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[012]\s*,$/i.test(trimmed)) {
      const match = trimmed.match(/^BITMAP\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([012])\s*,$/i);
      if (!match) {
        return null;
      }

      const x = maybeInteger(match[1], 0);
      const y = maybeInteger(match[2], 0);
      const byteWidth = maybeInteger(match[3], 1);
      const height = maybeInteger(match[4], 1);
      const mode = maybeInteger(match[5], 0);
      const byteLength = byteWidth * height;
      const dataStart = cursor;
      const dataEnd = dataStart + byteLength;
      if (dataEnd > bytes.length) {
        return null;
      }

      const bitmapBytes = bytes.slice(dataStart, dataEnd);
      const bitmap = bytesToBitmap(byteWidth, height, bitmapBytes, true);
      let nextIndex = dataEnd;
      if (bytes[nextIndex] === 13) {
        nextIndex += 1;
      }
      if (bytes[nextIndex] === 10) {
        nextIndex += 1;
      }

      return {
        nextIndex,
        node: createNode("image", {
          x,
          y,
          mode,
          bitmap,
          byteWidth,
          bitmapWidth: bitmap.width,
          bitmapHeight: bitmap.height,
          bitmapHex: bitmapToHex(bitmap),
          previewDataUrl: bitmapToSvgDataUrl(bitmap, 1),
        }),
      };
    }
  }

  return null;
}

export function parseTsplPayload(payload) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const lines = [];
  const binaryNodes = [];
  const warnings = [];

  let cursor = 0;
  while (cursor < bytes.length) {
    if (bytes[cursor] === 13 || bytes[cursor] === 10) {
      cursor += 1;
      continue;
    }

    if (startsWithKeyword(bytes, cursor, "BITMAP")) {
      const parsed = parseBinaryBitmapAt(bytes, cursor);
      if (parsed) {
        lines.push("__BITMAP_BINARY__");
        binaryNodes.push(parsed.node);
        cursor = parsed.nextIndex;
        continue;
      }
    }

    const lineStart = cursor;
    while (cursor < bytes.length && bytes[cursor] !== 13 && bytes[cursor] !== 10) {
      cursor += 1;
    }
    const lineBytes = bytes.slice(lineStart, cursor);
    lines.push(new TextDecoder().decode(lineBytes));
    if (bytes[cursor] === 13) {
      cursor += 1;
    }
    if (bytes[cursor] === 10) {
      cursor += 1;
    }
  }

  const { document, warnings: textWarnings } = parseTextDocument(lines);
  let bitmapCursor = 0;
  document.nodes = document.nodes.flatMap((node) => {
    if (node.kind === "raw" && node.text === "__BITMAP_BINARY__") {
      const replacement = binaryNodes[bitmapCursor];
      bitmapCursor += 1;
      return replacement ? [replacement] : [];
    }
    return [node];
  });

  if (binaryNodes.length > 0) {
    warnings.push("文件中的 BITMAP 已按真实字节流解析；源码编辑区会改用可读的 BITMAPHEX 表示。");
  }

  return {
    document: normalizeDocument(document),
    warnings: [...textWarnings, ...warnings],
  };
}

export function parseTsplSource(source) {
  return parseTextDocument(normalizeLineBreaks(source).split("\n"));
}

function buildPseudoBarcodePattern(data, narrow, wide) {
  const bars = [];
  for (const char of String(data)) {
    const value = char.charCodeAt(0);
    const binary = value.toString(2).padStart(8, "0");
    for (const bit of binary) {
      bars.push(bit === "1" ? Math.max(wide, narrow + 1) : narrow);
      bars.push(narrow);
    }
  }

  return bars;
}

export function buildBarcodePreviewDataUrl(node) {
  const bars = buildPseudoBarcodePattern(node.data, node.narrow, node.wide);
  const width = Math.max(140, bars.reduce((sum, value) => sum + value, 0) + 24);
  const height = Math.max(48, node.height + (node.humanReadable > 0 ? 24 : 0) + 8);

  let cursor = 12;
  const rects = [];
  for (let index = 0; index < bars.length; index += 2) {
    const barWidth = bars[index];
    rects.push(`<rect x="${cursor}" y="4" width="${barWidth}" height="${node.height}" fill="#111111" />`);
    cursor += barWidth + (bars[index + 1] ?? node.narrow);
  }

  const text = node.humanReadable > 0
    ? `<text x="${width / 2}" y="${height - 4}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="14" fill="#111111">${escapeXml(node.data)}</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff" />${rects.join("")}${text}</svg>`;
  return svgToDataUrl(svg);
}

function finderRects(offsetX, offsetY, unit) {
  const size = 7 * unit;
  return [
    `<rect x="${offsetX}" y="${offsetY}" width="${size}" height="${size}" fill="#111111" />`,
    `<rect x="${offsetX + unit}" y="${offsetY + unit}" width="${size - 2 * unit}" height="${size - 2 * unit}" fill="#ffffff" />`,
    `<rect x="${offsetX + 2 * unit}" y="${offsetY + 2 * unit}" width="${size - 4 * unit}" height="${size - 4 * unit}" fill="#111111" />`,
  ];
}

export function buildQrPreviewDataUrl(node) {
  const seed = nextRandom(pseudoSeed(`${node.data}|${node.errorCorrection}|${node.mask}|${node.mode}`));
  const moduleCount = 21 + Math.min(5, Math.floor(String(node.data).length / 16)) * 4;
  const unit = Math.max(2, node.cellWidth);
  const size = moduleCount * unit;
  const rects = [
    ...finderRects(0, 0, unit),
    ...finderRects(size - 7 * unit, 0, unit),
    ...finderRects(0, size - 7 * unit, unit),
  ];

  const occupied = new Set();
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      occupied.add(`${row}:${col}`);
      occupied.add(`${row}:${moduleCount - 7 + col}`);
      occupied.add(`${moduleCount - 7 + row}:${col}`);
    }
  }

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (occupied.has(`${row}:${col}`)) {
        continue;
      }
      if (seed() > 0.52) {
        rects.push(`<rect x="${col * unit}" y="${row * unit}" width="${unit}" height="${unit}" fill="#111111" />`);
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#ffffff" />${rects.join("")}</svg>`;
  return svgToDataUrl(svg);
}

function estimateTextMetrics(node) {
  const metric = resolveFontMetric(node.font);
  const width = Math.max(24, estimateTextLineWidth(node.text, metric, node.xMultiplier));
  const height = Math.round(metric.height * node.yMultiplier);
  return {
    width,
    height,
  };
}

function estimateBarcodeMetrics(node) {
  const pattern = buildPseudoBarcodePattern(node.data, node.narrow, node.wide);
  const width = Math.max(120, pattern.reduce((sum, value) => sum + value, 0) + 24);
  const height = Math.max(48, node.height + (node.humanReadable > 0 ? 24 : 0) + 8);
  return { width, height };
}

function estimateQrMetrics(node) {
  const modules = 21 + Math.min(5, Math.floor(String(node.data).length / 16)) * 4;
  const width = modules * Math.max(2, node.cellWidth);
  return { width, height: width };
}

function estimateBarMetrics(node) {
  return {
    width: Math.max(1, Math.round(node.width)),
    height: Math.max(1, Math.round(node.height)),
  };
}

function estimateBoxMetrics(node) {
  return {
    width: Math.max(1, Math.round(node.width)),
    height: Math.max(1, Math.round(node.height)),
  };
}

export function getNodeGeometry(node) {
  let contentWidth = 0;
  let contentHeight = 0;

  switch (node.kind) {
    case "text": {
      const metrics = estimateTextMetrics(node);
      contentWidth = metrics.width;
      contentHeight = metrics.height;
      break;
    }
    case "barcode": {
      const metrics = estimateBarcodeMetrics(node);
      contentWidth = metrics.width;
      contentHeight = metrics.height;
      break;
    }
    case "qr": {
      const metrics = estimateQrMetrics(node);
      contentWidth = metrics.width;
      contentHeight = metrics.height;
      break;
    }
    case "image":
      contentWidth = node.bitmapWidth ?? node.bitmap?.width ?? 1;
      contentHeight = node.bitmapHeight ?? node.bitmap?.height ?? 1;
      break;
    case "bar": {
      const metrics = estimateBarMetrics(node);
      contentWidth = metrics.width;
      contentHeight = metrics.height;
      break;
    }
    case "box": {
      const metrics = estimateBoxMetrics(node);
      contentWidth = metrics.width;
      contentHeight = metrics.height;
      break;
    }
    default:
      return {
        boxWidth: 0,
        boxHeight: 0,
        contentWidth: 0,
        contentHeight: 0,
        transform: "none",
      };
  }

  const rotation = maybeInteger(node.rotation, 0);
  switch (rotation) {
    case 90:
      return {
        boxWidth: contentHeight,
        boxHeight: contentWidth,
        contentWidth,
        contentHeight,
        transform: `translate(${contentHeight}px, 0) rotate(90deg)`,
      };
    case 180:
      return {
        boxWidth: contentWidth,
        boxHeight: contentHeight,
        contentWidth,
        contentHeight,
        transform: `translate(${contentWidth}px, ${contentHeight}px) rotate(180deg)`,
      };
    case 270:
      return {
        boxWidth: contentHeight,
        boxHeight: contentWidth,
        contentWidth,
        contentHeight,
        transform: `translate(0, ${contentWidth}px) rotate(270deg)`,
      };
    default:
      return {
        boxWidth: contentWidth,
        boxHeight: contentHeight,
        contentWidth,
        contentHeight,
        transform: "none",
      };
  }
}

export function getNodePreviewDataUrl(node) {
  switch (node.kind) {
    case "barcode":
      return buildBarcodePreviewDataUrl(node);
    case "qr":
      return buildQrPreviewDataUrl(node);
    case "image":
      return node.previewDataUrl || bitmapToSvgDataUrl(node.bitmap, 1);
    default:
      return "";
  }
}

export function summarizeNode(node) {
  switch (node.kind) {
    case "text":
      return node.text || "空文字";
    case "barcode":
      return `${node.barcodeType} · ${node.data || "空数据"}`;
    case "qr":
      return `QR · ${node.data || "空数据"}`;
    case "image":
      return `${node.bitmapWidth} x ${node.bitmapHeight}`;
    case "bar":
      return `BAR · ${Math.round(node.width)} x ${Math.round(node.height)}`;
    case "box":
      return `BOX · ${Math.round(node.width)} x ${Math.round(node.height)}`;
    case "raw":
      return node.text.split("\n")[0]?.slice(0, 48) || "原始命令";
    default:
      return "";
  }
}

function serializeNodeForStorage(node) {
  switch (node.kind) {
    case "image":
      return {
        id: node.id,
        kind: node.kind,
        name: node.name,
        x: node.x,
        y: node.y,
        rotation: node.rotation,
        mode: node.mode,
        threshold: node.threshold,
        invert: node.invert,
        sourceDataUrl: node.sourceDataUrl,
        bitmapHex: node.bitmapHex,
        byteWidth: node.byteWidth,
        bitmapWidth: node.bitmapWidth,
        bitmapHeight: node.bitmapHeight,
      };
    default:
      return JSON.parse(JSON.stringify(node));
  }
}

export function serializeDocumentForStorage(document) {
  const normalized = normalizeDocument(document);
  return {
    settings: JSON.parse(JSON.stringify(normalized.settings)),
    nodes: normalized.nodes.map((node) => serializeNodeForStorage(node)),
  };
}

export function renderDocumentWithVariables(document, variables) {
  const normalized = normalizeDocument(document);
  const renderedNodes = normalized.nodes.map((node) => {
    if (node.kind === "text") {
      return { ...node, text: renderTemplateString(node.text, variables) };
    }
    if (node.kind === "barcode" || node.kind === "qr") {
      return { ...node, data: renderTemplateString(node.data, variables) };
    }
    return node;
  });

  return normalizeDocument({
    settings: normalized.settings,
    nodes: renderedNodes,
  });
}

export function buildProjectFile({
  name = "未命名工程",
  editorVersion = "1.0",
  createdAt = null,
  modifiedAt = null,
  document,
  variables = [],
  source = "",
  sourceDirty = false,
} = {}) {
  const normalized = normalizeDocument(document);
  const generatedSource = generateTsplSource(normalized);
  const serialized = serializeDocumentForStorage(normalized);
  const timestamp = new Date().toISOString();

  return {
    schema: PROJECT_FILE_SCHEMA,
    format: PROJECT_FILE_FORMAT,
    name: String(name || "未命名工程"),
    version: String(editorVersion || "1.0"),
    created: createdAt || timestamp,
    modified: modifiedAt || timestamp,
    paper: serialized.settings,
    elements: serialized.nodes,
    variables: normalizeVariables(variables),
    tspl: {
      source: typeof source === "string" && source.length > 0 ? source : generatedSource,
      generatedSource,
      sourceDirty: Boolean(sourceDirty),
    },
  };
}

export function parseProjectFile(projectLike) {
  const project = typeof projectLike === "string" ? JSON.parse(projectLike) : projectLike;
  if (!project || typeof project !== "object") {
    throw new Error("工程文件不是有效的 JSON 对象。");
  }
  if (project.schema !== PROJECT_FILE_SCHEMA) {
    throw new Error(`不支持的工程文件 schema: ${String(project.schema ?? "")}`);
  }

  const document = normalizeDocument({
    settings: project.paper ?? {},
    nodes: Array.isArray(project.elements) ? project.elements : [],
  });
  const generatedSource = generateTsplSource(document);
  const sourceText =
    typeof project.tspl?.source === "string" && project.tspl.source.length > 0
      ? project.tspl.source
      : typeof project.tspl?.generatedSource === "string" && project.tspl.generatedSource.length > 0
        ? project.tspl.generatedSource
        : generatedSource;

  return {
    name: String(project.name || "未命名工程"),
    version: String(project.version || ""),
    created: typeof project.created === "string" && project.created.length > 0 ? project.created : null,
    modified: typeof project.modified === "string" && project.modified.length > 0 ? project.modified : null,
    format: String(project.format || ""),
    document,
    variables: normalizeVariables(project.variables),
    sourceText,
    sourceDirty: Boolean(project.tspl?.sourceDirty),
    generatedSource,
    project,
  };
}

export function cloneDocument(document) {
  return JSON.parse(JSON.stringify(normalizeDocument(document)));
}

export { DEFAULT_SETTINGS };
