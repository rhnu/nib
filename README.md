# nib

nib 是本地优先、专用于 NovelAI 的桌面创作工作台。原生图像操作与可组合的 Prompt 资源系统共同构成产品核心：用 Chunk 积累提示词片段，用 Preset 组合创作配方，用草稿承载当前创作。

生成内核直接复用 [novelai-bridge](https://github.com/RhNu/novelai-bridge)，应用采用 Rust 模块化单体、Tauri 和 React / TypeScript。

## 当前能力

已实现资源与草稿的本地工作台：创建和查找纯文本 Chunk，以 Preset 组合基础提示、负面提示及显式默认设置，在草稿中使用资源引用、实例覆盖和独立展开内容。解析面板显示实际文本、来源、设置覆盖与缺失依赖；资源和草稿通过真实 IPC 保存到 SQLite。

界面采用紧凑的黑白双主题和青绿主题色，资源库按需打开，主工作区用于组合编辑与解析。图像编辑、账户、生成任务和结果保存尚未实现。启动应用不需要 NovelAI 凭据，也不会发起生成请求。[设计说明](docs/design.md)中的完整产品目标不代表当前功能均已可用。

## 启动

当前开发与构建目标为 Windows x64。准备以下环境：

- Visual Studio 的 C++ 桌面开发工具及 Windows SDK。
- Microsoft Edge WebView2 Runtime。
- Rustup；仓库固定 Rust 1.99.0，包含 rustfmt 和 Clippy。
- Node.js 24.21.0、pnpm 12.14.0，分别由 `.node-version` 和 `packageManager` 声明。

平台依赖安装见 [Tauri 官方前置条件](https://v2.tauri.app/start/prerequisites/)。在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

预期出现带原生标题栏的 nib 工作台，首次打开时创建空白草稿。开发服务固定使用 `127.0.0.1:1420`；端口占用时会报错，不会静默切换端口。

仅查看浏览器前端可运行 `pnpm dev:web`。浏览器模式会明确提示缺少桌面宿主，不能用于确认 IPC 已连通。

## 本地创作

在“资源库”中新建 Chunk，填写名称和文本并保存；新建 Preset 时，可以为两个提示词作用域分别组合文本和 Chunk，只填写配方负责的默认设置。资源名称允许重复，引用使用稳定身份。

在草稿中添加文本、Chunk 或 Preset，可以启用、停用和调整顺序。编辑引用内容只建立当前实例的覆盖；撤销覆盖后继续使用原资源。展开 Chunk 会得到独立文本；展开 Preset 会保留当前内容、启用状态和它声明的默认设置，解除资源引用。解析按配方顺序组合内容，再追加草稿的直接片段，片段间以换行分隔，保留原有提示词语法。

草稿自动保存，也可以手动保存；切换草稿和关闭窗口前会等待保存，失败时保留编辑并提示重试。资源编辑需要单独保存，未保存时离开会要求处理修改。结构化数据位于桌面应用数据目录的 `nib.sqlite3`，重新打开工作台会加载最近保存的草稿。删除资源会保留已有引用并显示缺失问题。

## 开发入口

```sh
pnpm build:web
pnpm build:desktop
```

桌面构建生成 Windows 可执行程序，不生成安装包或更新包。完整检查使用 `pnpm check`，还需本机具备 Rusteward 的 `cargo-dev` 和 rumdl；安装、类型生成及命令职责见[开发说明](docs/development.md)。

## 文档

- [设计说明](docs/design.md)：产品概念、创作流程、资源组合和数据生命周期。
- [开发说明](docs/development.md)：工程边界、扩展原则、工具与验证入口。
- [路线图](docs/roadmap.md)：后续阶段目标、依赖与验收条件。
