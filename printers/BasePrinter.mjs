export class BasePrinter {
  constructor({ type, title, argument_list = [], action_list = [], onStatus = () => {}, onStateChange = () => {} } = {}) {
    this.type = type;
    this.title = title;
    this.argument_list = argument_list;
    this.action_list = action_list;
    this.info_list = [];
    this.onStatus = onStatus;
    this.onStateChange = onStateChange;
  }

  get ready() {
    return false;
  }

  setInfoList(infoList = []) {
    this.info_list = infoList;
    this.notifyStateChange();
  }

  notifyStateChange() {
    this.onStateChange?.(this);
  }

  setStatus(message) {
    this.onStatus?.(message);
  }

  getArgument(key) {
    return this.argument_list.find((entry) => entry.key === key)?.value;
  }

  setArgument(key, value) {
    const entry = this.argument_list.find((item) => item.key === key);
    if (entry) {
      entry.value = value;
      this.notifyStateChange();
    }
  }

  loadArguments(values = {}) {
    for (const entry of this.argument_list) {
      if (Object.prototype.hasOwnProperty.call(values, entry.key)) {
        entry.value = values[entry.key];
      }
    }
    this.notifyStateChange();
  }

  exportArguments() {
    return Object.fromEntries(this.argument_list.map((entry) => [entry.key, entry.value]));
  }

  async on_action(_key) {
    throw new Error("Not implemented");
  }

  async print(_tspl) {
    throw new Error("Not implemented");
  }
}
