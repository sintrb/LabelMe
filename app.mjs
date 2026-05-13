import {
  bitmapToHex,
  bitmapToSvgDataUrl,
  buildProjectFile,
  cloneDocument,
  createEmptyDocument,
  createNode,
  createSampleDocument,
  extractTemplateVariables,
  generateTsplPayload,
  generateTsplSource,
  getNodeGeometry,
  getNodePreviewDataUrl,
  normalizeDocument,
  normalizeVariables,
  parseProjectFile,
  parseTsplPayload,
  parseTsplSource,
  rasterizeImageFromDataUrl,
  renderDocumentWithVariables,
  renderTemplateString,
  serializeDocumentForStorage,
  scaleBitmap,
  summarizeNode,
} from "./tspl-core.mjs";

const EDITOR_VERSION = "1.0";
const DEFAULT_PROJECT_NAME = "未命名工程";

const state = {
  document: normalizeDocument(createSampleDocument()),
  selectedId: null,
  elementClipboard: null,
  warnings: [],
  sourceDirty: false,
  zoom: 1,
  pendingImagePlacement: { x: 24, y: 24 },
  variables: [],
  remoteConfig: {
    getEndpoint: "",
    setEndpoint: "",
  },
  propertyPanels: {
    textAdvanced: false,
    barcodeAdvanced: false,
    qrAdvanced: false,
    imageAdvanced: false,
  },
  ble: {
    device: null,
    server: null,
    service: null,
    characteristic: null,
    writeMode: null,
    connecting: false,
  },
  project: {
    name: DEFAULT_PROJECT_NAME,
    created: null,
    modified: null,
  },
};

const TEXT_FONT_OPTIONS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "TSS16.BF2",
  "TSS24.BF2",
  "TSS32.BF2",
  "TSS48.BF2",
  "TST16.BF2",
  "TST24.BF2",
  "TST32.BF2",
  "TST48.BF2",
];

const DEFAULT_BLE_SERVICE_CANDIDATES = [
  "0xFE7D",
  "0x1E4D",
  "0x8841",
  "0000fff8-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  "0000ae30-0000-1000-8000-00805f9b34fb",
];

const DEFAULT_BLE_SERVICE_TEXT = DEFAULT_BLE_SERVICE_CANDIDATES.join("\n");
const LOCAL_EDITOR_STATE_KEY = "labelme:editor-state:v1";
let persistEditorStateTimer = 0;
const PAPER_MEASUREMENT_FIELDS = ["width", "height", "gap", "gapOffset"];
const PAPER_MEASUREMENT_MIN = {
  width: 80,
  height: 40,
  gap: 0,
  gapOffset: 0,
};

const elements = {
  documentSettings: document.getElementById("documentSettings"),
  paperStage: document.getElementById("paperStage"),
  paperFace: document.getElementById("paperFace"),
  paperGap: document.getElementById("paperGap"),
  canvasItems: document.getElementById("canvasItems"),
  layerList: document.getElementById("layerList"),
  propertiesPanel: document.getElementById("propertiesPanel"),
  sourceEditor: document.getElementById("sourceEditor"),
  warningBadge: document.getElementById("warningBadge"),
  statusLine: document.getElementById("statusLine"),
  projectNameInput: document.getElementById("projectNameInput"),
  paperUnitInput: document.getElementById("paperUnitInput"),
  variablesList: document.getElementById("variablesList"),
  addVariableButton: document.getElementById("addVariableButton"),
  zoomRange: document.getElementById("zoomRange"),
  zoomValue: document.getElementById("zoomValue"),
  openFileButton: document.getElementById("openFileButton"),
  saveFileButton: document.getElementById("saveFileButton"),
  remoteLoadButton: document.getElementById("remoteLoadButton"),
  remoteSaveButton: document.getElementById("remoteSaveButton"),
  exportTsplButton: document.getElementById("exportTsplButton"),
  applySourceButton: document.getElementById("applySourceButton"),
  clearElementsButton: document.getElementById("clearElementsButton"),
  newDocumentButton: document.getElementById("newDocumentButton"),
  loadSampleButton: document.getElementById("loadSampleButton"),
  openFileInput: document.getElementById("openFileInput"),
  imageFileInput: document.getElementById("imageFileInput"),
  palette: document.getElementById("palette"),
  canvasDropHint: document.getElementById("canvasDropHint"),
  bulkOffsetSettings: document.getElementById("bulkOffsetSettings"),
  applyBulkOffsetButton: document.getElementById("applyBulkOffsetButton"),
  bleConnectButton: document.getElementById("bleConnectButton"),
  blePrintButton: document.getElementById("blePrintButton"),
  bleRefreshButton: document.getElementById("bleRefreshButton"),
  bleDisconnectButton: document.getElementById("bleDisconnectButton"),
  bleDeviceValue: document.getElementById("bleDeviceValue"),
  bleServiceValue: document.getElementById("bleServiceValue"),
  bleCharacteristicValue: document.getElementById("bleCharacteristicValue"),
  bleWriteModeValue: document.getElementById("bleWriteModeValue"),
  bleNamePrefixInput: document.getElementById("bleNamePrefixInput"),
  bleServiceInput: document.getElementById("bleServiceInput"),
  bleCharacteristicInput: document.getElementById("bleCharacteristicInput"),
  bleEncodingInput: document.getElementById("bleEncodingInput"),
  bleChunkSizeInput: document.getElementById("bleChunkSizeInput"),
  bleWriteDelayInput: document.getElementById("bleWriteDelayInput"),
  confirmDialog: document.getElementById("confirmDialog"),
  confirmDialogTitle: document.getElementById("confirmDialogTitle"),
  confirmDialogMessage: document.getElementById("confirmDialogMessage"),
  confirmDialogConfirmButton: document.getElementById("confirmDialogConfirmButton"),
};

function selectedNode() {
  return state.document.nodes.find((node) => node.id === state.selectedId) ?? null;
}

function ensureSelection() {
  if (state.selectedId === null) {
    return;
  }
  if (!state.document.nodes.some((node) => node.id === state.selectedId)) {
    state.selectedId = state.document.nodes[0]?.id ?? null;
  }
}

function setStatus(message) {
  elements.statusLine.textContent = message;
  const tone = resolveStatusTone(message);
  elements.statusLine.classList.toggle("status-neutral", tone === "neutral");
  elements.statusLine.classList.toggle("status-success", tone === "success");
  elements.statusLine.classList.toggle("status-error", tone === "error");
}

function resolveStatusTone(message) {
  const text = String(message ?? "");
  if (!text) {
    return "neutral";
  }
  if (/(失败|错误|无效|无法|不支持|不存在|打开失败|保存失败)/.test(text)) {
    return "error";
  }
  if (/(未应用修改|取消|连接中|正在)/.test(text)) {
    return "neutral";
  }
  if (/(成功|已|已通过|已从|已连接|已刷新|已保存|已导出|已同步|已加载|已复制|已粘贴|已删除|已断开)/.test(text)) {
    return "success";
  }
  return "neutral";
}

function createProjectState(overrides = {}) {
  return {
    name: typeof overrides.name === "string" && overrides.name.trim() ? overrides.name.trim() : DEFAULT_PROJECT_NAME,
    created: typeof overrides.created === "string" && overrides.created ? overrides.created : null,
    modified: typeof overrides.modified === "string" && overrides.modified ? overrides.modified : null,
  };
}

function getDefaultVariable(index = state.variables.length) {
  const ordinal = index + 1;
  return {
    name: `变量${ordinal}`,
    key: `var${ordinal}`,
    value: "",
  };
}

function resolveNodeVariables(node) {
  if (node.kind === "text") {
    return {
      ...node,
      text: renderTemplateString(node.text, state.variables),
    };
  }
  if (node.kind === "barcode" || node.kind === "qr") {
    return {
      ...node,
      data: renderTemplateString(node.data, state.variables),
    };
  }
  return node;
}

function getRenderableGeometry(node) {
  return getNodeGeometry(resolveNodeVariables(node));
}

function getTextPreviewFontProfile(fontName) {
  const normalized = String(fontName ?? "3").trim().toUpperCase();
  const dotBaseFamily = '"LabelMeDotBase", "VonwaonBitmap 16px", "凤凰点阵体 16px", monospace';
  const condensedFamily = '"Arial Narrow", "Helvetica Neue", "Noto Sans SC", sans-serif';

  const fixedMetrics = {
    1: { width: 8, height: 12 },
    2: { width: 12, height: 20 },
    3: { width: 16, height: 24 },
    4: { width: 24, height: 32 },
    5: { width: 32, height: 48 },
    6: { width: 14, height: 19 },
    7: { width: 21, height: 27 },
    8: { width: 14, height: 25 },
  };

  if (normalized === "0") {
    return {
      family: condensedFamily,
      baseSize: 16,
      scaleX: 18 / 16,
      scaleY: 28 / 16,
      fontWeight: "700",
      letterSpacing: "-0.02em",
    };
  }

  const scalableBitmapMatch = normalized.match(/^TS[ST](\d+)\.BF2$/);
  if (scalableBitmapMatch) {
    const size = Math.max(8, Math.min(96, Number.parseInt(scalableBitmapMatch[1], 10) || 24));
    return {
      family: dotBaseFamily,
      baseSize: 16,
      scaleX: size / 16,
      scaleY: size / 16,
      fontWeight: "400",
      letterSpacing: "0",
    };
  }

  const fixedMetric = fixedMetrics[normalized];
  if (fixedMetric) {
    return {
      family: dotBaseFamily,
      baseSize: 16,
      scaleX: fixedMetric.width / 16,
      scaleY: fixedMetric.height / 16,
      fontWeight: "400",
      letterSpacing: "0",
    };
  }

  return {
    family: dotBaseFamily,
    baseSize: 16,
    scaleX: 1,
    scaleY: 1.5,
    fontWeight: "400",
    letterSpacing: "0",
  };
}

function syncVariablesFromSource(source, options = {}) {
  const nextVariables = extractTemplateVariables(source, options.preserveValues ? state.variables : []);
  state.variables = normalizeVariables(nextVariables);
  renderVariablesPanel();
  refreshVariableDrivenViews();
  schedulePersistEditorState();
}

function stripFileExtension(fileName) {
  return String(fileName ?? "").replace(/(?:\.labelme)?\.[^.]+$/u, "");
}

function createProjectDownloadName(name, extension) {
  const safeName = String(name ?? DEFAULT_PROJECT_NAME)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_");
  return `${safeName || DEFAULT_PROJECT_NAME}${extension}`;
}

function readRemoteConfigEndpoints() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      getEndpoint: params.get("get")?.trim() || "",
      setEndpoint: params.get("set")?.trim() || "",
    };
  } catch (error) {
    return {
      getEndpoint: "",
      setEndpoint: "",
    };
  }
}

function hasRemoteGetEndpoint() {
  return Boolean(state.remoteConfig.getEndpoint);
}

function hasRemoteSetEndpoint() {
  return Boolean(state.remoteConfig.setEndpoint);
}

function normalizePaperUnit(unit) {
  return unit === "mm" ? "mm" : "dot";
}

function measurementValueField(name) {
  return `${name}Value`;
}

function dotsToPaperUnit(dots, unit, dpi) {
  if (normalizePaperUnit(unit) === "mm") {
    return Number.parseFloat(((dots * 25.4) / dpi).toFixed(2));
  }
  return Math.round(dots);
}

function paperUnitToDots(value, unit, dpi) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (normalizePaperUnit(unit) === "mm") {
    return Math.round((numeric * dpi) / 25.4);
  }
  return Math.round(numeric);
}

function isEditingTextField() {
  const active = document.activeElement;
  if (!active) {
    return false;
  }
  return /INPUT|TEXTAREA|SELECT/.test(active.tagName) || active.isContentEditable;
}

function isPrimaryShortcut(event) {
  return Boolean(event.metaKey || event.ctrlKey) && !event.altKey;
}

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch (error) {
    return false;
  }
}

function buildPersistedEditorState() {
  const documentSource = state.sourceDirty ? generateTsplSource(state.document) : elements.sourceEditor.value;

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    document: serializeDocumentForStorage(state.document),
    variables: normalizeVariables(state.variables),
    documentSource,
    sourceDirty: state.sourceDirty,
    draftSource: state.sourceDirty ? elements.sourceEditor.value : "",
    zoom: state.zoom,
    project: { ...state.project },
    ble: {
      namePrefix: elements.bleNamePrefixInput.value,
      serviceInput: elements.bleServiceInput.value,
      characteristicInput: elements.bleCharacteristicInput.value,
      encoding: elements.bleEncodingInput.value,
      chunkSize: elements.bleChunkSizeInput.value,
      writeDelay: elements.bleWriteDelayInput.value,
    },
  };
}

function persistEditorStateNow() {
  if (!canUseLocalStorage()) {
    return false;
  }

  try {
    window.localStorage.setItem(LOCAL_EDITOR_STATE_KEY, JSON.stringify(buildPersistedEditorState()));
    return true;
  } catch (error) {
    console.log("[storage] failed to persist editor state", error);
    return false;
  }
}

function schedulePersistEditorState() {
  if (!canUseLocalStorage()) {
    return;
  }

  window.clearTimeout(persistEditorStateTimer);
  persistEditorStateTimer = window.setTimeout(() => {
    persistEditorStateTimer = 0;
    persistEditorStateNow();
  }, 160);
}

function restorePersistedEditorState() {
  if (!canUseLocalStorage()) {
    return false;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_EDITOR_STATE_KEY);
    if (!raw) {
      return false;
    }

    const persisted = JSON.parse(raw);
    const restoredDocument =
      persisted?.document && typeof persisted.document === "object"
        ? normalizeDocument(persisted.document)
        : null;

    if (!restoredDocument && (typeof persisted?.documentSource !== "string" || persisted.documentSource.trim().length === 0)) {
      return false;
    }

    let nextDocument = restoredDocument;
    let warnings = [];

    if (!nextDocument) {
      const parsed = parseTsplSource(persisted.documentSource);
      nextDocument = parsed.document;
      warnings = parsed.warnings;
    }

    if (!nextDocument) {
      throw new Error("Persisted state could not be restored.");
    }

    setDocument(nextDocument, warnings, false);
    state.project = createProjectState(persisted.project);
    state.variables = normalizeVariables(persisted.variables);

    const restoredZoom = Number.parseFloat(persisted.zoom);
    state.zoom = Number.isFinite(restoredZoom) ? Math.max(0.4, Math.min(2, restoredZoom)) : 1;
    elements.zoomRange.value = String(state.zoom);

    if (persisted.ble && typeof persisted.ble === "object") {
      elements.bleNamePrefixInput.value = String(persisted.ble.namePrefix ?? "");
      elements.bleServiceInput.value = String(persisted.ble.serviceInput ?? DEFAULT_BLE_SERVICE_TEXT);
      elements.bleCharacteristicInput.value = String(persisted.ble.characteristicInput ?? "");
      elements.bleEncodingInput.value = String(persisted.ble.encoding ?? "utf-8");
      elements.bleChunkSizeInput.value = String(persisted.ble.chunkSize ?? "180");
      elements.bleWriteDelayInput.value = String(persisted.ble.writeDelay ?? "12");
    }

    if (persisted.sourceDirty && typeof persisted.draftSource === "string" && persisted.draftSource.length > 0) {
      state.sourceDirty = true;
      elements.sourceEditor.value = persisted.draftSource;
      setStatus("已恢复上次本地草稿（含未应用源码修改）");
    } else {
      state.sourceDirty = false;
      syncSourceFromDocument(true);
      setStatus("已恢复上次本地内容");
    }

    render();
    renderVariablesPanel();
    return true;
  } catch (error) {
    console.log("[storage] failed to restore editor state", error);
    try {
      window.localStorage.removeItem(LOCAL_EDITOR_STATE_KEY);
    } catch (removeError) {
      console.log("[storage] failed to clear invalid editor state", removeError);
    }
    return false;
  }
}

function canUseBluetooth() {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function canonicalizeBluetoothUuid(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "number") {
    if (typeof BluetoothUUID !== "undefined" && typeof BluetoothUUID.canonicalUUID === "function") {
      return BluetoothUUID.canonicalUUID(value).toLowerCase();
    }
    return `0000${value.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
  }

  const normalized = String(value).trim().toLowerCase();
  if (/^[0-9a-f]{4}$/i.test(normalized)) {
    return canonicalizeBluetoothUuid(Number.parseInt(normalized, 16));
  }
  if (/^[0-9a-f]{8}$/i.test(normalized)) {
    return `${normalized.slice(0, 8)}-0000-1000-8000-00805f9b34fb`;
  }
  return normalized;
}

function parseBluetoothIdentifier(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return Number.parseInt(trimmed, 16);
  }

  if (/^[0-9a-f]{4}$/i.test(trimmed) || /^[0-9a-f]{8}$/i.test(trimmed)) {
    return Number.parseInt(trimmed, 16);
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return trimmed;
}

function parseBluetoothIdentifierList(source) {
  return uniqueValues(
    String(source ?? "")
      .split(/[\n,]+/)
      .map((entry) => parseBluetoothIdentifier(entry)),
  );
}

function renderBleStatus() {
  if (!canUseBluetooth()) {
    elements.bleDeviceValue.textContent = "当前浏览器不支持";
    elements.bleServiceValue.textContent = "不可用";
    elements.bleCharacteristicValue.textContent = "不可用";
    elements.bleWriteModeValue.textContent = "不可用";
    elements.bleConnectButton.disabled = true;
    elements.blePrintButton.disabled = true;
    elements.bleRefreshButton.disabled = true;
    elements.bleDisconnectButton.disabled = true;
    return;
  }

  const { device, service, characteristic, writeMode, connecting } = state.ble;
  elements.bleDeviceValue.textContent = device?.name || "未连接";
  elements.bleServiceValue.textContent = service?.uuid || "未选择";
  elements.bleCharacteristicValue.textContent = characteristic?.uuid || "未选择";
  elements.bleWriteModeValue.textContent = connecting ? "连接中" : writeMode || "未就绪";
  elements.bleConnectButton.disabled = connecting;
  elements.blePrintButton.disabled = connecting;
  elements.bleRefreshButton.disabled = connecting || !device || !device.gatt?.connected;
  elements.bleDisconnectButton.disabled = connecting || !device || !device.gatt?.connected;
}

function clearBleSelection() {
  state.ble.device = null;
  state.ble.server = null;
  state.ble.service = null;
  state.ble.characteristic = null;
  state.ble.writeMode = null;
  state.ble.connecting = false;
  renderBleStatus();
}

function handleBleDisconnected() {
  const name = state.ble.device?.name || "BLE 设备";
  clearBleSelection();
  setStatus(`${name} 已断开`);
}

async function confirmAction({ title, message, confirmLabel = "确认", danger = false }) {
  const dialog = elements.confirmDialog;
  if (!(dialog instanceof HTMLDialogElement)) {
    return window.confirm(message);
  }

  elements.confirmDialogTitle.textContent = title;
  elements.confirmDialogMessage.textContent = message;
  elements.confirmDialogConfirmButton.textContent = confirmLabel;
  elements.confirmDialogConfirmButton.classList.toggle("danger-fill", danger);

  dialog.showModal();
  return new Promise((resolve) => {
    const handleClose = () => {
      dialog.removeEventListener("close", handleClose);
      resolve(dialog.returnValue === "confirm");
    };
    dialog.addEventListener("close", handleClose);
  });
}

function setWarnings(warnings) {
  state.warnings = warnings;
  if (warnings.length > 0) {
    elements.warningBadge.className = "warning-badge";
    elements.warningBadge.textContent = `${warnings.length} 条提示`;
  } else {
    elements.warningBadge.className = "";
    elements.warningBadge.textContent = "";
  }
}

function applyWarnings(baseWarnings = []) {
  const warnings = [...baseWarnings];
  if (state.document.nodes.some((node) => node.kind === "image")) {
    warnings.push("图片元素在源码区使用 BITMAPHEX 可读扩展；导出文件会转成标准 TSPL BITMAP 字节流。");
  }
  setWarnings([...new Set(warnings)]);
}

function syncSourceFromDocument(force = false) {
  if (state.sourceDirty && !force) {
    return;
  }

  elements.sourceEditor.value = generateTsplSource(state.document);
  state.sourceDirty = false;
}

function setDocument(document, warnings = [], preserveSelection = true) {
  const previousSelection = preserveSelection ? state.selectedId : null;
  state.document = normalizeDocument(document);
  state.selectedId = previousSelection;
  ensureSelection();
  applyWarnings(warnings);
  syncSourceFromDocument(true);
  render();
  schedulePersistEditorState();
}

function updateDocument(mutator, options = {}) {
  const nextDocument = cloneDocument(state.document);
  mutator(nextDocument);
  state.document = normalizeDocument(nextDocument);
  if (!options.keepSelection) {
    ensureSelection();
  }
  applyWarnings([]);
  syncSourceFromDocument(true);
  render();
  schedulePersistEditorState();
}

function addNode(kind, x = 24, y = 24) {
  if (kind === "image") {
    state.pendingImagePlacement = { x, y };
    elements.imageFileInput.click();
    return;
  }

  updateDocument((document) => {
    document.nodes.push(createNode(kind, { x, y }));
    state.selectedId = document.nodes.at(-1)?.id ?? null;
  });

  setStatus(`已添加${kind === "raw" ? "原始 TSPL 块" : "新元素"}`);
}

function moveNode(nodeId, deltaX, deltaY) {
  updateDocument(
    (document) => {
      const node = document.nodes.find((entry) => entry.id === nodeId);
      if (!node || node.kind === "raw") {
        return;
      }

      const geometry = getRenderableGeometry(node);
      const maxX = Math.max(0, document.settings.width - geometry.boxWidth);
      const maxY = Math.max(0, document.settings.height - geometry.boxHeight);
      node.x = Math.max(0, Math.min(maxX, node.x + deltaX));
      node.y = Math.max(0, Math.min(maxY, node.y + deltaY));
    },
    { keepSelection: true },
  );
}

function offsetAllVisualNodes(deltaX, deltaY) {
  const nextDeltaX = Number.parseInt(deltaX, 10) || 0;
  const nextDeltaY = Number.parseInt(deltaY, 10) || 0;

  if (nextDeltaX === 0 && nextDeltaY === 0) {
    setStatus("整体偏移为 0，未执行");
    return;
  }

  const rawCount = state.document.nodes.filter((node) => node.kind === "raw").length;
  let movedCount = 0;

  updateDocument(
    (document) => {
      for (const node of document.nodes) {
        if (node.kind === "raw") {
          continue;
        }

        const geometry = getRenderableGeometry(node);
        const maxX = Math.max(0, document.settings.width - geometry.boxWidth);
        const maxY = Math.max(0, document.settings.height - geometry.boxHeight);
        node.x = Math.max(0, Math.min(maxX, node.x + nextDeltaX));
        node.y = Math.max(0, Math.min(maxY, node.y + nextDeltaY));
        movedCount += 1;
      }
    },
    { keepSelection: true },
  );

  if (movedCount === 0) {
    setStatus("没有可偏移的可视元素");
    return;
  }

  if (rawCount > 0) {
    setStatus(`已整体偏移 ${movedCount} 个可视元素，跳过 ${rawCount} 个原始 TSPL 块`);
    return;
  }

  setStatus(`已整体偏移 ${movedCount} 个可视元素`);
}

async function clearAllElements() {
  if (state.document.nodes.length === 0) {
    setStatus("当前没有元素可清空");
    return;
  }

  const confirmed = await confirmAction({
    title: "清空元素",
    message: "这会移除当前标签里的全部元素，但不会改动纸张设置。确定继续吗？",
    confirmLabel: "清空",
    danger: true,
  });

  if (!confirmed) {
    setStatus("已取消清空");
    return;
  }

  updateDocument((document) => {
    document.nodes = [];
    state.selectedId = null;
  });
  setStatus("已清空全部元素");
}

function getBleServiceCandidates() {
  const values = parseBluetoothIdentifierList(elements.bleServiceInput.value);
  return values.length > 0 ? values : parseBluetoothIdentifierList(DEFAULT_BLE_SERVICE_CANDIDATES.join("\n"));
}

function getPreferredBleCharacteristic() {
  return parseBluetoothIdentifier(elements.bleCharacteristicInput.value);
}

function compareUuidMatch(actual, expected) {
  if (!expected) {
    return false;
  }
  return canonicalizeBluetoothUuid(actual) === canonicalizeBluetoothUuid(expected);
}

function formatBluetoothIdentifier(value) {
  if (typeof value === "number") {
    return `0x${value.toString(16).toUpperCase()}`;
  }
  return String(value ?? "");
}

function describeBleCharacteristicProperties(properties) {
  if (!properties) {
    return "none";
  }

  const enabled = Object.entries({
    authenticatedSignedWrites: properties.authenticatedSignedWrites,
    broadcast: properties.broadcast,
    indicate: properties.indicate,
    notify: properties.notify,
    read: properties.read,
    reliableWrite: properties.reliableWrite,
    writableAuxiliaries: properties.writableAuxiliaries,
    write: properties.write,
    writeWithoutResponse: properties.writeWithoutResponse,
  })
    .filter(([, value]) => Boolean(value))
    .map(([name]) => name);

  return enabled.length > 0 ? enabled.join(", ") : "none";
}

async function collectAccessibleServices(server, requestedServices) {
  const services = new Map();

  if (typeof server.getPrimaryServices === "function") {
    try {
      const allServices = await server.getPrimaryServices();
      console.log("[BLE] getPrimaryServices() ->", allServices.map((service) => service.uuid));
      for (const service of allServices) {
        services.set(service.uuid, service);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("[BLE] getPrimaryServices() failed, will fall back to requested services:", message);
    }
  }

  for (const identifier of requestedServices) {
    try {
      console.log("[BLE] probing service", formatBluetoothIdentifier(identifier));
      const service = await server.getPrimaryService(identifier);
      services.set(service.uuid, service);
      console.log("[BLE] accessible service", service.uuid);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("[BLE] service probe failed", formatBluetoothIdentifier(identifier), message);
    }
  }

  return [...services.values()];
}

function getCharacteristicWriteMode(characteristic) {
  if (characteristic.properties?.writeWithoutResponse && typeof characteristic.writeValueWithoutResponse === "function") {
    return "writeWithoutResponse";
  }
  if (characteristic.properties?.write && typeof characteristic.writeValueWithResponse === "function") {
    return "writeWithResponse";
  }
  if (characteristic.properties?.write && typeof characteristic.writeValue === "function") {
    return "write";
  }
  if (characteristic.properties?.writeWithoutResponse && typeof characteristic.writeValue === "function") {
    return "write";
  }
  return null;
}

async function discoverWritableCharacteristic(server) {
  const requestedServices = getBleServiceCandidates();
  const preferredCharacteristic = getPreferredBleCharacteristic();
  console.log(
    "[BLE] starting discovery",
    requestedServices.map((identifier) => formatBluetoothIdentifier(identifier)),
    preferredCharacteristic ? `preferred characteristic: ${formatBluetoothIdentifier(preferredCharacteristic)}` : "",
  );
  const services = await collectAccessibleServices(server, requestedServices);
  const candidates = [];

  for (const service of services) {
    let characteristics = [];
    try {
      characteristics = await service.getCharacteristics();
      console.log(
        "[BLE] service characteristics",
        service.uuid,
        characteristics.map((characteristic) => characteristic.uuid),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("[BLE] getCharacteristics() failed", service.uuid, message);
      continue;
    }

    for (const characteristic of characteristics) {
      const writeMode = getCharacteristicWriteMode(characteristic);
      console.log(
        "[BLE] characteristic",
        `${service.uuid} -> ${characteristic.uuid}`,
        `properties: ${describeBleCharacteristicProperties(characteristic.properties)}`,
        `write mode: ${writeMode || "not writable"}`,
      );
      if (!writeMode) {
        continue;
      }
      candidates.push({ service, characteristic, writeMode });
    }
  }

  if (candidates.length === 0) {
    throw new Error("没有找到可写的 BLE 特征。请查看控制台日志，并尝试补充候选服务 UUID。");
  }

  if (preferredCharacteristic) {
    const preferred = candidates.find((candidate) => compareUuidMatch(candidate.characteristic.uuid, preferredCharacteristic));
    if (preferred) {
      console.log("[BLE] selected preferred writable characteristic", preferred.service.uuid, preferred.characteristic.uuid, preferred.writeMode);
      return preferred;
    }
  }

  const withoutResponse = candidates.find((candidate) => candidate.writeMode === "writeWithoutResponse");
  const selected = withoutResponse ?? candidates[0];
  console.log("[BLE] selected writable characteristic", selected.service.uuid, selected.characteristic.uuid, selected.writeMode);
  return selected;
}

function buildBluetoothRequestOptions() {
  const optionalServices = getBleServiceCandidates();
  const namePrefix = elements.bleNamePrefixInput.value.trim();

  if (namePrefix) {
    return {
      filters: [{ namePrefix }],
      optionalServices,
    };
  }

  return {
    acceptAllDevices: true,
    optionalServices,
  };
}

async function connectBlePrinter() {
  if (!canUseBluetooth()) {
    setStatus("当前浏览器不支持 Web Bluetooth");
    return null;
  }

  state.ble.connecting = true;
  renderBleStatus();

  try {
    const requestOptions = buildBluetoothRequestOptions();
    console.log("[BLE] requestDevice options", requestOptions);
    const device = await navigator.bluetooth.requestDevice(requestOptions);
    device.removeEventListener("gattserverdisconnected", handleBleDisconnected);
    device.addEventListener("gattserverdisconnected", handleBleDisconnected);

    const server = device.gatt?.connected ? device.gatt : await device.gatt.connect();
    state.ble.device = device;
    state.ble.server = server;
    state.ble.service = null;
    state.ble.characteristic = null;
    state.ble.writeMode = null;
    setStatus(`已连接 ${device.name || "BLE 设备"}，正在枚举服务和特征…`);
    renderBleStatus();

    console.log("[BLE] connected device", {
      id: device.id,
      name: device.name || "",
      connected: Boolean(device.gatt?.connected),
    });
    const selection = await discoverWritableCharacteristic(server);

    state.ble.service = selection.service;
    state.ble.characteristic = selection.characteristic;
    state.ble.writeMode = selection.writeMode;
    setStatus(`已连接 ${device.name || "BLE 设备"}，找到可写端口`);
    return selection.characteristic;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`BLE 连接失败: ${message}`);
    if (!state.ble.device?.gatt?.connected) {
      clearBleSelection();
    }
    return null;
  } finally {
    state.ble.connecting = false;
    renderBleStatus();
  }
}

async function refreshBleSelection() {
  if (!state.ble.device?.gatt?.connected || !state.ble.server) {
    setStatus("当前没有已连接的 BLE 设备");
    return;
  }

  state.ble.connecting = true;
  renderBleStatus();
  try {
    const selection = await discoverWritableCharacteristic(state.ble.server);
    state.ble.service = selection.service;
    state.ble.characteristic = selection.characteristic;
    state.ble.writeMode = selection.writeMode;
    setStatus("已刷新 BLE 可写端口");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`刷新 BLE 端口失败: ${message}`);
  } finally {
    state.ble.connecting = false;
    renderBleStatus();
  }
}

function disconnectBlePrinter() {
  if (state.ble.device?.gatt?.connected) {
    state.ble.device.gatt.disconnect();
  } else {
    clearBleSelection();
    setStatus("BLE 已断开");
  }
}

async function ensureBleCharacteristic() {
  if (state.ble.characteristic && state.ble.device?.gatt?.connected) {
    return state.ble.characteristic;
  }
  return connectBlePrinter();
}

async function writeBleChunk(characteristic, writeMode, payload) {
  if (writeMode === "writeWithoutResponse" && typeof characteristic.writeValueWithoutResponse === "function") {
    await characteristic.writeValueWithoutResponse(payload);
    return;
  }
  if (writeMode === "writeWithResponse" && typeof characteristic.writeValueWithResponse === "function") {
    await characteristic.writeValueWithResponse(payload);
    return;
  }
  if (typeof characteristic.writeValue === "function") {
    await characteristic.writeValue(payload);
    return;
  }
  throw new Error("当前特征不支持写入");
}

async function printCurrentLabelViaBle() {
  if (state.sourceDirty) {
    const applied = applySourceToDocument();
    if (!applied) {
      return;
    }
  }

  const characteristic = await ensureBleCharacteristic();
  if (!characteristic) {
    return;
  }

  const textEncoding = elements.bleEncodingInput.value || "utf-8";
  const chunkSize = Math.max(20, Math.min(512, Number.parseInt(elements.bleChunkSizeInput.value, 10) || 180));
  const writeDelay = Math.max(0, Number.parseInt(elements.bleWriteDelayInput.value, 10) || 0);

  state.ble.connecting = true;
  renderBleStatus();

  try {
    const renderedDocument = renderDocumentWithVariables(state.document, state.variables);
    const payload = generateTsplPayload(renderedDocument, { textEncoding });
    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      const chunk = payload.slice(offset, offset + chunkSize);
      await writeBleChunk(characteristic, state.ble.writeMode, chunk);
      if (state.ble.writeMode === "writeWithoutResponse" && writeDelay > 0) {
        await sleep(writeDelay);
      }
    }

    setStatus(`已通过 BLE 发送 ${payload.length} 字节（${textEncoding.toUpperCase()}）`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`BLE 打印失败: ${message}`);
  } finally {
    state.ble.connecting = false;
    renderBleStatus();
  }
}

function deleteNode(nodeId) {
  updateDocument((document) => {
    document.nodes = document.nodes.filter((node) => node.id !== nodeId);
    state.selectedId = document.nodes[0]?.id ?? null;
  });
}

function copySelectedNode() {
  const node = selectedNode();
  if (!node) {
    return false;
  }

  state.elementClipboard = {
    node: JSON.parse(JSON.stringify(node)),
    pasteCount: 0,
  };
  setStatus(`已复制${node.name || node.kind}`);
  return true;
}

function pasteCopiedNode() {
  if (!state.elementClipboard?.node) {
    setStatus("当前没有可粘贴的元素");
    return false;
  }

  const clipboardNode = state.elementClipboard.node;
  const pasteIndex = (state.elementClipboard.pasteCount ?? 0) + 1;
  const offset = 16 * pasteIndex;

  let createdNodeId = null;

  updateDocument((document) => {
    const partial = JSON.parse(JSON.stringify(clipboardNode));
    delete partial.id;

    if (typeof partial.x === "number") {
      partial.x += offset;
    }
    if (typeof partial.y === "number") {
      partial.y += offset;
    }

    const duplicated = createNode(clipboardNode.kind, partial);
    if (typeof duplicated.x === "number" && typeof duplicated.y === "number" && duplicated.kind !== "raw") {
      const geometry = getRenderableGeometry(duplicated);
      const maxX = Math.max(0, document.settings.width - geometry.boxWidth);
      const maxY = Math.max(0, document.settings.height - geometry.boxHeight);
      duplicated.x = Math.max(0, Math.min(maxX, duplicated.x));
      duplicated.y = Math.max(0, Math.min(maxY, duplicated.y));
    }

    document.nodes.push(duplicated);
    createdNodeId = duplicated.id;
    state.selectedId = duplicated.id;
  });

  state.elementClipboard.pasteCount = pasteIndex;
  if (createdNodeId) {
    setStatus(`已粘贴${clipboardNode.name || clipboardNode.kind}`);
    return true;
  }
  return false;
}

function moveLayer(nodeId, direction) {
  updateDocument((document) => {
    const index = document.nodes.findIndex((node) => node.id === nodeId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= document.nodes.length) {
      return;
    }
    [document.nodes[index], document.nodes[nextIndex]] = [document.nodes[nextIndex], document.nodes[index]];
  });
}

function downloadBlob(blob, filename) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}

function saveProjectFile() {
  const now = new Date().toISOString();
  const projectFile = buildProjectFile({
    name: state.project.name,
    editorVersion: EDITOR_VERSION,
    createdAt: state.project.created,
    modifiedAt: now,
    document: state.document,
    variables: state.variables,
    source: elements.sourceEditor.value,
    sourceDirty: state.sourceDirty,
  });

  state.project = createProjectState({
    name: projectFile.name,
    created: projectFile.created,
    modified: projectFile.modified,
  });
  schedulePersistEditorState();

  const blob = new Blob([`${JSON.stringify(projectFile, null, 2)}\n`], { type: "application/json" });
  downloadBlob(blob, createProjectDownloadName(projectFile.name, ".labelme.json"));
  setStatus("工程已保存");
}

async function saveTspl() {
  if (state.sourceDirty) {
    const applied = applySourceToDocument();
    if (!applied) {
      return;
    }
  }

  const payload = generateTsplPayload(state.document);
  const blob = new Blob([payload], { type: "application/octet-stream" });
  downloadBlob(blob, createProjectDownloadName(state.project.name, ".tspl"));
  setStatus("TSPL 已导出");
}

async function openWorkspaceFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder().decode(bytes);
  const trimmed = text.trimStart();
  const expectsProject = /\.json$/i.test(file.name) || trimmed.startsWith("{");

  if (expectsProject) {
    try {
      const projectFile = parseProjectFile(text);
      applyLoadedProjectState({
        document: projectFile.document,
        warnings: [],
        sourceText: projectFile.sourceText,
        sourceDirty: projectFile.sourceDirty,
        variables:
          projectFile.variables.length > 0
            ? normalizeVariables(projectFile.variables)
            : extractTemplateVariables(projectFile.sourceText),
        project: {
          name: projectFile.name || stripFileExtension(file.name),
          created: projectFile.created,
          modified: projectFile.modified,
        },
      });
      setStatus("工程文件已打开");
      return;
    } catch (error) {
      if (/\.json$/i.test(file.name)) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`工程文件打开失败: ${message}`);
        return;
      }
      console.log("[project] failed to parse file as project, falling back to TSPL", error);
    }
  }

  const { document, warnings } = parseTsplPayload(bytes);
  state.project = createProjectState({
    name: stripFileExtension(file.name) || DEFAULT_PROJECT_NAME,
    created: null,
    modified: null,
  });
  state.variables = extractTemplateVariables(generateTsplSource(document));
  state.sourceDirty = false;
  setDocument(document, warnings, false);
  renderVariablesPanel();
  setStatus("TSPL 文件已打开，并已载入当前工程");
}

function applySourceToDocument() {
  const source = elements.sourceEditor.value;
  const { document, warnings } = parseTsplSource(source);
  if (!document) {
    setStatus("源码解析失败");
    return false;
  }

  state.sourceDirty = false;
  setDocument(document, warnings, false);
  syncVariablesFromSource(source, { preserveValues: true });
  setStatus(warnings.length > 0 ? "源码已解析，存在保留块" : "源码已同步到画布");
  return true;
}

function updateSetting(name, value) {
  updateDocument((document) => {
    if (PAPER_MEASUREMENT_FIELDS.includes(name)) {
      const unit = normalizePaperUnit(document.settings.measurementUnit);
      const numeric = Number.parseFloat(value);
      document.settings[measurementValueField(name)] = Number.isFinite(numeric) ? numeric : 0;
      document.settings[name] = paperUnitToDots(numeric, unit, document.settings.dpi);
      return;
    }

    if (name === "dpi") {
      const nextDpi = Number.parseInt(value, 10) || document.settings.dpi;
      const currentUnit = normalizePaperUnit(document.settings.measurementUnit);
      if (currentUnit === "mm") {
        for (const field of PAPER_MEASUREMENT_FIELDS) {
          document.settings[field] = paperUnitToDots(
            document.settings[measurementValueField(field)],
            currentUnit,
            nextDpi,
          );
        }
      } else {
        for (const field of PAPER_MEASUREMENT_FIELDS) {
          document.settings[measurementValueField(field)] = document.settings[field];
        }
      }
      document.settings.dpi = nextDpi;
      return;
    }

    document.settings[name] = Number.parseInt(value, 10) || 0;
  });
}

function updateProjectName(value) {
  state.project.name = String(value ?? "");
  schedulePersistEditorState();
}

function refreshVariableDrivenViews() {
  renderCanvas();
}

function updateVariableField(index, field, value) {
  const variable = state.variables[index];
  if (!variable) {
    return;
  }
  variable[field] = String(value ?? "");
  state.variables = normalizeVariables(state.variables);
  schedulePersistEditorState();
  if (field === "key" || field === "value") {
    refreshVariableDrivenViews();
  }
}

function addVariable() {
  state.variables = [...state.variables, getDefaultVariable()];
  renderVariablesPanel();
  refreshVariableDrivenViews();
  schedulePersistEditorState();
}

function removeVariable(index) {
  state.variables = state.variables.filter((_, currentIndex) => currentIndex !== index);
  renderVariablesPanel();
  refreshVariableDrivenViews();
  schedulePersistEditorState();
}

function renderVariablesPanel() {
  elements.variablesList.innerHTML = "";

  if (state.variables.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "还没有变量。新增后可在文字/条码/二维码内容里使用 {{key}}。";
    elements.variablesList.append(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "variable-header";
  for (const title of ["名称", "Key", "值", ""]) {
    const cell = document.createElement("div");
    cell.textContent = title;
    header.append(cell);
  }
  elements.variablesList.append(header);

  state.variables.forEach((variable, index) => {
    const row = document.createElement("div");
    row.className = "variable-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = variable.name;
    nameInput.placeholder = "变量名称";
    nameInput.setAttribute("aria-label", "变量名称");
    nameInput.addEventListener("input", () => updateVariableField(index, "name", nameInput.value));

    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.value = variable.key;
    keyInput.placeholder = "name";
    keyInput.setAttribute("aria-label", "变量 Key");
    keyInput.addEventListener("input", () => updateVariableField(index, "key", keyInput.value));

    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.value = variable.value;
    valueInput.placeholder = "变量值";
    valueInput.setAttribute("aria-label", "变量值");
    valueInput.addEventListener("input", () => updateVariableField(index, "value", valueInput.value));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger-button";
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => removeVariable(index));

    row.append(nameInput, keyInput, valueInput, removeButton);
    elements.variablesList.append(row);
  });
}

function applyLoadedProjectState({
  document,
  warnings = [],
  sourceText = "",
  sourceDirty = false,
  variables = [],
  project = {},
} = {}) {
  state.project = createProjectState(project);
  state.variables = normalizeVariables(variables);
  state.sourceDirty = false;
  setDocument(document, warnings, false);
  elements.sourceEditor.value = sourceText || generateTsplSource(document);
  state.sourceDirty = Boolean(sourceDirty);
  renderVariablesPanel();
  schedulePersistEditorState();
}

function parseRemoteProjectPayload(payload) {
  const data = payload && typeof payload === "object" && payload.data && !Array.isArray(payload.data) ? payload.data : payload;
  if (!data || typeof data !== "object") {
    throw new Error("远端返回的配置格式无效");
  }

  if (data.schema === "labelme-project") {
    const projectFile = parseProjectFile(data);
    return {
      document: projectFile.document,
      warnings: [],
      sourceText: projectFile.sourceText,
      sourceDirty: projectFile.sourceDirty,
      variables: projectFile.variables,
      project: {
        name: projectFile.name,
        created: projectFile.created,
        modified: projectFile.modified,
      },
    };
  }

  const sourceText =
    typeof data.tspl?.source === "string" && data.tspl.source.length > 0
      ? data.tspl.source
      : typeof data.source === "string" && data.source.length > 0
        ? data.source
        : "";

  if (sourceText) {
    const parsed = parseTsplSource(sourceText);
    return {
      document: parsed.document,
      warnings: parsed.warnings,
      sourceText,
      sourceDirty: Boolean(data.tspl?.sourceDirty),
      variables: normalizeVariables(data.variables).length > 0 ? normalizeVariables(data.variables) : extractTemplateVariables(sourceText),
      project: {
        name: data.name,
        created: data.created,
        modified: data.modified,
      },
    };
  }

  if (data.paper || data.elements || data.settings || data.nodes) {
    const document = normalizeDocument({
      settings: data.paper ?? data.settings ?? {},
      nodes: data.elements ?? data.nodes ?? [],
    });
    const generatedSource = generateTsplSource(document);
    return {
      document,
      warnings: [],
      sourceText: generatedSource,
      sourceDirty: false,
      variables: normalizeVariables(data.variables),
      project: {
        name: data.name,
        created: data.created,
        modified: data.modified,
      },
    };
  }

  throw new Error("远端返回不包含可识别的工程或 TSPL 数据");
}

async function saveRemoteProjectFile() {
  const now = new Date().toISOString();
  const projectFile = buildProjectFile({
    name: state.project.name,
    editorVersion: EDITOR_VERSION,
    createdAt: state.project.created,
    modifiedAt: now,
    document: state.document,
    variables: state.variables,
    source: elements.sourceEditor.value,
    sourceDirty: state.sourceDirty,
  });

  state.project = createProjectState({
    name: projectFile.name,
    created: projectFile.created,
    modified: projectFile.modified,
  });
  schedulePersistEditorState();

  const response = await fetch(state.remoteConfig.setEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: projectFile }),
  });

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${responseText ? `: ${responseText}` : ""}`);
  }

  if (payload && typeof payload === "object" && "code" in payload && payload.code !== 0) {
    throw new Error(String(payload.message || payload.msg || `code=${payload.code}`));
  }

  setStatus("远端配置已保存");
}

async function loadRemoteProjectFile() {
  const response = await fetch(state.remoteConfig.getEndpoint, {
    method: "POST",
  });

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    throw new Error("远端返回不是有效的 JSON");
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${responseText ? `: ${responseText}` : ""}`);
  }

  if (payload && typeof payload === "object" && "code" in payload && payload.code !== 0) {
    throw new Error(String(payload.message || payload.msg || `code=${payload.code}`));
  }

  applyLoadedProjectState(parseRemoteProjectPayload(payload));
  setStatus("已从远端加载配置");
}

function updatePaperUnit(value) {
  updateDocument((document) => {
    const nextUnit = normalizePaperUnit(value);
    document.settings.measurementUnit = nextUnit;
    for (const field of PAPER_MEASUREMENT_FIELDS) {
      document.settings[measurementValueField(field)] = dotsToPaperUnit(
        document.settings[field],
        nextUnit,
        document.settings.dpi,
      );
    }
  });
}

function updateNodeField(nodeId, field, value) {
  updateDocument(
    (document) => {
      const node = document.nodes.find((entry) => entry.id === nodeId);
      if (!node) {
        return;
      }

      node[field] = value;
    },
    { keepSelection: true },
  );
}

async function rebuildImageNode(nodeId, nextPartial) {
  const current = selectedNode();
  if (!current || current.id !== nodeId || current.kind !== "image") {
    return;
  }

  const sourceDataUrl = nextPartial.sourceDataUrl ?? current.sourceDataUrl;
  const nextWidth = Number.parseInt(nextPartial.bitmapWidth ?? current.bitmapWidth, 10);
  const nextHeight = Number.parseInt(nextPartial.bitmapHeight ?? current.bitmapHeight, 10);
  const nextThreshold = Number.parseInt(nextPartial.threshold ?? current.threshold, 10);
  const nextInvert = Boolean(nextPartial.invert ?? current.invert);

  let rasterized;
  if (sourceDataUrl) {
    rasterized = await rasterizeImageFromDataUrl(sourceDataUrl, nextWidth, nextHeight, nextThreshold, nextInvert);
  } else {
    const bitmap = scaleBitmap(current.bitmap, nextWidth, nextHeight);
    if (nextInvert !== current.invert) {
      bitmap.pixels = bitmap.pixels.map((pixel) => (pixel ? 0 : 1));
    }
    rasterized = {
      bitmap,
      byteWidth: Math.ceil(bitmap.width / 8),
      bitmapWidth: bitmap.width,
      bitmapHeight: bitmap.height,
      bitmapHex: bitmapToHex(bitmap),
      previewDataUrl: bitmapToSvgDataUrl(bitmap, 1),
    };
  }

  updateDocument(
    (document) => {
      const node = document.nodes.find((entry) => entry.id === nodeId);
      if (!node || node.kind !== "image") {
        return;
      }

      node.threshold = nextThreshold;
      node.invert = nextInvert;
      node.sourceDataUrl = sourceDataUrl;
      node.bitmap = rasterized.bitmap;
      node.byteWidth = rasterized.byteWidth;
      node.bitmapWidth = rasterized.bitmapWidth;
      node.bitmapHeight = rasterized.bitmapHeight;
      node.bitmapHex = rasterized.bitmapHex;
      node.previewDataUrl = rasterized.previewDataUrl;
    },
    { keepSelection: true },
  );
}

function getDropPosition(event) {
  const rect = elements.paperFace.getBoundingClientRect();
  const x = Math.max(0, Math.round((event.clientX - rect.left) / state.zoom));
  const y = Math.max(0, Math.round((event.clientY - rect.top) / state.zoom));
  return { x, y };
}

function buildTextPreview(node, geometry) {
  const previewNode = resolveNodeVariables(node);
  const previewFont = getTextPreviewFontProfile(node.font);
  const shell = document.createElement("div");
  shell.className = "item-shell";
  shell.style.width = `${geometry.boxWidth * state.zoom}px`;
  shell.style.height = `${geometry.boxHeight * state.zoom}px`;

  const content = document.createElement("div");
  content.className = "text-preview";
  content.style.width = `${geometry.contentWidth * state.zoom}px`;
  content.style.height = `${geometry.contentHeight * state.zoom}px`;
  content.style.transformOrigin = "top left";
  content.style.transform = geometry.transform;

  const glyphs = document.createElement("div");
  glyphs.className = "text-preview-glyphs";
  glyphs.textContent = previewNode.text;
  glyphs.style.fontFamily = previewFont.family;
  glyphs.style.fontSize = `${previewFont.baseSize * state.zoom}px`;
  glyphs.style.fontWeight = previewFont.fontWeight;
  glyphs.style.letterSpacing = previewFont.letterSpacing;
  glyphs.style.transform = `scale(${previewFont.scaleX * previewNode.xMultiplier}, ${previewFont.scaleY * previewNode.yMultiplier})`;

  content.append(glyphs);
  shell.append(content);
  return shell;
}

function buildAssetPreview(node, geometry) {
  const previewNode = resolveNodeVariables(node);
  const shell = document.createElement("div");
  shell.className = "item-shell";
  shell.style.width = `${geometry.boxWidth * state.zoom}px`;
  shell.style.height = `${geometry.boxHeight * state.zoom}px`;

  const inner = document.createElement("div");
  inner.style.width = `${geometry.contentWidth * state.zoom}px`;
  inner.style.height = `${geometry.contentHeight * state.zoom}px`;
  inner.style.transformOrigin = "top left";
  inner.style.transform = geometry.transform;

  const image = document.createElement("img");
  image.className = "asset-preview";
  image.src = getNodePreviewDataUrl(previewNode);
  image.alt = node.kind;
  image.draggable = false;
  inner.append(image);
  shell.append(inner);
  return shell;
}

function buildShapePreview(node, geometry) {
  const shell = document.createElement("div");
  shell.className = "item-shell";
  shell.style.width = `${geometry.boxWidth * state.zoom}px`;
  shell.style.height = `${geometry.boxHeight * state.zoom}px`;

  const shape = document.createElement("div");
  shape.className = `shape-preview ${node.kind}`;
  shape.style.width = `${geometry.contentWidth * state.zoom}px`;
  shape.style.height = `${geometry.contentHeight * state.zoom}px`;
  if (node.kind === "box") {
    shape.style.borderWidth = `${Math.max(1, Math.round(node.thickness * state.zoom))}px`;
  }
  shell.append(shape);
  return shell;
}

function renderCanvas() {
  elements.canvasItems.innerHTML = "";

  const { width, height, gap } = state.document.settings;
  elements.paperFace.style.width = `${width * state.zoom}px`;
  elements.paperFace.style.height = `${height * state.zoom}px`;
  elements.paperGap.style.width = `${width * state.zoom}px`;
  elements.paperGap.style.height = `${Math.max(gap, 12) * state.zoom}px`;
  elements.paperGap.style.display = gap > 0 ? "flex" : "none";
  elements.paperStage.style.width = `${width * state.zoom}px`;

  const renderableNodes = state.document.nodes.filter((node) => node.kind !== "raw");
  elements.canvasDropHint.style.display = renderableNodes.length === 0 ? "grid" : "none";

  for (const node of renderableNodes) {
    const geometry = getRenderableGeometry(node);
    const item = document.createElement("div");
    item.className = `canvas-item${node.id === state.selectedId ? " selected" : ""}`;
    item.dataset.id = node.id;
    item.style.left = `${node.x * state.zoom}px`;
    item.style.top = `${node.y * state.zoom}px`;
    item.style.width = `${geometry.boxWidth * state.zoom}px`;
    item.style.height = `${geometry.boxHeight * state.zoom}px`;

    let preview;
    if (node.kind === "text") {
      preview = buildTextPreview(node, geometry);
    } else if (node.kind === "bar" || node.kind === "box") {
      preview = buildShapePreview(node, geometry);
    } else {
      preview = buildAssetPreview(node, geometry);
    }
    item.append(preview);

    if (node.id === state.selectedId) {
      const badge = document.createElement("div");
      badge.className = "selection-badge";
      badge.textContent = `${Math.round(node.x)}, ${Math.round(node.y)}`;
      item.append(badge);
    }

    item.addEventListener("pointerdown", (event) => startDragNode(event, node.id));
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedId = node.id;
      render();
    });

    elements.canvasItems.append(item);
  }
}

function renderLayers() {
  elements.layerList.innerHTML = "";

  if (state.document.nodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "还没有元素。把左侧元素拖到画布即可。";
    elements.layerList.append(empty);
    return;
  }

  state.document.nodes.forEach((node) => {
    const row = document.createElement("div");
    row.className = `layer-item${node.id === state.selectedId ? " active" : ""}`;
    row.addEventListener("click", () => {
      state.selectedId = node.id;
      render();
    });

    const main = document.createElement("div");
    main.className = "layer-main";
    const title = document.createElement("div");
    title.className = "layer-name";
    title.textContent = node.name || node.kind;
    const meta = document.createElement("div");
    meta.className = "layer-meta";
    meta.textContent = summarizeNode(node);
    main.append(title, meta);

    const up = document.createElement("button");
    up.type = "button";
    up.className = "layer-icon-button";
    up.textContent = "↑";
    up.addEventListener("click", (event) => {
      event.stopPropagation();
      moveLayer(node.id, -1);
    });

    const down = document.createElement("button");
    down.type = "button";
    down.className = "layer-icon-button";
    down.textContent = "↓";
    down.addEventListener("click", (event) => {
      event.stopPropagation();
      moveLayer(node.id, 1);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button";
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteNode(node.id);
    });

    row.append(main, up, down, remove);
    elements.layerList.append(row);
  });
}

function buildNumberField({ label, value, min = 0, max, step = 1, onInput, eventName = "change" }) {
  const wrapper = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  input.min = String(min);
  input.step = String(step);
  if (max !== undefined) {
    input.max = String(max);
  }
  input.addEventListener(eventName, () => onInput(input.value));
  wrapper.append(caption, input);
  return wrapper;
}

function buildTextField({ label, value, onInput, eventName = "change" }) {
  const wrapper = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.addEventListener(eventName, () => onInput(input.value));
  wrapper.append(caption, input);
  return wrapper;
}

function buildSuggestTextField({ label, value, options, onInput, eventName = "change", listId }) {
  const wrapper = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = label;

  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.setAttribute("list", listId);
  input.addEventListener(eventName, () => onInput(input.value));

  const datalist = document.createElement("datalist");
  datalist.id = listId;
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option;
    datalist.append(item);
  }

  wrapper.append(caption, input, datalist);
  return wrapper;
}

function buildSelectField({ label, value, options, onInput, eventName = "change" }) {
  const wrapper = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = label;
  const select = document.createElement("select");
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    if (String(option.value) === String(value)) {
      element.selected = true;
    }
    select.append(element);
  }
  select.addEventListener(eventName, () => onInput(select.value));
  wrapper.append(caption, select);
  return wrapper;
}

function buildCheckboxField({ label, checked, onInput, eventName = "change" }) {
  const wrapper = document.createElement("label");
  wrapper.className = "property-note";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.style.width = "auto";
  input.addEventListener(eventName, () => onInput(input.checked));
  wrapper.append(input, document.createTextNode(` ${label}`));
  return wrapper;
}

function buildPropertySection(title, body, className = "property-grid") {
  const section = document.createElement("section");
  section.className = "property-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);

  const container = document.createElement("div");
  container.className = className;
  if (Array.isArray(body)) {
    container.append(...body);
  } else if (body) {
    container.append(body);
  }

  section.append(container);
  return section;
}

function buildPropertyDetails({ key, title, body, note }) {
  const details = document.createElement("details");
  details.className = "subpanel";
  details.open = Boolean(state.propertyPanels[key]);
  details.addEventListener("toggle", () => {
    state.propertyPanels[key] = details.open;
  });

  const summary = document.createElement("summary");
  summary.textContent = title;
  details.append(summary);

  const wrapper = document.createElement("div");
  wrapper.className = "property-block";
  if (Array.isArray(body)) {
    wrapper.append(...body);
  } else if (body) {
    wrapper.append(body);
  }

  if (note) {
    const noteBlock = document.createElement("div");
    noteBlock.className = "property-note";
    noteBlock.textContent = note;
    wrapper.append(noteBlock);
  }

  details.append(wrapper);
  return details;
}

function buildRawNodeEditor(node) {
  const block = document.createElement("div");
  block.className = "property-block";
  const header = document.createElement("div");
  header.className = "property-header";
  const title = document.createElement("h3");
  title.textContent = "原始 TSPL";
  header.append(title);

  const textarea = document.createElement("textarea");
  textarea.value = node.text;
  textarea.addEventListener("change", () => updateNodeField(node.id, "text", textarea.value));

  const note = document.createElement("div");
  note.className = "property-note";
  note.textContent = "这些命令会原样写回输出文件，不参与画布渲染；失焦后应用。";

  block.append(header, textarea, note);
  return block;
}

function renderProperties() {
  elements.propertiesPanel.innerHTML = "";
  const node = selectedNode();

  if (!node) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "选中一个元素后，这里会显示它的属性。";
    elements.propertiesPanel.append(empty);
    return;
  }

  if (node.kind === "raw") {
    elements.propertiesPanel.append(buildRawNodeEditor(node));
    return;
  }

  elements.propertiesPanel.append(
    buildPropertySection("定位", [
      buildTextField({
        label: "名称",
        value: node.name,
        onInput: (value) => updateNodeField(node.id, "name", value),
      }),
      buildSelectField({
        label: "旋转",
        value: String(node.rotation),
        options:
          node.kind === "image" || node.kind === "bar" || node.kind === "box"
            ? [{ value: "0", label: "0°" }]
            : [
                { value: "0", label: "0°" },
                { value: "90", label: "90°" },
                { value: "180", label: "180°" },
                { value: "270", label: "270°" },
              ],
        onInput: (value) => updateNodeField(node.id, "rotation", Number.parseInt(value, 10)),
      }),
      buildNumberField({
        label: "X",
        value: node.x,
        onInput: (value) => updateNodeField(node.id, "x", Number.parseInt(value, 10) || 0),
      }),
      buildNumberField({
        label: "Y",
        value: node.y,
        onInput: (value) => updateNodeField(node.id, "y", Number.parseInt(value, 10) || 0),
      }),
    ]),
  );

  if (node.kind === "text") {
    elements.propertiesPanel.append(
      buildPropertySection("文字", [
        buildTextField({
          label: "内容",
          value: node.text,
          onInput: (value) => updateNodeField(node.id, "text", value),
        }),
        buildSuggestTextField({
          label: "字体",
          value: node.font,
          options: TEXT_FONT_OPTIONS,
          listId: `font-options-${node.id}`,
          onInput: (value) => updateNodeField(node.id, "font", value),
        }),
      ]),
      buildPropertyDetails({
        key: "textAdvanced",
        title: "文字高级选项",
        body: [
          buildPropertySection("高级参数", [
            buildNumberField({
              label: "横向倍率",
              value: node.xMultiplier,
              min: 1,
              max: 10,
              onInput: (value) => updateNodeField(node.id, "xMultiplier", Number.parseInt(value, 10) || 1),
            }),
            buildNumberField({
              label: "纵向倍率",
              value: node.yMultiplier,
              min: 1,
              max: 10,
              onInput: (value) => updateNodeField(node.id, "yMultiplier", Number.parseInt(value, 10) || 1),
            }),
            buildSelectField({
              label: "对齐",
              value: node.alignment === null ? "none" : String(node.alignment),
              options: [
                { value: "none", label: "默认" },
                { value: "0", label: "左" },
                { value: "1", label: "中" },
                { value: "2", label: "右" },
              ],
              onInput: (value) => updateNodeField(node.id, "alignment", value === "none" ? null : Number.parseInt(value, 10)),
            }),
          ]),
        ],
        note: "可选常用字体：1-5、TSS16/24/32/48.BF2、TST16/24/32/48.BF2；也可以手动输入其它字体名。",
      }),
    );
    return;
  }

  if (node.kind === "barcode") {
    elements.propertiesPanel.append(
      buildPropertySection("条码", [
        buildTextField({
          label: "数据",
          value: node.data,
          onInput: (value) => updateNodeField(node.id, "data", value),
        }),
        buildSelectField({
          label: "类型",
          value: node.barcodeType,
          options: [
            { value: "128", label: "Code 128" },
            { value: "39", label: "Code 39" },
            { value: "EAN13", label: "EAN13" },
            { value: "EAN8", label: "EAN8" },
            { value: "UPCA", label: "UPCA" },
          ],
          onInput: (value) => updateNodeField(node.id, "barcodeType", value),
        }),
        buildNumberField({
          label: "高度",
          value: node.height,
          min: 10,
          max: 800,
          onInput: (value) => updateNodeField(node.id, "height", Number.parseInt(value, 10) || 40),
        }),
      ]),
      buildPropertyDetails({
        key: "barcodeAdvanced",
        title: "条码高级选项",
        body: [
          buildPropertySection("高级参数", [
            buildNumberField({
              label: "窄条宽度",
              value: node.narrow,
              min: 1,
              max: 20,
              onInput: (value) => updateNodeField(node.id, "narrow", Number.parseInt(value, 10) || 1),
            }),
            buildNumberField({
              label: "宽条宽度",
              value: node.wide,
              min: 1,
              max: 20,
              onInput: (value) => updateNodeField(node.id, "wide", Number.parseInt(value, 10) || 2),
            }),
            buildSelectField({
              label: "可读文字",
              value: String(node.humanReadable),
              options: [
                { value: "0", label: "不显示" },
                { value: "1", label: "居中" },
                { value: "2", label: "左对齐" },
                { value: "3", label: "右对齐" },
              ],
              onInput: (value) => updateNodeField(node.id, "humanReadable", Number.parseInt(value, 10) || 0),
            }),
            buildSelectField({
              label: "对齐",
              value: node.alignment === null ? "none" : String(node.alignment),
              options: [
                { value: "none", label: "默认" },
                { value: "0", label: "左" },
                { value: "1", label: "中" },
                { value: "2", label: "右" },
              ],
              onInput: (value) => updateNodeField(node.id, "alignment", value === "none" ? null : Number.parseInt(value, 10)),
            }),
          ]),
        ],
      }),
    );
    return;
  }

  if (node.kind === "qr") {
    elements.propertiesPanel.append(
      buildPropertySection("二维码", [
        buildTextField({
          label: "数据",
          value: node.data,
          onInput: (value) => updateNodeField(node.id, "data", value),
        }),
        buildSelectField({
          label: "容错级别",
          value: node.errorCorrection,
          options: [
            { value: "L", label: "L" },
            { value: "M", label: "M" },
            { value: "Q", label: "Q" },
            { value: "H", label: "H" },
          ],
          onInput: (value) => updateNodeField(node.id, "errorCorrection", value),
        }),
        buildNumberField({
          label: "模块宽度",
          value: node.cellWidth,
          min: 1,
          max: 10,
          onInput: (value) => updateNodeField(node.id, "cellWidth", Number.parseInt(value, 10) || 6),
        }),
      ]),
      buildPropertyDetails({
        key: "qrAdvanced",
        title: "二维码高级选项",
        body: [
          buildPropertySection("高级参数", [
            buildSelectField({
              label: "版本",
              value: node.model,
              options: [
                { value: "M1", label: "M1" },
                { value: "M2", label: "M2" },
              ],
              onInput: (value) => updateNodeField(node.id, "model", value),
            }),
            buildSelectField({
              label: "Mask",
              value: node.mask,
              options: Array.from({ length: 9 }, (_, index) => ({
                value: `S${index}`,
                label: `S${index}`,
              })),
              onInput: (value) => updateNodeField(node.id, "mask", value),
            }),
            buildSelectField({
              label: "模式",
              value: node.mode,
              options: [
                { value: "A", label: "自动" },
                { value: "M", label: "手动" },
              ],
              onInput: (value) => updateNodeField(node.id, "mode", value),
            }),
          ]),
        ],
        note: "这版先覆盖常用 QRCODE 文本模式；更复杂的手动分段语法会保留为原始 TSPL 块。",
      }),
    );
    return;
  }

  if (node.kind === "bar") {
    elements.propertiesPanel.append(
      buildPropertySection("线条", [
        buildNumberField({
          label: "宽度",
          value: node.width,
          min: 1,
          onInput: (value) => updateNodeField(node.id, "width", Number.parseInt(value, 10) || 1),
        }),
        buildNumberField({
          label: "高度",
          value: node.height,
          min: 1,
          onInput: (value) => updateNodeField(node.id, "height", Number.parseInt(value, 10) || 1),
        }),
      ]),
    );
    return;
  }

  if (node.kind === "box") {
    elements.propertiesPanel.append(
      buildPropertySection("方框", [
        buildNumberField({
          label: "宽度",
          value: node.width,
          min: 1,
          onInput: (value) => updateNodeField(node.id, "width", Number.parseInt(value, 10) || 1),
        }),
        buildNumberField({
          label: "高度",
          value: node.height,
          min: 1,
          onInput: (value) => updateNodeField(node.id, "height", Number.parseInt(value, 10) || 1),
        }),
        buildNumberField({
          label: "线宽",
          value: node.thickness,
          min: 1,
          onInput: (value) => updateNodeField(node.id, "thickness", Number.parseInt(value, 10) || 1),
        }),
      ]),
    );
    return;
  }

  if (node.kind === "image") {
    const replace = document.createElement("button");
    replace.type = "button";
    replace.className = "tonal-button";
    replace.textContent = "重新选择图片";
    replace.addEventListener("click", () => {
      state.pendingImagePlacement = { x: node.x, y: node.y };
      elements.imageFileInput.dataset.replaceTarget = node.id;
      elements.imageFileInput.click();
    });

    elements.propertiesPanel.append(
      buildPropertySection("图片", [
        buildNumberField({
          label: "宽度",
          value: node.bitmapWidth,
          min: 1,
          onInput: (value) => rebuildImageNode(node.id, { bitmapWidth: value }),
        }),
        buildNumberField({
          label: "高度",
          value: node.bitmapHeight,
          min: 1,
          onInput: (value) => rebuildImageNode(node.id, { bitmapHeight: value }),
        }),
        buildNumberField({
          label: "阈值",
          value: node.threshold,
          min: 0,
          max: 255,
          onInput: (value) => rebuildImageNode(node.id, { threshold: value }),
        }),
      ]),
      buildPropertyDetails({
        key: "imageAdvanced",
        title: "图片高级选项",
        body: [
          buildPropertySection("高级参数", [
        buildSelectField({
          label: "模式",
          value: String(node.mode),
              options: [
                { value: "0", label: "覆盖" },
                { value: "1", label: "OR" },
                { value: "2", label: "XOR" },
              ],
          onInput: (value) => updateNodeField(node.id, "mode", Number.parseInt(value, 10) || 0),
        }),
            buildCheckboxField({
              label: "反相",
              checked: node.invert,
              onInput: (value) => rebuildImageNode(node.id, { invert: value }),
            }),
          ], "property-block"),
          replace,
        ],
      }),
    );
  }
}

function renderSettings() {
  const { settings } = state.document;
  const measurementUnit = normalizePaperUnit(settings.measurementUnit);
  const entries = {
    width: settings[measurementValueField("width")],
    height: settings[measurementValueField("height")],
    gap: settings[measurementValueField("gap")],
    gapOffset: settings[measurementValueField("gapOffset")],
    dpi: settings.dpi,
    direction: settings.direction,
    mirror: settings.mirror,
    referenceX: settings.referenceX,
    referenceY: settings.referenceY,
    sets: settings.sets,
    copies: settings.copies,
  };

  Object.entries(entries).forEach(([name, value]) => {
    const input = elements.documentSettings.querySelector(`[name="${name}"]`);
    if (input && document.activeElement !== input) {
      input.value = String(value);
    }
  });

  for (const field of PAPER_MEASUREMENT_FIELDS) {
    const input = elements.documentSettings.querySelector(`[name="${field}"]`);
    if (!input) {
      continue;
    }
    input.step = measurementUnit === "mm" ? "0.1" : "1";
    input.min = String(dotsToPaperUnit(PAPER_MEASUREMENT_MIN[field], measurementUnit, settings.dpi));
  }

  if (elements.projectNameInput && document.activeElement !== elements.projectNameInput) {
    elements.projectNameInput.value = state.project.name || "";
  }

  if (elements.paperUnitInput && document.activeElement !== elements.paperUnitInput) {
    elements.paperUnitInput.value = measurementUnit;
  }
}

function renderWarnings() {
  const panel = document.createElement("div");
  panel.className = "warning-list";
  if (state.warnings.length === 0) {
    return null;
  }

  const list = document.createElement("ul");
  list.className = "warning-list";
  for (const warning of state.warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    list.append(item);
  }
  panel.append(list);
  return panel;
}

function render() {
  ensureSelection();
  renderSettings();
  renderCanvas();
  renderLayers();
  renderProperties();
  renderBleStatus();
  elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;

  const existingWarnings = elements.propertiesPanel.querySelector(".warning-list");
  if (existingWarnings) {
    existingWarnings.remove();
  }
  const warnings = renderWarnings();
  if (warnings) {
    elements.propertiesPanel.append(warnings);
  }
}

function startDragNode(event, nodeId) {
  const node = state.document.nodes.find((entry) => entry.id === nodeId);
  if (!node || node.kind === "raw") {
    return;
  }

  state.selectedId = nodeId;
  render();

  const startX = event.clientX;
  const startY = event.clientY;
  const initialX = node.x;
  const initialY = node.y;
  const element = elements.canvasItems.querySelector(`[data-id="${nodeId}"]`);
  element?.classList.add("dragging");

  const handleMove = (moveEvent) => {
    const deltaX = Math.round((moveEvent.clientX - startX) / state.zoom);
    const deltaY = Math.round((moveEvent.clientY - startY) / state.zoom);
    updateDocument(
      (document) => {
        const target = document.nodes.find((entry) => entry.id === nodeId);
        if (!target) {
          return;
        }
        const geometry = getRenderableGeometry(target);
        const maxX = Math.max(0, document.settings.width - geometry.boxWidth);
        const maxY = Math.max(0, document.settings.height - geometry.boxHeight);
        target.x = Math.max(0, Math.min(maxX, initialX + deltaX));
        target.y = Math.max(0, Math.min(maxY, initialY + deltaY));
      },
      { keepSelection: true },
    );
  };

  const handleUp = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    element?.classList.remove("dragging");
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
}

async function loadImageFile(file, replaceTarget = "") {
  if (!file) {
    return;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const preview = new Image();
    preview.onload = () => resolve(preview);
    preview.onerror = () => reject(new Error("图片加载失败"));
    preview.src = dataUrl;
  });

  const availableWidth = Math.min(state.document.settings.width - state.pendingImagePlacement.x, 220);
  const width = Math.max(24, Math.min(image.width, availableWidth));
  const height = Math.max(24, Math.round((image.height / image.width) * width));
  const rasterized = await rasterizeImageFromDataUrl(dataUrl, width, height, 150, false);

  if (replaceTarget) {
    updateDocument(
      (document) => {
        const node = document.nodes.find((entry) => entry.id === replaceTarget);
        if (!node || node.kind !== "image") {
          return;
        }
        node.sourceDataUrl = dataUrl;
        node.bitmap = rasterized.bitmap;
        node.byteWidth = rasterized.byteWidth;
        node.bitmapWidth = rasterized.bitmapWidth;
        node.bitmapHeight = rasterized.bitmapHeight;
        node.bitmapHex = rasterized.bitmapHex;
        node.previewDataUrl = rasterized.previewDataUrl;
      },
      { keepSelection: true },
    );
    setStatus("图片已替换");
    return;
  }

  updateDocument((document) => {
    document.nodes.push(
      createNode("image", {
        x: state.pendingImagePlacement.x,
        y: state.pendingImagePlacement.y,
        sourceDataUrl: dataUrl,
        bitmap: rasterized.bitmap,
        byteWidth: rasterized.byteWidth,
        bitmapWidth: rasterized.bitmapWidth,
        bitmapHeight: rasterized.bitmapHeight,
        bitmapHex: rasterized.bitmapHex,
        previewDataUrl: rasterized.previewDataUrl,
      }),
    );
    state.selectedId = document.nodes.at(-1)?.id ?? null;
  });
  setStatus("图片已添加");
}

function wireEvents() {
  elements.documentSettings.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    updateSetting(target.name, target.value);
  });

  elements.projectNameInput.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    updateProjectName(target.value);
  });

  elements.paperUnitInput.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    updatePaperUnit(target.value);
  });

  elements.zoomRange.addEventListener("input", () => {
    state.zoom = Number.parseFloat(elements.zoomRange.value);
    render();
    schedulePersistEditorState();
  });

  elements.applyBulkOffsetButton.addEventListener("click", () => {
    const dxInput = elements.bulkOffsetSettings.querySelector('[name="dx"]');
    const dyInput = elements.bulkOffsetSettings.querySelector('[name="dy"]');
    offsetAllVisualNodes(dxInput?.value ?? "0", dyInput?.value ?? "0");
  });

  elements.clearElementsButton.addEventListener("click", () => {
    clearAllElements();
  });

  elements.bleConnectButton.addEventListener("click", () => {
    connectBlePrinter();
  });

  elements.bleRefreshButton.addEventListener("click", () => {
    refreshBleSelection();
  });

  elements.bleDisconnectButton.addEventListener("click", () => {
    disconnectBlePrinter();
  });

  elements.blePrintButton.addEventListener("click", () => {
    printCurrentLabelViaBle();
  });

  elements.addVariableButton.addEventListener("click", () => {
    addVariable();
  });

  elements.newDocumentButton.addEventListener("click", () => {
    state.project = createProjectState();
    state.variables = [];
    state.sourceDirty = false;
    setDocument(createEmptyDocument(), [], false);
    renderVariablesPanel();
    setStatus("已新建空白标签");
  });

  elements.loadSampleButton.addEventListener("click", () => {
    state.project = createProjectState({ name: "示例工程" });
    state.variables = [];
    state.sourceDirty = false;
    setDocument(createSampleDocument(), [], false);
    renderVariablesPanel();
    setStatus("已加载示例");
  });

  elements.openFileButton.addEventListener("click", () => {
    elements.openFileInput.click();
  });

  elements.remoteLoadButton.addEventListener("click", () => {
    loadRemoteProjectFile().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`远端配置加载失败: ${message}`);
    });
  });

  elements.openFileInput.addEventListener("change", async () => {
    const file = elements.openFileInput.files?.[0];
    if (!file) {
      return;
    }

    await openWorkspaceFile(file);
    elements.openFileInput.value = "";
  });

  elements.saveFileButton.addEventListener("click", saveProjectFile);
  elements.remoteSaveButton.addEventListener("click", () => {
    saveRemoteProjectFile().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`远端配置保存失败: ${message}`);
    });
  });
  elements.exportTsplButton.addEventListener("click", saveTspl);
  elements.applySourceButton.addEventListener("click", () => {
    applySourceToDocument();
  });

  elements.sourceEditor.addEventListener("input", () => {
    state.sourceDirty = true;
    setStatus("源码有未应用修改");
    schedulePersistEditorState();
  });

  for (const input of [
    elements.bleNamePrefixInput,
    elements.bleServiceInput,
    elements.bleCharacteristicInput,
    elements.bleEncodingInput,
    elements.bleChunkSizeInput,
    elements.bleWriteDelayInput,
  ]) {
    input.addEventListener("input", () => {
      schedulePersistEditorState();
    });
  }

  elements.palette.addEventListener("click", (event) => {
    const target = event.target.closest("[data-kind]");
    if (!target) {
      return;
    }
    addNode(target.dataset.kind, 24, 24);
  });

  for (const item of elements.palette.querySelectorAll("[data-kind]")) {
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", item.dataset.kind ?? "");
      event.dataTransfer.effectAllowed = "copy";
    });
  }

  elements.paperFace.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  elements.paperFace.addEventListener("drop", (event) => {
    event.preventDefault();
    const kind = event.dataTransfer?.getData("text/plain");
    if (!kind) {
      return;
    }
    const position = getDropPosition(event);
    addNode(kind, position.x, position.y);
  });

  elements.paperStage.addEventListener("click", () => {
    state.selectedId = null;
    render();
  });

  elements.imageFileInput.addEventListener("change", async () => {
    const file = elements.imageFileInput.files?.[0];
    const replaceTarget = elements.imageFileInput.dataset.replaceTarget ?? "";
    if (!file) {
      return;
    }

    await loadImageFile(file, replaceTarget);
    elements.imageFileInput.value = "";
    delete elements.imageFileInput.dataset.replaceTarget;
  });

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (isPrimaryShortcut(event) && key === "c" && selectedNode() && !isEditingTextField()) {
      event.preventDefault();
      copySelectedNode();
      return;
    }

    if (isPrimaryShortcut(event) && key === "v" && !isEditingTextField()) {
      event.preventDefault();
      pasteCopiedNode();
      return;
    }

    if (["Delete", "Backspace"].includes(event.key) && selectedNode() && !isEditingTextField()) {
      event.preventDefault();
      deleteNode(state.selectedId);
      setStatus("元素已删除");
      return;
    }

    const node = selectedNode();
    if (!node || node.kind === "raw") {
      return;
    }

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && !isEditingTextField()) {
      event.preventDefault();
      const deltaX = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const deltaY = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      moveNode(node.id, deltaX, deltaY);
    }
  });

  window.addEventListener("pagehide", () => {
    persistEditorStateNow();
  });
}

async function initializeApp() {
  state.remoteConfig = readRemoteConfigEndpoints();

  elements.remoteLoadButton.hidden = !hasRemoteGetEndpoint();
  elements.remoteSaveButton.hidden = !hasRemoteSetEndpoint();

  elements.bleServiceInput.value = DEFAULT_BLE_SERVICE_TEXT;
  wireEvents();

  if (hasRemoteGetEndpoint()) {
    try {
      await loadRemoteProjectFile();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`远端配置加载失败: ${message}`);
    }
  }

  if (!restorePersistedEditorState()) {
    syncSourceFromDocument(true);
    render();
    renderVariablesPanel();
  }
}

void initializeApp();
