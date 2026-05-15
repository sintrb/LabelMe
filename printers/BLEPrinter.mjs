import { generateTsplPayload, parseTsplSource } from "../tspl-core.mjs";
import { BasePrinter } from "./BasePrinter.mjs";

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

function compareUuidMatch(actual, expected) {
  if (!expected) {
    return false;
  }
  return canonicalizeBluetoothUuid(actual) === canonicalizeBluetoothUuid(expected);
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

export class BLEPrinter extends BasePrinter {
  constructor({ onStatus, onStateChange } = {}) {
    super({
      type: "ble",
      title: "蓝牙打印机",
      onStatus,
      onStateChange,
      argument_list: [
        { key: "namePrefix", title: "设备名前缀", type: "text", value: "", placeholder: "可选，例如 MPT、Printer" },
        { key: "serviceInput", title: "候选服务 UUID", type: "textarea", value: "0xFE7D\n0x1E4D\n0x8841\n0000fff8-0000-1000-8000-00805f9b34fb\n49535343-fe7d-4ae5-8fa9-9fafd205e455\n6e400001-b5a3-f393-e0a9-e50e24dcca9e\n0000ae30-0000-1000-8000-00805f9b34fb" },
        { key: "characteristicInput", title: "优先特征 UUID", type: "text", value: "", placeholder: "可选，留空则自动选择首个可写特征" },
        {
          key: "encoding",
          title: "文本编码",
          type: "select",
          value: "utf-8",
          options: [
            { value: "utf-8", label: "UTF-8" },
            { value: "gbk", label: "GBK" },
          ],
        },
        { key: "chunkSize", title: "分片大小", type: "number", value: 180, min: 20, max: 512, step: 1 },
        { key: "writeDelay", title: "分片延迟 ms", type: "number", value: 12, min: 0, max: 500, step: 1 },
      ],
      action_list: [
        { key: "select", title: "连接设备", variant: "filled" },
        { key: "refresh", title: "刷新端口", variant: "outlined" },
        { key: "disconnect", title: "断开", variant: "text" },
      ],
    });

    this.device = null;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.writeMode = null;
    this.connecting = false;
    this.syncInfo();
  }

  get ready() {
    return Boolean(this.characteristic && this.device?.gatt?.connected);
  }

  syncInfo() {
    this.setInfoList([
      { title: "类型", value: "Web Bluetooth" },
      { title: "设备", value: this.device?.name || "未连接" },
      { title: "服务", value: this.service?.uuid || "未选择" },
      { title: "特征", value: this.characteristic?.uuid || "未选择" },
      { title: "状态", value: this.connecting ? "连接中" : this.writeMode || "未就绪" },
    ]);
  }

  buildRequestOptions() {
    const optionalServices = parseBluetoothIdentifierList(this.getArgument("serviceInput"));
    const namePrefix = String(this.getArgument("namePrefix") ?? "").trim();
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

  async collectAccessibleServices(server) {
    const requestedServices = parseBluetoothIdentifierList(this.getArgument("serviceInput"));
    const services = new Map();

    if (typeof server.getPrimaryServices === "function") {
      try {
        const allServices = await server.getPrimaryServices();
        console.log("[BLE] getPrimaryServices() ->", allServices.map((service) => service.uuid));
        for (const service of allServices) {
          services.set(service.uuid, service);
        }
      } catch (error) {
        console.log("[BLE] getPrimaryServices() failed:", error instanceof Error ? error.message : String(error));
      }
    }

    for (const identifier of requestedServices) {
      try {
        const service = await server.getPrimaryService(identifier);
        services.set(service.uuid, service);
        console.log("[BLE] accessible service", service.uuid);
      } catch (error) {
        console.log("[BLE] service probe failed", identifier, error instanceof Error ? error.message : String(error));
      }
    }

    return [...services.values()];
  }

  async discoverWritableCharacteristic(server) {
    const services = await this.collectAccessibleServices(server);
    const preferredCharacteristic = parseBluetoothIdentifier(this.getArgument("characteristicInput"));
    const candidates = [];

    for (const service of services) {
      let characteristics = [];
      try {
        characteristics = await service.getCharacteristics();
        console.log("[BLE] service characteristics", service.uuid, characteristics.map((c) => c.uuid));
      } catch (error) {
        console.log("[BLE] getCharacteristics() failed", service.uuid, error instanceof Error ? error.message : String(error));
        continue;
      }

      for (const characteristic of characteristics) {
        const writeMode = getCharacteristicWriteMode(characteristic);
        console.log("[BLE] characteristic", `${service.uuid} -> ${characteristic.uuid}`, `properties: ${describeBleCharacteristicProperties(characteristic.properties)}`, `write mode: ${writeMode || "not writable"}`);
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
        return preferred;
      }
    }

    return candidates.find((candidate) => candidate.writeMode === "writeWithoutResponse") ?? candidates[0];
  }

  clearSelection() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.writeMode = null;
    this.connecting = false;
    this.syncInfo();
  }

  async select() {
    if (!(typeof navigator !== "undefined" && "bluetooth" in navigator)) {
      throw new Error("当前浏览器不支持 Web Bluetooth");
    }

    this.connecting = true;
    this.syncInfo();

    try {
      const requestOptions = this.buildRequestOptions();
      console.log("[BLE] requestDevice options", requestOptions);
      const device = await navigator.bluetooth.requestDevice(requestOptions);
      const server = device.gatt?.connected ? device.gatt : await device.gatt.connect();

      this.device = device;
      this.server = server;
      this.service = null;
      this.characteristic = null;
      this.writeMode = null;
      this.syncInfo();
      this.setStatus(`已连接 ${device.name || "BLE 设备"}，正在枚举服务和特征…`);

      const selection = await this.discoverWritableCharacteristic(server);
      this.service = selection.service;
      this.characteristic = selection.characteristic;
      this.writeMode = selection.writeMode;
      this.setStatus(`已连接 ${device.name || "BLE 设备"}，找到可写端口`);
    } catch (error) {
      if (!this.device?.gatt?.connected) {
        this.clearSelection();
      }
      throw error;
    } finally {
      this.connecting = false;
      this.syncInfo();
    }
  }

  async refresh() {
    if (!this.device?.gatt?.connected || !this.server) {
      throw new Error("当前没有已连接的 BLE 设备");
    }

    this.connecting = true;
    this.syncInfo();
    try {
      const selection = await this.discoverWritableCharacteristic(this.server);
      this.service = selection.service;
      this.characteristic = selection.characteristic;
      this.writeMode = selection.writeMode;
      this.setStatus("已刷新 BLE 可写端口");
    } finally {
      this.connecting = false;
      this.syncInfo();
    }
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.clearSelection();
    this.setStatus("BLE 已断开");
  }

  async on_action(key) {
    switch (key) {
      case "select":
        return this.select();
      case "refresh":
        return this.refresh();
      case "disconnect":
        return this.disconnect();
      default:
        throw new Error(`Unsupported BLE action: ${key}`);
    }
  }

  async writeChunk(payload) {
    if (this.writeMode === "writeWithoutResponse" && typeof this.characteristic.writeValueWithoutResponse === "function") {
      await this.characteristic.writeValueWithoutResponse(payload);
      return;
    }
    if (this.writeMode === "writeWithResponse" && typeof this.characteristic.writeValueWithResponse === "function") {
      await this.characteristic.writeValueWithResponse(payload);
      return;
    }
    if (typeof this.characteristic.writeValue === "function") {
      await this.characteristic.writeValue(payload);
      return;
    }
    throw new Error("当前特征不支持写入");
  }

  async print(tspl) {
    if (!this.ready) {
      throw new Error("当前 BLE 打印机未就绪");
    }
    const { document } = parseTsplSource(tspl);
    const payload = generateTsplPayload(document, { textEncoding: this.getArgument("encoding") || "utf-8" });
    const chunkSize = Math.max(20, Math.min(512, Number.parseInt(this.getArgument("chunkSize"), 10) || 180));
    const writeDelay = Math.max(0, Number.parseInt(this.getArgument("writeDelay"), 10) || 0);

    this.connecting = true;
    this.syncInfo();
    try {
      for (let offset = 0; offset < payload.length; offset += chunkSize) {
        const chunk = payload.slice(offset, offset + chunkSize);
        await this.writeChunk(chunk);
        if (this.writeMode === "writeWithoutResponse" && writeDelay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, writeDelay));
        }
      }
      this.setStatus(`已通过 BLE 发送 ${payload.length} 字节（${String(this.getArgument("encoding") || "utf-8").toUpperCase()}）`);
    } finally {
      this.connecting = false;
      this.syncInfo();
    }
  }
}
