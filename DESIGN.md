# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-05-15
- Primary product surfaces: 桌面浏览器中的标签模板编辑、预览、打印配置与 TSPL 源码编辑
- Evidence reviewed: `README.md`, `index.html`, `styles.css`, `app.mjs`

## Brand
- Personality: 工具化、直接、清晰、工业感，优先效率而不是装饰感
- Trust signals: 明确分区、紧凑布局、状态清晰、操作反馈直接、适合长时间高频编辑
- Avoid: 过度圆角、悬浮卡片感、松散留白、偏移动端的玩具化界面

## Product goals
- Goals: 提高信息密度；让三栏编辑区更像生产工具；让画布、图层、属性、打印区同时可读
- Non-goals: 不改交互模型；不引入新依赖；不重做信息架构
- Success signals: 同屏可见内容更多；主要操作更集中；视觉层级更利落

## Personas and jobs
- Primary personas: 标签模板维护人员、门店运营、仓储或零售打印调试人员
- User jobs: 快速编辑模板、检查变量、调试打印机参数、导出或直接打印
- Key contexts of use: 桌面浏览器、横向空间充足、连续操作时间长

## Information architecture
- Primary navigation: 无站点级导航，采用三栏工作台
- Core routes/screens: 顶部全局操作、左侧配置/工具、中心画布、右侧图层/属性/源码
- Content hierarchy: 当前编辑对象与画布优先，其次打印与属性，再次说明性内容

## Design principles
- Principle 1: 像生产工具，不像展示页
- Principle 2: 分隔优先于装饰，信息优先于留白
- Principle 3: 交互控件统一为低半径、扁平、紧凑节奏
- Tradeoffs: 牺牲部分“柔和感”，换取更高的可扫描性与空间效率

## Visual language
- Color: 中性浅灰底 + Windows Metro 风格蓝色强调；减少渐变和彩色阴影
- Typography: 优先 `Segoe UI` 系列；标题克制，正文清晰
- Spacing/layout rhythm: 以 `4/8/12` 为主，压缩顶栏、卡片、表单与列表的内边距
- Shape/radius/elevation: 低半径或直角；几乎无阴影；主要依赖描边和色块分区
- Motion: 仅保留必要的状态过渡，不使用悬浮抬升动画
- Imagery/iconography: 保持文本按钮为主，不额外引入图标系统

## Components
- Existing components to reuse: `.panel`, `.topbar`, `.palette-item`, `.layer-item`, `.property-section`, `.variable-row`
- New/changed components: 不新增结构组件，仅收紧现有组件视觉 token
- Variants and states: 通过边框、底色、左侧强调色和状态文本区分 active/selected/warning
- Token/component ownership: 统一由 `styles.css` 根变量控制

## Accessibility
- Target standard: 基础桌面可用性与清晰焦点反馈
- Keyboard/focus behavior: 不改现有键盘操作；保留明显焦点边框
- Contrast/readability: 文本与边框对比提高；浅灰面与白色输入框分离
- Screen-reader semantics: 维持现有原生 `details/summary/label` 语义
- Reduced motion and sensory considerations: 减少位移动画，避免强烈视觉干扰

## Responsive behavior
- Supported breakpoints/devices: 桌面优先，保留 `1180px` 与 `720px` 断点
- Layout adaptations: 大屏三栏紧凑；中小屏回落为单栏堆叠
- Touch/hover differences: hover 仅做轻量底色变化，不依赖位移

## Interaction states
- Loading: 状态栏文本反馈
- Empty: 保留空态说明，但用更硬朗边界
- Error: 红色文本与边框提示
- Success: 绿色状态文本
- Disabled: 通过透明度弱化，但维持可读性
- Offline/slow network, if applicable: 继续依赖状态栏文案说明

## Content voice
- Tone: 直接、专业、少修饰
- Terminology: 保持 TSPL、打印机、图层、变量等现有术语
- Microcopy rules: 优先短词，避免营销式语气

## Implementation constraints
- Framework/styling system: 原生 HTML + CSS + ES module，无组件框架
- Design-token constraints: 尽量复用已有 CSS 变量名，减少 JS 或 DOM 结构调整
- Performance constraints: 不引入新依赖或重型视觉效果
- Compatibility constraints: 不破坏 BLE/WebUSB 相关面板与表单绑定
- Test/screenshot expectations: 至少完成语法级与静态资源级验证；视觉变化以布局和 token 改动为主

## Open questions
- [ ] 是否需要继续把右侧“图层/属性/源码”做成更强的信息优先级切换，而不是同时展开
- [ ] 是否要为高分辨率宽屏增加第四列或可折叠源码模式
