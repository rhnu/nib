# nib

nib 是本地优先、专用于 NovelAI 的桌面创作工作台，将原生图像操作与可组合的 Prompt 资源放在同一创作流程中：用片段保存可复用的提示词，用预设组合内容与设置，工作台自动保留当前创作。

生成内核直接复用 [novelai-bridge](https://github.com/rhnu/novelai-bridge)，应用采用 Rust 模块化单体、Tauri 和 React / TypeScript。

## 当前能力

- 片段 / 预设资源库、实例覆盖与展开、提示词解析、语法高亮、注释和本地词符计数。
- 文生图、图生图、Max Enhance、局部重绘、独立放大、角色定位、精确参考及氛围转移。
- 七项导演工具、PNG 文本检查与写入、图片元信息恢复、任务队列、预览、画廊和结果复用。
- 可选本地图像安全评分、NSFW 模糊、图像标签识别与提示词回填。
- 可选本地词库与语义搜索、多账户、双主题、中英界面和创作数据迁移。
- Danbooru 与 NovelAI Explore 只读探索、标签选择、远程图片导入及生成内容复用。

启动和本地编辑无需 NovelAI 凭据；付费操作由显式提交或重试触发。详细用法见[功能说明](docs/features.md)，真实服务验收的剩余范围见[路线图](docs/roadmap.md)。

## 启动

当前开发与构建目标为 Windows x64，需准备：

- Visual Studio 的 C++ 桌面开发工具、Windows SDK 和 Microsoft Edge WebView2 Runtime，见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。
- Rustup；工具链由 [rust-toolchain.toml](rust-toolchain.toml) 固定。
- Node.js 和 pnpm，版本分别由 [.node-version](.node-version) 与 [package.json](package.json) 的 `packageManager` 声明。

在仓库根目录运行：

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130 --locked
pnpm install --frozen-lockfile
pnpm dev
```

`wasm-bindgen-cli` 须与 Cargo 锁文件中的 wasm-bindgen 同版本。首次启动进入空白工作台；开发服务固定使用 `127.0.0.1:1420`，端口占用时报错。开发数据保存在已忽略的 `.dev/`，与正式环境隔离。

## 开发入口

| 命令                 | 用途                                          |
| -------------------- | --------------------------------------------- |
| `pnpm dev:web`       | 仅启动浏览器前端，缺少桌面宿主时会明确提示。  |
| `pnpm build:web`     | 构建提示词 WASM，检查 TypeScript 并构建前端。 |
| `pnpm build:desktop` | 构建 Windows 可执行程序，暂不生成安装包。     |
| `pnpm check`         | 执行统一检查；额外工具与检查范围见开发说明。  |

## 文档

- [功能说明](docs/features.md)：当前可用功能、操作方式与使用限制。
- [设计说明](docs/design.md)：产品概念、组合语义、交互原则与数据生命周期。
- [开发说明](docs/development.md)：工程职责、实现约束、工具、资源构建与发布。
- [路线图](docs/roadmap.md)：未完成工作、阶段依赖与验收条件。
