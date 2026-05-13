# LabelMe Studio

一个面向 **TSPL / TSPL2 标签模板编辑** 的零依赖静态前端编辑器。

它的目标不是再发明一套私有模板 DSL，而是：

- 直接围绕 **TSPL** 做可视化编辑
- 支持 **项目文件** 持久化
- 支持 **变量模板**
- 支持 **BLE 直连打印**
- 支持通过 **远端 `get/set` 接口** 拉取和保存配置

适合做：

- 花店 / 零售 / 仓储 / 生鲜等标签模板编辑
- 一花一码 / 一品一码类动态标签
- TSPL 模板维护工具
- 浏览器内快速调试打印布局

## 在线 Demo

你可以直接访问公开演示地址体验：

**https://io.inruan.com/LabelMe/**

---

## 功能特性

### 可视化编辑

- 纸张设置：
  - `SIZE`
  - `GAP`
  - `DIRECTION`
  - `REFERENCE`
  - 组数 / 份数
- 支持纸张单位切换：
  - `dot`
  - `mm`
- 画布拖拽定位
- 图层顺序调整
- 键盘微调：
  - 方向键移动
  - `Delete` / `Backspace` 删除
- 元素复制粘贴：
  - Windows / Linux：`Ctrl + C` / `Ctrl + V`
  - macOS：`⌘ + C` / `⌘ + V`

### 已支持的可视化元素

- 文字：`TEXT`
- 条码：`BARCODE`
- 二维码：`QRCODE`
- 线条：`BAR`
- 方框：`BOX`
- 图片：`BITMAP` / `BITMAPHEX`
- 原始 TSPL 块：用于保留未结构化支持的命令

### 变量模板

- 左侧变量列表支持：
  - 新增
  - 删除
  - 修改
- 支持占位符：

```text
{{name}}
{{c.name}}
{{c.level}}
```

- 变量会应用到：
  - `TEXT.text`
  - `BARCODE.data`
  - `QRCODE.data`

### 变量渲染策略

- **设计预览**：使用变量值渲染
- **BLE 打印**：使用变量值渲染
- **工程文件 / TSPL 源码**：保留原始占位符，不自动展开

### BLE 打印

- 使用 **Web Bluetooth**
- 自动寻找可写特征
- 支持控制台日志输出服务 / 特征枚举过程
- 支持文本编码切换：
  - `UTF-8`
  - `GBK`

### 项目文件

- 支持打开 / 保存工程文件（JSON）
- 支持本地自动恢复（`localStorage`）
- 支持导出标准 TSPL

### 远端配置接口模式

- 支持通过 URL 参数指定：
  - `get`
  - `set`
- 页面启动时自动加载远端配置
- 同时保留本地“打开工程 / 保存工程”能力

---

## 快速开始

直接在浏览器中打开 `index.html` 即可，或者使用任意静态服务器。

例如：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000/
```

> BLE 打印要求页面运行在 `https://` 或 `http://localhost`

---

## 基本使用

### 本地模式

不带任何 URL 参数时：

- 会优先恢复本地草稿
- 支持：
  - 打开工程
  - 保存工程
  - 导出 TSPL

### 远端接口模式

页面地址可带参数：

```text
?get=http://127.0.0.1:8080/eapi/getPrintLabelConfig&set=http://127.0.0.1:8080/eapi/savePrintLabelConfig
```

例如：

```text
http://localhost:8000/?get=http://127.0.0.1:8080/eapi/getPrintLabelConfig&set=http://127.0.0.1:8080/eapi/savePrintLabelConfig
```

启用后：

- 启动时自动调用远端 `get`
- 顶部会额外显示：
  - `加载配置`
  - `保存配置`
- 同时仍保留本地：
  - `打开工程`
  - `保存工程`

---

## 远端 `get/set` 接口说明

### 约定

- `get` 接口：**POST**
- `set` 接口：**POST**
- 当前前端请求**不携带 credentials**
- 后端只需支持普通跨域即可（例如 `Access-Control-Allow-Origin: *`）

---

### 1）获取配置接口

接口示例：

```text
http://127.0.0.1:8080/eapi/getPrintLabelConfig
```

请求方式：

```http
POST
```

返回示例：

```json
{
  "code": 0,
  "data": {
    "name": "一花一码",
    "variables": [
      {
        "name": "品名",
        "key": "c.name",
        "value": "卡罗拉花"
      },
      {
        "name": "等级",
        "key": "c.level",
        "value": "A"
      },
      {
        "name": "规格",
        "key": "c.normal",
        "value": "10枝/扎"
      },
      {
        "name": "编码",
        "key": "c.code",
        "value": "YH686454425"
      },
      {
        "name": "设备名",
        "key": "c.device_name",
        "value": "YA292838"
      }
    ],
    "tspl": {
      "source": "SIZE 60 mm,40 mm\nGAP 2 mm,0 mm\nCLS\nBOX 30,30,460,300,4\nBAR 30,82,430,2\nBAR 30,250,430,2\nTEXT 40,35,\"TSS24.BF2\",0,2,2,\"{{c.name}}\"\nTEXT 120,96,\"5\",0,3,3,\"{{c.level}}\"\nTEXT 40,260,\"TSS24.BF2\",0,1,1,\"{{c.code}} 设备:{{c.device_name}}\"\nQRCODE 340,120,M,4,A,0,\"{{c.code}}\"\nPRINT 1"
    }
  },
  "time": 0
}
```

#### 兼容策略

前端会尽量兼容这些返回结构：

1. **完整工程数据**
   - 包含 `schema: "labelme-project"` 的完整工程对象

2. **半结构配置**
   - 包含：
     - `name`
     - `variables`
     - `tspl.source`

3. **仅结构化对象**
   - 包含：
     - `paper + elements`
   - 或：
     - `settings + nodes`

如果返回里没有 `variables`，但 `tspl.source` 中含有 `{{key}}`，编辑器会自动提取变量列表。

---

### 2）保存配置接口

接口示例：

```text
http://127.0.0.1:8080/eapi/savePrintLabelConfig
```

请求方式：

```http
POST
Content-Type: application/json
```

请求体格式：

```json
{
  "data": {
    "...": "整个工程数据"
  }
}
```

也就是说，前端会把**完整工程对象**作为 `data` 字段提交。

#### 当前提交内容大致结构

```json
{
  "schema": "labelme-project",
  "format": "1.0",
  "name": "未命名工程",
  "version": "1.0",
  "created": "2026-05-12T08:00:00.000Z",
  "modified": "2026-05-12T08:10:00.000Z",
  "paper": {},
  "elements": [],
  "variables": [],
  "tspl": {
    "source": "...源码面板当前内容...",
    "generatedSource": "...当前元素自动生成的 TSPL...",
    "sourceDirty": false
  }
}
```

---

### 3）接口状态码约定

当前前端默认按下面规则判断：

- HTTP 非 `2xx`：判为失败
- JSON 中如果存在 `code` 且 `code !== 0`：判为失败
- 失败信息优先读取：
  - `message`
  - `msg`
  - 否则回退到 `code=xxx`

---

## 工程文件格式

本地“保存工程”会下载 `.labelme.json` 文件。

典型结构如下：

```json
{
  "schema": "labelme-project",
  "format": "1.0",
  "name": "一花一码",
  "version": "1.0",
  "created": "2026-05-12T08:00:00.000Z",
  "modified": "2026-05-12T08:10:00.000Z",
  "paper": {
    "dpi": 203,
    "width": 480,
    "height": 320,
    "gap": 16,
    "gapOffset": 0,
    "measurementUnit": "mm",
    "widthValue": 60,
    "heightValue": 40,
    "gapValue": 2,
    "gapOffsetValue": 0
  },
  "elements": [],
  "variables": [],
  "tspl": {
    "source": "SIZE 60 mm,40 mm\n...",
    "generatedSource": "SIZE 60 mm,40 mm\n...",
    "sourceDirty": false
  }
}
```

### 说明

- `paper`：纸张与打印设置
- `elements`：可视化元素
- `variables`：变量列表
- `tspl.source`：源码面板当前内容
- `tspl.generatedSource`：当前元素模型自动生成的源码
- `tspl.sourceDirty`：源码面板是否存在未应用修改

---

## 变量模板说明

变量占位符格式：

```text
{{name}}
{{c.name}}
{{c.level}}
```

### 示例

#### 文本

```json
{
  "kind": "text",
  "text": "{{c.name}}-{{c.level}}"
}
```

#### 条码

```json
{
  "kind": "barcode",
  "data": "{{c.code}}"
}
```

#### 二维码

```json
{
  "kind": "qr",
  "data": "https://example.com/{{c.code}}"
}
```

### 渲染时机

- 设计器预览：渲染
- BLE 打印：渲染
- 工程文件：不渲染
- TSPL 源码面板：不渲染

### 从 TSPL 自动提取变量

当你：

- 打开 TSPL 文件
- 点击“源码重载”
- 或远端接口返回 `tspl.source`

如果源码里有变量占位符，编辑器会自动提取变量列表。

---

## BLE 打印说明

### 要求

- 浏览器支持 Web Bluetooth
- 页面运行在：
  - `https://`
  - 或 `http://localhost`

### 支持项

- 自动连接设备
- 自动发现可写特征
- 控制台打印服务 / 特征枚举日志
- 自定义候选服务 UUID
- 自定义优先特征 UUID
- 分片大小 / 延迟
- 文本编码：
  - UTF-8
  - GBK

### 发送内容

- TSPL 文本命令：按选定编码发送
- 图片 BITMAP：原始二进制发送

> 如果打印机对中文要求较高，通常建议优先尝试 `GBK`

---

## 预览与打印差异说明

浏览器预览字体和打印机字体不可能完全一致，因此：

- 预览是“尽量接近”
- 打印结果以打印机自身字体为准

当前已做：

- 点阵字体预览映射
- `TSS/TST` 系列字体的 ASCII 半宽估算
- 变量渲染后的选中框 / 几何尺寸修正

如果对某些字体要求极高，仍建议做实机校准。

---

## 当前支持的可视化 TSPL 子集

### 纸张 / 结构

- `SIZE`
- `GAP`
- `DIRECTION`
- `REFERENCE`
- `CLS`
- `PRINT`

### 元素

- `TEXT`
- `BARCODE`
- `QRCODE`
- `BAR`
- `BOX`
- `BITMAP`
- `BITMAPHEX ... ENDBITMAPHEX`（编辑器扩展）

### 未直接结构化支持的命令

其它命令会以 **原始 TSPL 块** 保留：

- 不参与画布渲染
- 但会在导出时原样写回

---

## 图片处理说明

TSPL 的 `BITMAP` 命令在标准语义下是：

- 命令头文本
- 后跟原始位图二进制

这不适合直接在文本框里编辑，所以编辑器采用：

- 打开真实 `.tspl` 时：解析 `BITMAP` 二进制为图片元素
- 源码面板里：显示为可读的 `BITMAPHEX`
- 导出 TSPL 时：再转回标准 `BITMAP` 二进制

因此：

- 编辑体验更好
- 导出结果仍然是标准 TSPL

---

## 开发与验证

### 启动静态服务

```bash
python3 -m http.server 8000
```

### 运行测试

```bash
node --test
```

### 当前测试覆盖

- TSPL 生成
- TSPL 解析
- `BITMAP/BITMAPHEX` 往返
- `GBK` 编码
- 变量渲染
- 变量提取
- 工程文件往返
- 字体几何估算

---

## 已知限制

- 目前变量主要作用于：
  - `TEXT`
  - `BARCODE`
  - `QRCODE`
- `raw` 原始 TSPL 块不会自动变量替换
- BLE 打印依赖浏览器的 Web Bluetooth 支持
- 预览字体无法做到与所有打印机字体 100% 完全一致

---

## License

本项目使用 **MIT License**。

你可以在仓库根目录的 [`LICENSE`](./LICENSE) 文件中查看完整协议内容。
