# nib 开发说明

产品概念与目标行为见[设计说明](design.md)，当前可用能力及最短启动方式见 [README](../README.md)。本说明记录工程入口和需要跨模块保持的约束。

## 工程边界

Cargo workspace 包含三个包：`nib-app` 是不依赖 Tauri 的应用库；`nib-desktop` 是桌面宿主；`xtask` 负责开发工具。React 前端与宿主位于同一桌面应用目录，pnpm workspace 管理前端依赖。

依赖方向为桌面宿主 → 应用库 → bridge；xtask 仅依赖应用库的类型生成能力，不依赖桌面宿主。应用库的 `api` 模块是当前桌面通信边界，业务内部不逐层重建等价 DTO。

应用库按以下职责预留模块入口；当前这些业务模块只有职责说明，并未实现业务能力：

| 模块       | 拥有的职责                                         |
| ---------- | -------------------------------------------------- |
| `prompt`   | Chunk / Preset、实例、作用域、组合解析与来源解释。 |
| `library`  | 资源组织、查找、关系、导入导出与复用入口。         |
| `session`  | 当前创作、参考输入、Prompt 与图像编辑状态。        |
| `jobs`     | 提交、调度、批次和任务状态，直接使用 bridge 执行。 |
| `media`    | 媒体读写、最终结果、来源关系和结果复用。           |
| `settings` | 账户选择、应用偏好及配置语义。                     |

查询契约由相应领域拥有。资源搜索、结果查询、词库补全和远程作品发现不统一成“关键字输入、任意 JSON 输出”。同类多来源查询在所属模块中组合，保留来源标识及专有信息；可查询不意味着可写入。

模块默认是源码组织单位，不机械拆为 crate。只有真实的编译依赖、复用或发布需求才增加包边界。Rust 源码使用同名文件和子目录，避免 `mod.rs`；纯逻辑单元测试放在被测模块的独立 `tests.rs` 中。

## 语义、抽象与装配

### bridge 的职责

NAI 模型与参数、校验和归一化、请求准备、图像输入处理、Token、费用、协议执行及流式协议语义属于 `novelai-bridge`。通用 NAI 能力缺口优先在 bridge 中解决。

nib 直接使用 SDK 的公开类型和方法，不创建同义的 Model、Request、Result、Validation 或 Client 包装体系。可以将 SDK 对象与任务标识、资源来源、显示信息组合；不复制其内部规则。应用调度与 SDK 请求生命周期分别承担责任。

当前依赖 crates.io 稳定版 `0.6.0`，关闭默认 features，只使用模型描述。接入真实操作时在根依赖声明中按需要开启功能；不提前引入 HTTP、流式传输或 tokenizer 资源。锁文件决定具体解析版本，成员通过 workspace 继承依赖。

### 可替换能力

明确数据使用 struct / enum，纯转换使用普通函数。需要替换的能力由使用它的模块定义小 Trait，数据库、文件或远程后端分别实现。编译期组合使用局部泛型，运行期选择或异构实现按需要使用 trait object，不让后端类型参数贯穿整个应用。

一个后端可以实现多个小 Trait，多个实现可以共享连接或客户端；不能因为共用数据库连接而合并全部业务职责。资源查询与编辑等不同能力应保持区别。

宿主集中选择后端、创建共享依赖并管理生命周期，业务实现分散在所属模块。应用内核是资源、会话与任务之间的协作机制，不是第二套生成内核或包含所有行为的 Runtime。业务模块不通过全局服务定位器查找任意依赖。

跨模块协同动作可设置用例入口，单纯读取无需统一的 Service / Facade 转发链；查询无需绕行 Jobs，媒体读取无需先构造完整创作工作区。

### 持久化与边界表示

SQLite 是结构化存储的默认后端方向；媒体字节通过媒体能力访问文件或 Blob。资源、草稿、结果和配置的契约由各自模块拥有，具体表结构、迁移和文件布局随首个真实实现确定。当前启动不创建数据库、媒体目录或凭据记录。

账户选择属于应用配置，秘密凭据的读取与宿主后端装配在接入账户时落实；凭据不通过前端构建环境变量注入，也不写入日志或结果记录。

桌面 IPC、交互草稿和长期文件格式可以各有必要表示。仅在这些真实边界进行转换，不把 SDK 对象图原样当作前端或永久文件格式；也不因此在应用内部另造一层 SDK 隔离体系。

## 当前启动契约

桌面仅注册 `get_app_info`，无参数，返回 `AppInfo`。应用名和版本来自应用信息，默认模型 ID 直接读取 bridge 的默认模型，不在 nib 中维护默认模型常量或模型列表。

Rust 边界类型通过 serde 定义 JSON 命名，通过可选 `typegen` feature 派生 ts-rs 类型。前端引用已生成的声明，不手写平行类型；业务模块不依赖生成文件。

```sh
pnpm types
pnpm types:check
```

第一条命令更新生成文件；第二条在内存中重新生成并比较，文件缺失或内容漂移时失败，不写源码。生成文件随代码提交，修改边界类型后必须重新生成。类型生成不在单元测试或 Tauri 构建中暗中运行，Oxfmt 不改写生成产物。

启动页只有加载、成功、失败和缺少桌面宿主的状态。调用失败可重试，卸载或过期调用不会覆盖当前状态。独立浏览器模式不模拟 Rust 响应。

Tauri 使用原生窗口装饰、仅服务主窗口的最小权限及 CSP。宿主统一初始化 tracing；应用库只产生事件，不安装全局 subscriber。日志保留必要上下文与错误原因链，不记录凭据、完整请求或媒体内容。详细执行通知与永久结果记录的分离见[数据生命周期](design.md#数据生命周期)。

## 工具与检查

Rust、Node 与 pnpm 版本由仓库配置固定，Cargo 与 pnpm 锁文件纳入版本管理。安装依赖使用 `pnpm install --frozen-lockfile`，Cargo 检查使用 `--locked`；不要通过删除锁文件绕过依赖问题。

检查工具需安装 Rusteward 和 rumdl。项目不覆盖 Cargo 的 `dev` 子命令：

```sh
cargo install --git https://github.com/rhnu/rusteward.git --locked rusteward
cargo-dev --version
```

Windows 可通过 `winget install --id rvben.rumdl --exact` 安装 rumdl，再运行 `rumdl --version` 确认。CI 使用官方 Action 安装工具；rumdl 配置由仓库统一维护。参考 [Rusteward](https://github.com/rhnu/rusteward) 与 [rumdl](https://rumdl.dev/)。

| 命令                 | 用途                                               |
| -------------------- | -------------------------------------------------- |
| `pnpm dev`           | 启动桌面应用与 Vite 开发服务。                     |
| `pnpm dev:web`       | 仅启动前端，显示浏览器模式提示。                   |
| `pnpm build:web`     | TypeScript 检查和前端生产构建。                    |
| `pnpm build:desktop` | 构建 Windows 可执行程序，不生成安装包。            |
| `pnpm types`         | 更新 TypeScript 通信类型。                         |
| `pnpm types:check`   | 只读检查生成类型是否一致。                         |
| `pnpm fmt`           | 写入 Rust、前端与 Markdown 格式修复。              |
| `pnpm fmt:check`     | 只读检查格式与 Markdown 规则。                     |
| `pnpm lint`          | Rusteward / Clippy 与 Oxlint 检查。                |
| `pnpm test`          | Rust 单元测试目标和 Vitest 的 Node 测试入口。      |
| `pnpm check`         | 编译、格式、lint、单元测试、类型一致性与前端构建。 |

Rusteward 负责 Rust 格式与 Clippy，Oxfmt 负责前端和工程配置格式，rumdl 独立负责 Markdown。修改文档后在收尾时运行 `pnpm docs:fix <本次修改的文件...>`；例如 `pnpm docs:fix README.md docs/roadmap.md`。

Rust 检查顺序为编译 → 格式 → lint → 单元测试。默认只添加纯逻辑单元测试，不为占位模块、常量或源码布局编写测试，不默认引入集成、UI、E2E、性能或快照测试。当前前端没有纯逻辑测试，Vitest 会明确报告没有测试文件；这不代表完成了交互验证。

Windows CI 使用同一检查入口及锁文件，再构建不带安装包的桌面程序。CI 不发布产物、不签名、不配置自动更新。工作流文件的存在不代表远程 runner 已运行；本地构建、人工启动观察和远程 CI 的结果在交付中分别报告。

## 后续实施

阶段目标、依赖和验收条件统一维护在[路线图](roadmap.md)。具体存储 Trait、迁移、媒体布局和操作接口随对应功能的真实实现收敛；产品取舍继续以[设计说明](design.md)为准。
