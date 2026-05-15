import { generateTsplPayload, parseTsplSource } from "../tspl-core.mjs";
import { BasePrinter } from "./BasePrinter.mjs";

export class USBPrinter extends BasePrinter {
  constructor({ onStatus, onStateChange } = {}) {
    super({
      type: "usb",
      title: "USB 打印机",
      onStatus,
      onStateChange,
      argument_list: [
        { key: "filtersInput", title: "设备过滤器 JSON", type: "textarea", value: JSON.stringify([{ classCode: 7 }, { classCode: 255 }], null, 2) },
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
        { key: "chunkSize", title: "分片大小", type: "number", value: 512, min: 32, max: 4096, step: 1 },
      ],
      action_list: [
        { key: "select", title: "连接设备", variant: "filled" },
        { key: "refresh", title: "刷新端点", variant: "outlined" },
        { key: "disconnect", title: "断开", variant: "text" },
      ],
    });

    this.device = null;
    this.interfaceNumber = null;
    this.alternateSetting = null;
    this.endpointNumber = null;
    this.connecting = false;
    this.syncInfo();
  }

  get ready() {
    return Boolean(this.device?.opened && this.endpointNumber !== null);
  }

  syncInfo() {
    this.setInfoList([
      { title: "类型", value: "WebUSB" },
      { title: "设备", value: this.device?.productName || "未连接" },
      { title: "接口", value: this.interfaceNumber === null ? "未选择" : String(this.interfaceNumber) },
      { title: "端点", value: this.endpointNumber === null ? "未选择" : String(this.endpointNumber) },
      { title: "状态", value: this.connecting ? "连接中" : this.endpointNumber === null ? "未就绪" : "已就绪" },
    ]);
  }

  clearSelection() {
    this.device = null;
    this.interfaceNumber = null;
    this.alternateSetting = null;
    this.endpointNumber = null;
    this.connecting = false;
    this.syncInfo();
  }

  getFilters() {
    const raw = String(this.getArgument("filtersInput") ?? "").trim();
    const parsed = raw ? JSON.parse(raw) : [{ classCode: 7 }, { classCode: 255 }];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("USB 过滤器必须是非空 JSON 数组");
    }
    return parsed;
  }

  findWritableUsbEndpoints(device) {
    const matches = [];
    for (const configuration of device.configurations ?? []) {
      for (const iface of configuration.interfaces ?? []) {
        for (const alternate of iface.alternates ?? []) {
          for (const endpoint of alternate.endpoints ?? []) {
            console.log("[USB] endpoint", {
              configurationValue: configuration.configurationValue,
              interfaceNumber: iface.interfaceNumber,
              alternateSetting: alternate.alternateSetting,
              direction: endpoint.direction,
              type: endpoint.type,
              endpointNumber: endpoint.endpointNumber,
              packetSize: endpoint.packetSize,
            });
            if (endpoint.direction === "out") {
              matches.push({
                configurationValue: configuration.configurationValue,
                interfaceNumber: iface.interfaceNumber,
                alternateSetting: alternate.alternateSetting,
                endpointNumber: endpoint.endpointNumber,
                type: endpoint.type,
              });
            }
          }
        }
      }
    }
    return matches;
  }

  async selectWritableUsbEndpoint(device) {
    const matches = this.findWritableUsbEndpoints(device);
    if (matches.length === 0) {
      throw new Error("没有找到可写的 USB 输出端点，请查看控制台日志。");
    }

    const preferred = matches.find((entry) => entry.type === "bulk") ?? matches.find((entry) => entry.type === "interrupt") ?? matches[0];
    console.log("[USB] selected writable endpoint", preferred);

    if (device.configuration?.configurationValue !== preferred.configurationValue) {
      await device.selectConfiguration(preferred.configurationValue);
    }
    await device.claimInterface(preferred.interfaceNumber);
    if (preferred.alternateSetting !== undefined) {
      await device.selectAlternateInterface(preferred.interfaceNumber, preferred.alternateSetting);
    }
    return preferred;
  }

  async select() {
    if (!(typeof navigator !== "undefined" && "usb" in navigator)) {
      throw new Error("当前浏览器不支持 WebUSB");
    }

    this.connecting = true;
    this.syncInfo();
    try {
      const filters = this.getFilters();
      console.log("[USB] requestDevice filters", filters);
      const device = await navigator.usb.requestDevice({ filters });
      if (!device.opened) {
        await device.open();
      }
      this.device = device;
      this.interfaceNumber = null;
      this.alternateSetting = null;
      this.endpointNumber = null;
      this.syncInfo();
      this.setStatus(`已连接 ${device.productName || "USB 设备"}，正在枚举端点…`);

      const selection = await this.selectWritableUsbEndpoint(device);
      this.interfaceNumber = selection.interfaceNumber;
      this.alternateSetting = selection.alternateSetting;
      this.endpointNumber = selection.endpointNumber;
      this.setStatus(`已连接 ${device.productName || "USB 设备"}，找到可写端点`);
    } catch (error) {
      if (!this.device?.opened) {
        this.clearSelection();
      }
      throw error;
    } finally {
      this.connecting = false;
      this.syncInfo();
    }
  }

  async refresh() {
    if (!this.device?.opened) {
      throw new Error("当前没有已连接的 USB 设备");
    }

    this.connecting = true;
    this.syncInfo();
    try {
      const selection = await this.selectWritableUsbEndpoint(this.device);
      this.interfaceNumber = selection.interfaceNumber;
      this.alternateSetting = selection.alternateSetting;
      this.endpointNumber = selection.endpointNumber;
      this.setStatus("已刷新 USB 可写端点");
    } finally {
      this.connecting = false;
      this.syncInfo();
    }
  }

  async disconnect() {
    try {
      if (this.device?.opened) {
        if (this.interfaceNumber !== null) {
          try {
            await this.device.releaseInterface(this.interfaceNumber);
          } catch (error) {
            console.log("[USB] releaseInterface failed", error);
          }
        }
        await this.device.close();
      }
    } finally {
      this.clearSelection();
      this.setStatus("USB 已断开");
    }
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
        throw new Error(`Unsupported USB action: ${key}`);
    }
  }

  async print(tspl) {
    if (!this.ready) {
      throw new Error("当前 USB 打印机未就绪");
    }
    const { document } = parseTsplSource(tspl);
    const payload = generateTsplPayload(document, { textEncoding: this.getArgument("encoding") || "utf-8" });
    const chunkSize = Math.max(32, Math.min(4096, Number.parseInt(this.getArgument("chunkSize"), 10) || 512));

    this.connecting = true;
    this.syncInfo();
    try {
      for (let offset = 0; offset < payload.length; offset += chunkSize) {
        const chunk = payload.slice(offset, offset + chunkSize);
        const result = await this.device.transferOut(this.endpointNumber, chunk);
        console.log("[USB] transferOut", { endpointNumber: this.endpointNumber, offset, length: chunk.length, status: result.status, bytesWritten: result.bytesWritten });
        if (result.status !== "ok") {
          throw new Error(`transferOut status=${result.status}`);
        }
      }
      this.setStatus(`已通过 USB 发送 ${payload.length} 字节（${String(this.getArgument("encoding") || "utf-8").toUpperCase()}）`);
    } finally {
      this.connecting = false;
      this.syncInfo();
    }
  }
}
