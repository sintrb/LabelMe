import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectFile,
  createNode,
  extractTemplateVariables,
  generateTsplPayload,
  generateTsplSource,
  getNodeGeometry,
  normalizeVariables,
  parseProjectFile,
  parseTsplPayload,
  parseTsplSource,
  renderDocumentWithVariables,
  renderTemplateString,
} from "../tspl-core.mjs";

test("generateTsplSource emits TSPL settings and supported commands", () => {
  const document = {
    settings: {
      dpi: 203,
      width: 576,
      height: 320,
      gap: 24,
      gapOffset: 0,
      direction: 1,
      mirror: 0,
      referenceX: 0,
      referenceY: 0,
      sets: 2,
      copies: 3,
    },
    nodes: [
      createNode("text", {
        id: "text-1",
        text: "SKU-001",
        x: 10,
        y: 20,
      }),
      createNode("barcode", {
        id: "barcode-1",
        data: "ABC123",
        humanReadable: 1,
      }),
      createNode("qr", {
        id: "qr-1",
        data: "https://example.com",
        errorCorrection: "H",
        mask: "S4",
        mode: "A",
      }),
      createNode("bar", {
        id: "bar-1",
        x: 0,
        y: 0,
        width: 100,
        height: 2,
      }),
      createNode("box", {
        id: "box-1",
        x: 8,
        y: 10,
        width: 40,
        height: 30,
        thickness: 4,
      }),
      createNode("raw", {
        id: "raw-1",
        text: "ERASE 0,0,10,10",
      }),
    ],
  };

  const source = generateTsplSource(document);

  assert.match(source, /^SIZE 576 dot,320 dot$/m);
  assert.match(source, /^GAP 24 dot,0 dot$/m);
  assert.match(source, /^DIRECTION 1,0$/m);
  assert.match(source, /^REFERENCE 0,0$/m);
  assert.match(source, /^CLS$/m);
  assert.match(source, /^TEXT 10,20,"3",0,1,1,"SKU-001"$/m);
  assert.match(source, /^BARCODE 30,80,"128",80,1,0,2,4,"ABC123"$/m);
  assert.match(source, /^QRCODE 30,190,H,5,A,0,M2,S4,"https:\/\/example\.com"$/m);
  assert.match(source, /^BAR 0,0,100,2$/m);
  assert.match(source, /^BOX 8,10,48,40,4$/m);
  assert.match(source, /^ERASE 0,0,10,10$/m);
  assert.match(source, /^PRINT 2,3$/m);
});

test("parseTsplSource handles editor-friendly BITMAPHEX blocks and preserves raw commands", () => {
  const source = `SIZE 60 mm,40 mm
GAP 2 mm,0 mm
DIRECTION 1,0
REFERENCE 0,0
CLS
TEXT 12,18,"3",0,1,1,"标题"
BAR 0,0,100,2
BOX 20,30,120,90,4
BITMAPHEX 32,40,1,2,0
AA55
ENDBITMAPHEX
ERASE 0,0,20,20
PRINT 1,1
`;

  const { document, warnings } = parseTsplSource(source);

  assert.equal(document.nodes[0].kind, "text");
  assert.equal(document.nodes[1].kind, "bar");
  assert.equal(document.nodes[2].kind, "box");
  assert.equal(document.nodes[3].kind, "image");
  assert.equal(document.nodes[3].bitmapHex, "AA55");
  assert.equal(document.nodes[4].kind, "raw");
  assert.equal(document.nodes[1].width, 100);
  assert.equal(document.nodes[2].thickness, 4);
  assert.equal(document.settings.direction, 1);
  assert.equal(document.settings.mirror, 0);
  assert.equal(document.settings.sets, 1);
  assert.equal(document.settings.copies, 1);
  assert.equal(document.settings.measurementUnit, "mm");
  assert.equal(document.settings.widthValue, 60);
  assert.equal(document.settings.gapValue, 2);
  assert.match(generateTsplSource(document), /^SIZE 60 mm,40 mm$/m);
  assert.match(generateTsplSource(document), /^GAP 2 mm,0 mm$/m);
  assert.ok(warnings.some((warning) => warning.includes("保留为原始块")));
});

test("generateTsplSource honors mm paper settings when selected", () => {
  const document = {
    settings: {
      dpi: 203,
      width: 480,
      height: 320,
      gap: 16,
      gapOffset: 0,
      measurementUnit: "mm",
      widthValue: 60,
      heightValue: 40,
      gapValue: 2,
      gapOffsetValue: 0,
      direction: 1,
      mirror: 0,
      referenceX: 0,
      referenceY: 0,
      sets: 1,
      copies: 1,
    },
    nodes: [],
  };

  const source = generateTsplSource(document);

  assert.match(source, /^SIZE 60 mm,40 mm$/m);
  assert.match(source, /^GAP 2 mm,0 mm$/m);
});

test("generateTsplPayload exports binary BITMAP and parseTsplPayload restores it", () => {
  const document = {
    settings: {
      dpi: 203,
      width: 128,
      height: 100,
      gap: 8,
      gapOffset: 0,
      direction: 1,
      mirror: 0,
      referenceX: 0,
      referenceY: 0,
      sets: 1,
      copies: 1,
    },
    nodes: [
      createNode("text", {
        id: "text-1",
        text: "OK",
        x: 10,
        y: 10,
      }),
      createNode("bar", {
        id: "bar-payload",
        x: 14,
        y: 14,
        width: 32,
        height: 3,
      }),
      createNode("box", {
        id: "box-payload",
        x: 16,
        y: 22,
        width: 20,
        height: 12,
        thickness: 2,
      }),
      createNode("image", {
        id: "image-1",
        x: 12,
        y: 18,
        mode: 0,
        byteWidth: 1,
        bitmapWidth: 8,
        bitmapHeight: 2,
        bitmapHex: "AA55",
      }),
    ],
  };

  const payload = generateTsplPayload(document);
  const textPrefix = Buffer.from(payload).toString("latin1");

  assert.match(textPrefix, /SIZE 128 dot,100 dot/);
  assert.match(textPrefix, /BAR 14,14,32,3/);
  assert.match(textPrefix, /BOX 16,22,36,34,2/);
  assert.match(textPrefix, /BITMAP 12,18,1,2,0,/);

  const { document: parsed, warnings } = parseTsplPayload(payload);
  assert.equal(parsed.nodes[0].kind, "text");
  assert.equal(parsed.nodes[1].kind, "bar");
  assert.equal(parsed.nodes[2].kind, "box");
  assert.equal(parsed.nodes[3].kind, "image");
  assert.equal(parsed.nodes[3].bitmapHex, "AA55");
  assert.ok(warnings.some((warning) => warning.includes("BITMAP")));
});

test("generateTsplPayload can encode text commands as GBK", () => {
  const document = {
    settings: {
      dpi: 203,
      width: 128,
      height: 80,
      gap: 0,
      gapOffset: 0,
      direction: 1,
      mirror: 0,
      referenceX: 0,
      referenceY: 0,
      sets: 1,
      copies: 1,
    },
    nodes: [
      createNode("text", {
        id: "text-gbk",
        text: "中文",
        x: 10,
        y: 10,
      }),
    ],
  };

  const payload = generateTsplPayload(document, { textEncoding: "gbk" });
  const payloadBuffer = Buffer.from(payload);
  assert.notEqual(payloadBuffer.indexOf(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])), -1);
});

test("template variables render into text barcode and qrcode data", () => {
  const variables = normalizeVariables([
    { name: "名称", key: "name", value: "卡罗拉" },
    { name: "等级", key: "level", value: "A级别" },
  ]);
  const document = {
    settings: {
      dpi: 203,
      width: 128,
      height: 80,
      gap: 0,
      gapOffset: 0,
      direction: 1,
      mirror: 0,
      referenceX: 0,
      referenceY: 0,
      sets: 1,
      copies: 1,
    },
    nodes: [
      createNode("text", {
        text: "{{name}}-{{level}}",
      }),
      createNode("barcode", {
        data: "{{name}}",
      }),
      createNode("qr", {
        data: "https://example.com/{{level}}",
      }),
    ],
  };

  const rendered = renderDocumentWithVariables(document, variables);
  assert.equal(renderTemplateString("{{name}}-{{level}}", variables), "卡罗拉-A级别");
  assert.equal(rendered.nodes[0].text, "卡罗拉-A级别");
  assert.equal(rendered.nodes[1].data, "卡罗拉");
  assert.equal(rendered.nodes[2].data, "https://example.com/A级别");
});

test("extractTemplateVariables finds placeholders and preserves matching values", () => {
  const variables = extractTemplateVariables(
    'TEXT 10,10,"3",0,1,1,"{{name}}-{{level}}"\nBARCODE 20,20,"128",80,1,0,2,4,"{{name}}"',
    [
      { name: "名称", key: "name", value: "卡罗拉" },
      { name: "旧变量", key: "old", value: "old-value" },
    ],
  );

  assert.deepEqual(variables, [
    { name: "名称", key: "name", value: "卡罗拉" },
    { name: "level", key: "level", value: "" },
  ]);
});

test("TSS/TST fonts count ASCII as half-width in geometry estimation", () => {
  const geometry = getNodeGeometry(
    createNode("text", {
      font: "TSS24.BF2",
      text: "AB中",
      xMultiplier: 1,
      yMultiplier: 1,
    }),
  );

  assert.equal(geometry.contentWidth, 48);
  assert.equal(geometry.contentHeight, 24);
});

test("image bitmap polarity matches TSPL BITMAP semantics", () => {
  const document = {
    settings: {
      dpi: 203,
      width: 64,
      height: 64,
      gap: 0,
      gapOffset: 0,
      direction: 1,
      mirror: 0,
      referenceX: 0,
      referenceY: 0,
      sets: 1,
      copies: 1,
    },
    nodes: [
      createNode("image", {
        id: "image-polarity",
        x: 0,
        y: 0,
        mode: 0,
        byteWidth: 1,
        bitmapWidth: 8,
        bitmapHeight: 1,
        bitmap: {
          width: 8,
          height: 1,
          pixels: [1, 0, 0, 0, 0, 0, 0, 0],
        },
      }),
    ],
  };

  const source = generateTsplSource(document);
  assert.match(source, /BITMAPHEX 0,0,1,1,0\n80\nENDBITMAPHEX/);

  const payload = generateTsplPayload(document);
  const header = Buffer.from("BITMAP 0,0,1,1,0,", "latin1");
  const payloadBuffer = Buffer.from(payload);
  const headerOffset = payloadBuffer.indexOf(header);
  assert.notEqual(headerOffset, -1);
  assert.equal(payloadBuffer[headerOffset + header.length], 0x7f);

  const { document: parsed } = parseTsplSource(source);
  assert.equal(parsed.nodes[0].kind, "image");
  assert.deepEqual(parsed.nodes[0].bitmap.pixels.slice(0, 8), [1, 0, 0, 0, 0, 0, 0, 0]);

  const { document: parsedPayload } = parseTsplPayload(payload);
  assert.equal(parsedPayload.nodes[0].kind, "image");
  assert.deepEqual(parsedPayload.nodes[0].bitmap.pixels.slice(0, 8), [1, 0, 0, 0, 0, 0, 0, 0]);
});

test("project files preserve paper, elements, and source draft state", () => {
  const document = {
    settings: {
      dpi: 203,
      width: 320,
      height: 180,
      gap: 12,
      gapOffset: 0,
      direction: 1,
      mirror: 0,
      referenceX: 0,
      referenceY: 0,
      sets: 1,
      copies: 2,
    },
    nodes: [
      createNode("text", {
        id: "text-project",
        text: "工程内容",
        x: 18,
        y: 22,
      }),
      createNode("raw", {
        id: "raw-project",
        text: "BAR 0,0,20,2",
      }),
    ],
  };

  const project = buildProjectFile({
    name: "我的标签",
    editorVersion: "1.2",
    createdAt: "2026-11-12T10:22:43.000Z",
    modifiedAt: "2026-11-12T10:30:43.000Z",
    document,
    variables: [
      { name: "名称", key: "name", value: "卡罗拉" },
      { name: "等级", key: "level", value: "A级别" },
    ],
    source: 'SIZE 320 dot,180 dot\nCLS\nTEXT 18,22,"3",0,1,1,"草稿源码"\nPRINT 1,2\n',
    sourceDirty: true,
  });

  assert.equal(project.name, "我的标签");
  assert.equal(project.version, "1.2");
  assert.equal(project.paper.width, 320);
  assert.equal(project.elements.length, 2);
  assert.equal(project.variables.length, 2);
  assert.equal(project.tspl.sourceDirty, true);
  assert.equal("bitmap" in project.elements[0], false);
  assert.equal("previewDataUrl" in project.elements[0], false);

  const parsed = parseProjectFile(JSON.stringify(project));
  assert.equal(parsed.name, "我的标签");
  assert.equal(parsed.created, "2026-11-12T10:22:43.000Z");
  assert.equal(parsed.modified, "2026-11-12T10:30:43.000Z");
  assert.equal(parsed.document.settings.height, 180);
  assert.equal(parsed.document.nodes[0].kind, "text");
  assert.equal(parsed.document.nodes[1].kind, "raw");
  assert.equal(parsed.variables[0].key, "name");
  assert.equal(parsed.variables[1].value, "A级别");
  assert.equal(parsed.sourceDirty, true);
  assert.match(parsed.sourceText, /草稿源码/);
});

test("project image elements omit cached pixels and preview while remaining restorable", () => {
  const project = buildProjectFile({
    name: "图片工程",
    document: {
      settings: {
        dpi: 203,
        width: 100,
        height: 100,
        gap: 0,
        gapOffset: 0,
        direction: 1,
        mirror: 0,
        referenceX: 0,
        referenceY: 0,
        sets: 1,
        copies: 1,
      },
      nodes: [
        createNode("image", {
          id: "img-compact",
          x: 4,
          y: 5,
          bitmapWidth: 8,
          bitmapHeight: 1,
          byteWidth: 1,
          bitmapHex: "80",
          sourceDataUrl: "data:image/png;base64,AAAA",
        }),
      ],
    },
  });

  assert.equal(project.elements[0].bitmap, undefined);
  assert.equal(project.elements[0].previewDataUrl, undefined);
  assert.equal(project.elements[0].bitmapHex, "80");

  const parsed = parseProjectFile(project);
  assert.equal(parsed.document.nodes[0].kind, "image");
  assert.equal(parsed.document.nodes[0].bitmapHex, "80");
  assert.deepEqual(parsed.document.nodes[0].bitmap.pixels.slice(0, 8), [1, 0, 0, 0, 0, 0, 0, 0]);
});
