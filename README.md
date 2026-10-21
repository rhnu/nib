# nib

nib 是本地优先、专用于 NovelAI 的桌面创作工作台。原生图像操作与可组合的 Prompt 资源系统共同构成产品核心：用 Chunk 积累提示词片段，用 Preset 组合创作配方，用草稿承载当前创作。

生成内核直接复用 [novelai-bridge](https://github.com/RhNu/novelai-bridge)，应用采用 Rust 模块化单体、Tauri 和 React / TypeScript。

## 当前能力

当前是可运行的工程骨架。桌面启动页通过真实 IPC 显示应用版本和 bridge 提供的默认模型 ID，支持加载、失败重试和独立浏览器模式提示。工作区包含核心模块入口、Rust 到 TypeScript 的类型生成、开发检查与 Windows CI 配置。

Chunk / Preset 编辑、SQLite 保存、图像编辑、账户、生成任务和结果保存尚未实现。启动应用不需要 NovelAI 凭据，也不会发起生成请求。[设计说明](docs/design.md)描述的是产品目标，不代表这些功能已经可用。

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

预期出现带原生标题栏的 nib 窗口，启动页读取 Rust 返回的信息。开发服务固定使用 `127.0.0.1:1420`；端口占用时会报错，不会静默切换端口。

仅查看浏览器前端可运行 `pnpm dev:web`。浏览器模式会明确提示缺少桌面宿主，不能用于确认 IPC 已连通。

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
