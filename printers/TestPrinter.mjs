import { BasePrinter } from "./BasePrinter.mjs";

export class TestPrinter extends BasePrinter {
  constructor({ onStatus, onStateChange, outputElement = null } = {}) {
    super({
      type: "test",
      title: "测试打印机",
      onStatus,
      onStateChange,
      argument_list: [{ key: "autoScroll", title: "打印后自动滚动", type: "bool", value: false }],
      action_list: [{ key: "clearOutput", title: "清空输出", variant: "outlined" }],
    });
    this.outputElement = outputElement;
    this.syncInfo();
  }

  get ready() {
    return true;
  }

  syncInfo() {
    this.setInfoList([
      { title: "类型", value: "Test Printer" },
      { title: "状态", value: "已就绪" },
      { title: "输出", value: this.outputElement ? "页面输出区" : "console.log" },
    ]);
  }

  clearOutput() {
    if (this.outputElement) {
      this.outputElement.value = "";
    }
    this.setStatus("已清空测试输出");
  }

  async on_action(key) {
    switch (key) {
      case "clearOutput":
        return this.clearOutput();
      default:
        throw new Error(`Unsupported test action: ${key}`);
    }
  }

  async print(tspl) {
    if (this.outputElement) {
      const previous = this.outputElement.value.trim();
      this.outputElement.value = previous ? `${previous}\n\n-----\n\n${tspl}` : tspl;
      if (this.getArgument("autoScroll")) {
        this.outputElement.scrollTop = this.outputElement.scrollHeight;
      }
    } else {
      console.log("[TEST PRINTER OUTPUT]\\n" + tspl);
    }
    this.setStatus("测试打印机已输出渲染后的 TSPL");
  }
}
