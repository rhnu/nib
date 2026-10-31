# nib 开发说明

本文记录工程入口、模块职责与需要跨模块保持的实现约束。产品语义见[设计说明](design.md)，当前用法见[功能说明](features.md)，首次启动见 [README](../README.md)，未完成工作见[路线图](roadmap.md)。

## 工程边界

| 包              | 职责                                                            |
| --------------- | --------------------------------------------------------------- |
| `nib-app`       | 不依赖 Tauri 的应用库，组合业务、SDK 和资源后端，管理生命周期。 |
| `nib-contract`  | 按领域组织的轻量共享契约。                                      |
| `nib-prompt`    | 原生与 WASM 共用的提示词源处理及插入格式化。                    |
| `nib-resources` | 下载目录、组件依赖、校验、安装和资源代次。                      |
| `nib-lexicon`   | 原生词库检索、语义查询和资源打包。                              |
| `nib-desktop`   | 桌面宿主，负责平台适配、IPC 和 I/O 装配。                       |
| `xtask`         | 类型生成、提示词 WASM 构建与资源校验发布工具。                  |

React 前端与宿主位于 `apps/desktop/`，由 pnpm 和 Cargo workspace 分别管理。Rust 成员依赖统一从 workspace 继承，锁文件纳入版本管理。

宿主在 nib 业务包中只直接依赖 `nib-app` 并启用 `native`；app 组合 SDK、词库和资源后端。词库和资源后端依赖 `nib-contract`，不依赖 app。词库契约位于 `nib-contract::lexicon`，下载状态位于 `nib-contract::downloads`，app 按领域重导出。具体资源后端错误归 `nib-resources`，安装任务和对宿主的分类错误归 app。

`nib-prompt` 只直接使用 SDK 的独立 `novelai-bridge-prompt` 语法库，不引入网络、图像或 Tokenizer。下载依赖留在 `nib-resources`，ONNX、语义 Tokenizer 与向量索引留在 `nib-lexicon`。app 的 `native` 默认关闭；xtask 仅启用 `typegen`，类型生成与提示词 WASM 不引入原生推理后端。

应用库按领域拥有类型、查询与实现：

| 领域        | 职责                                             |
| ----------- | ------------------------------------------------ |
| `prompt`    | 片段 / 预设、实例、作用域、组合解析和来源。      |
| `library`   | 资源目录、元数据、分页筛选、批量操作及依赖读取。 |
| `session`   | 当前创作、图像与参考输入、可恢复编辑状态。       |
| `jobs`      | 付费操作的提交、调度、批次和任务状态。           |
| `media`     | 媒体读写、最终结果、来源和结果复用。             |
| `settings`  | 账户、应用偏好与数据位置语义。                   |
| `lexicon`   | 词库查询契约、分类、结果与可用状态。             |
| `downloads` | 通用资源通信类型和应用持有的安装任务。           |

查询保留所属领域和来源，不统一成任意 JSON 接口；可查询不表示可写入。模块默认是源码组织单位，只有真实编译依赖或复用需求才增加 crate。Rust 使用同名文件与子目录，避免 `mod.rs`，纯逻辑单元测试放在被测模块的独立 `tests.rs`。

## SDK 与依赖装配

NAI 模型、语法、参数合法性与归一化、请求准备、图像处理、词符、费用、协议及流式语义归 `novelai-bridge`；通用缺口优先在 SDK 解决。nib 直接使用公开类型和方法，不另建同义的 Model、Request、Result、Validation 或 Client 包装体系。应用身份、资源来源及生命周期归各领域。

SDK 来自 crates.io，关闭默认 features，显式开启 `reqwest-transport` 与 `bundled-assets`，具体版本由 Cargo 配置和锁文件确定。模型、默认值和编辑范围投影 SDK 描述符，不在前端或 app 维护模型列表。生成、导演工具、放大和编码使用各自操作分支，共用队列不要求共享无关字段；已接入用法见[功能说明](features.md)。

可替换能力由使用它的领域定义小 Trait，数据库、文件或远程后端实现；纯转换使用函数，明确数据使用 struct / enum。局部使用泛型或 trait object，不让后端类型参数贯穿应用。共用连接或客户端不改变领域职责，简单读取无需统一的 Service / Facade 转发。

宿主向 `nib_app::bootstrap::Bootstrap` 注入运行时、系统凭据、HTTP 传输和目录 I/O。app 的 bootstrap 组合业务及资源 consumer 并启动账户采样，`AppState` 管理数据库、媒体和队列的按需初始化与共享。`StorageBackend` 归 settings，`TransportFactory` 归 SDK 使用方；宿主实现目录锁、复制、校验、路径发布及传输创建。桌面 state 只保留 app 状态与窗口订阅，app 不持有窗口或 IPC Channel，不安装全局运行时或 tracing subscriber，也不通过服务定位器查找任意依赖。

SDK 客户端及 bundled Tokenizer 由 app 的 `sdk` 模块共享，本地计数和账户读取不初始化生成队列。客户端按不可变凭据版本与执行配置使用；全局基址映射到 `ClientConfig.image_base_url`。传输响应预算、Multipart 和服务端图像缓存直接使用 SDK 能力。

账户服务合并启动、凭据或端点变化、请求终态及过期采样，身份包含凭据版本和端点，以代次拒绝旧回包。失败只保留同身份上次成功值，通信不透传原始账户响应。前端共用账户查询服务，以采样修订使估费失效；费用观察仅保留 SDK 估算和请求终态，未知费用为空，几何与计价尺寸读取 SDK 结果。

## 持久化与边界表示

### 数据与身份

SQLite 使用 rusqlite bundled 后端，全局配置与创作数据分库。目录布局和用户迁移方式见[数据位置与备份](features.md#数据位置与备份)。宿主打开配置库并注入 app，app 按需打开创作库；没有当前创作记录时返回空白状态。结构以 `user_version` 标识，事务初始化，开发阶段版本不匹配明确报错，不兼容旧结构或回退为空库。

资源身份与目录身份使用规范 UUID。目录、别名、标签与模型范围使用明确列和关系表，组合内容使用必要 JSON；批量操作在同一事务检查修订与目录关系。封面由媒体领域复制、写入和清理，保留仍被其他创作数据引用的内容。

资源读取、编辑、搜索与当前创作存储使用领域小契约，SQL 放在所属模块；`persistence` 仅维护创作库连接、结构初始化及共享错误。身份、名称和修订号各有单一存储来源，组合内容使用必要 JSON。修订号零表示未保存，写入检查旧修订并返回新修订，防止旧内容覆盖新内容。

解析和展开在同一资源读取事务完成。缺失、类型错误及失效覆盖返回带实例位置的诊断；存储失败保留错误分类。展开要求取得启用和停用内容的依赖，防止以后启用时丢失内容。

角色与参考的解析身份由实例身份和原始条目身份组成，直接输出使用独立命名空间；前后端编码为 JSON 二元组，不能按分隔符拆解，也不能当作原件身份。诊断与编辑定位回到所属实例和原始条目。角色编辑坐标不被规范化反向改写，恢复使用冻结时实际生效的位置与定位方式。

### 数据访问与迁移

宿主持有配置和数据目录独占文件锁。迁移前由前端等待材料提交、保存当前创作与偏好，未保存资源阻止迁移；app 阻止写入和领取新任务，等已发请求连同结果保存后，取得数据访问独占保护并执行 SQLite checkpoint。宿主同步复制、逐字节比对并执行只读数据库完整性检查，成功后原子发布新路径。

成功后当前进程继续只读展示原目录数据，重启打开新目录；失败恢复原目录写入与调度。复制标记支持同源重试，源数据保留。目标不能是已有库、与配置重叠或与源目录相互包含。数据库、媒体和缩略图写入均受数据访问保护；保护须移入阻塞任务，不能因等待 IPC 的 future 取消而提前释放。

开发环境以 Tauri 开发模式判断，默认根目录由编译期宿主位置定位到仓库 `.dev/`，不依赖工作目录。`NIB_DEVELOPMENT_HOME` 可指定绝对目录，分别使用其 `config/`、`data/` 与 `resources/`；相对路径被拒绝，正式构建忽略此变量。隔离检查使用新空目录，不覆盖已有 `.dev/`。开发与正式凭据使用不同服务名，空配置不读取其他配置的密钥。

### 凭据

`settings` 定义按不可变版本读取秘密的小契约，Windows 宿主串行访问系统凭据后端。配置库只保存账户元数据和版本关系，更换 Key 新建版本，旧版本继续供冻结任务读取。删除账户在阻止新提交的保护内检查全部版本的未完成任务，删除活动账户不自动选择其他账户。

前端只接收元数据和状态，秘密输入只用于当次 IPC，不进入持久状态、SQLite、日志或结果。原凭据缺失显式失败，系统凭据错误中的秘密不得跨宿主边界。

## 任务、媒体与反馈

生成提交在一致资源读取中解析，每个请求由 SDK 准备种子，同批任务一次持久化后唤醒唯一顺序执行器。应用请求次数不写入 NAI 单请求字段。任务冻结有效参数、凭据版本、执行配置及媒体身份；只保留一份 SDK 参数与必要来源，不重复嵌入媒体字节，准备对象和协议载荷保持瞬时。

重试建立关联新任务，复用原冻结输入和身份，不改写原终态。输入媒体损坏只使对应任务失败；无法保存状态或结果的存储失败停止队列。重启把未完成任务标为中断，不自动发请求。

媒体先完整写入并同步，再提交记录。最终结果、资产与任务完成状态在同一事务提交，尊重已经发生的取消；中断可留下不可见的未引用文件，不产生指向未完成写入的可用结果。查询检查存在性和长度，缺失或截断内容不可打开或恢复。缩略图可重建，媒体读取无需初始化执行器；IPC 按资产身份返回二进制，不开放任意路径读取。

结果恢复包含输入材料和已知实际样本种子，独立于资源定义；图片元信息仅投影 SDK 已知字段，嵌入编码另行导入，不复制到元信息表。氛围转移交换文档完整保留，选择原图或编码时另建资产，保留模型与参数缓存身份。

流式通知采用有界瞬时通道，以窗口和订阅身份管理生命周期，旧清理不能终止新订阅。落后时刷新持久任务状态，中间帧按任务和样本维护有界内存，不落库，不驱动整个工作台重渲染。完整终态后才保存最终输出，最终媒体解码后释放对应帧，终态拒绝迟到事件。SDK 请求终态与本地保存状态分别记录。

原图参考行的 `ensure_vibe_encoding` 查找已有材料或未完成任务，必要时才新提交；完成后只更新仍保持相同输入的行。编码归材料查询，不进入图片历史，行移除不删除完成材料。

## 桌面通信与编辑状态

### IPC 与错误

宿主提供工作台、资源、解析、模型、媒体、账户、估费、任务、结果和订阅命令，负责平台 I/O、阻塞存储调度及 IPC 错误映射。app 负责内部后台任务，领域逻辑不依赖 Tauri。应用信息来自统一入口，默认模型直接读取 SDK。

通信类型由领域拥有，`api` 提供工作台响应、模型能力投影与 IPC 错误，不逐层重建等价 DTO。Rust 用 serde 定义 JSON 命名，通过可选 `typegen` feature 派生 ts-rs 类型；前端使用生成声明，业务模块不依赖生成文件。真实边界可有必要表示转换，不直接把 SDK 对象图作为永久文件或前端格式。

```sh
pnpm types
pnpm types:check
```

前者更新并提交生成类型，后者只在内存生成并比较，缺失或漂移时失败。类型生成不在单元测试或 Tauri 构建中暗中运行，Oxfmt 不改写生成产物。新增命令须同时更新 handler、构建命令清单及主窗口 capability，注册不会自动授权。

加载状态区分打开中、失败与缺少宿主；浏览器模式不模拟 Rust 响应。SDK 字段位置以类型化数据传递，不从错误文案推断。领域公共错误保留分类及 source，启动或不再分类的内部边界可用 anyhow；IPC 投影为 `ApiError`，保留无效输入、缺失、冲突与不可用的区别。

宿主初始化 tracing，最终失败由处理它的 IPC 或后台任务管理者记录，不逐层重复输出。日志包含操作上下文及原因链，不记录秘密、完整请求或媒体。桌面关闭系统装饰，前端提供标题栏；主窗口权限遵循最小授权与 CSP。

前端入口在挂载前取消默认 `contextmenu` 行为，领域菜单复用 Base UI Context Menu；文本菜单通过编辑器适配器优先处理内部输入。Windows 普通输入的编辑命令由宿主通过 WebView2 的固定按键操作执行，保留原生选区与历史。其 COM 调用限定在 WebView UI 线程的两处带安全说明的 COM `unsafe` 调用，其余 Rust 代码默认拒绝 `unsafe`。图片复制通过 Clipboard API 写入 PNG 内容，权限或编码失败由所属动作展示。

### 状态归属与保存

前端 `app` 负责启动、主题、路由及窗口生命周期，`pages` 组合页面，各 `features/<领域>` 提供业务能力，`shared` 提供宿主边界、Query 客户端和共用 UI。工作台控制器协调跨领域操作，图像输入按操作、源图和参数组织。Base UI 处理焦点及键盘交互，Tailwind 与设计变量负责样式，共享组件仅作必要薄封装。

只读查询统一使用 TanStack Query，领域拥有查询键与失效范围；当前创作与偏好由 Zustand store 独占编辑状态，复杂更新使用 Immer。启动查询只初始化一次，重新读取不覆盖已加载偏好或未保存编辑。付费提交和重试不自动重放。生成与导演入口的工作状态由页面外的提交协调器结合持久任务状态推导，提交互斥按入口生效；预览帧不控制解锁。应用内短消息统一使用 Base UI Toast，消息保留延迟翻译语义。宿主独立观察不含媒体的任务状态信号，在后台按批次发送系统通知，应用库不依赖通知插件。

前端防抖请求解析并丢弃旧解析与估费响应，统计和费用的展示值可在兼容上下文中保留，提交仅使用精确匹配的报价；加载指示短暂延迟显示，主表单能力、解析及估费共享一次资源读取，估费失败独立返回并保留解析和能力；独立工具仍使用各自估费入口。保存协调器串行写入，回执只合并修订号，不用旧快照覆盖保存期间的修改；结果恢复沿用当前修订。资源搜索读取摘要，定义按创作和资源编辑依赖批量加载；变更定向失效相关查询、解析及估费，缓存不另建可编辑事实。

TanStack Router 使用 Hash history，运行时位置归路由，`Draft.activePage` 只用于启动恢复及导航后的持久快照。普通导航与前进后退等待材料提交并处理未应用遮罩；已通过保护的领域动作直接跳转。当前创作、资源编辑、选择和保存协调器位于页面之外，路由卸载不清空状态；关闭与迁移直接读取资源会话的 dirty / busy。

`MaskEditorState` 按源图保存原生像素笔画、历史游标、应用版本和视图；编码输入、导演工具、PNG 文本编辑分别保留。这些状态不进入 `ResolvedDraft` 或主生成依赖键，不因笔画、视图或独立工具编辑重新解析主提示词与估费。工具临时构造适用操作并单独估费；恢复合并最新编辑，遮罩先保存 PNG 再更新媒体身份。

材料异步操作的等待范围包括媒体读取、派生、引用创建及编辑提交，不能在 IPC 返回后提前解除。切页、恢复和关闭先等待提交；完整恢复或操作切换后不应用旧回包。HTML 拖放须关闭 Tauri 原生拖放拦截，导入只读取用户所选文件。

关闭按钮与系统关闭共用保护：处理未保存原件和未应用遮罩，再等待所有材料、创作与偏好写入，包括等待期间新增工作。成功后才销毁窗口，失败保留窗口及编辑。偏好从 Rust 同步并顺序写回，前端无持久副本。

页面、画布和操作面板使用 ErrorBoundary，长期编辑及保存协调器在恢复边界外；业务、保存及异步错误由所属操作展示，重试显示不重放付费操作。媒体 Blob URL 按不可变身份与原图 / 缩略图用途共享，最后一个使用者离开后释放，Query 不另存媒体字节。任务和结果列表读取分页摘要，详情、恢复或重试才取完整冻结输入，活动任务不受历史分页限制。

### 源码约定

手写前端源码使用 kebab-case，包括组件、Hook、测试和 CSS；生成绑定与上游字体保留原名。Oxlint 的 `unicorn/filename-case` 检查 TS/TSX。`@/` 在 TypeScript 与 Vite 中指向 `apps/desktop/src/`，Vitest 复用 Vite 配置。同模块可相对导入，跨模块的导入、重导出和样式引用使用 `@/`；`features/generation` 的子目录属同一模块。

`pnpm lint:web` 在根目录运行，以 `eslint-plugin-boundaries` 的 `boundaries/dependencies` 和 TypeScript resolver 识别模块。`app`、`pages`、各 `features/*`、各 `shared/*`、`bindings`、`assets` 及根入口分别归属，不按子目录深度增加边界。规则覆盖可解析的静态和类型导入、重导出、字符串动态导入及 TS/TSX 样式导入；CSS 内 `@import` 与 `url()` 按约定维护。

## 提示词与词库编辑

共享 CodeMirror 组件分别维护视图、配置重配、分析调度、语义装饰和诊断；模型切换及外部同步保留选择和撤销历史，IME 期间延迟替换。`get_prompt_syntax` 投影 SDK 描述符，无模型时使用纯文本能力，不按模型 ID 推断版本。Worker 惰性加载 WASM，每个编辑器只保留最新待分析输入，旧响应丢弃，滚动只重建可见装饰。

片段容器拥有标题栏、启停与折叠交互；生成页由草稿的 `promptEditor` 独立保存片段折叠状态，键以 JSON 数组组合预设实例、角色、正负作用域及节点身份。未记录状态时片段引用默认折叠、文本片段默认展开；资源原件编辑器只保存组件局部展示状态。折叠编辑通过当前创作写入协调器保存，生成输入投影排除该展示状态，不触发重新解析或估费，也不形成资源实例内容覆盖。

编辑器组合视图 Hook、分析计数 Hook、词库插入 Hook 和诊断展示。折叠隐藏 CodeMirror 宿主并显示同一原文的单行预览，不重建编辑状态；展开请求重新测量，诊断定位共用展开与聚焦逻辑。编辑器统一拥有最小高度与增长方式，片段和紧凑样式不再分别覆盖高度；只读查看仍可限制高度并滚动。

`nib-prompt` 的 `editable` 语境处理 nib 注释及原文映射，`native` 只分析已有 NAI 文本。后端逐来源处理注释，原生词法状态跨片段延续，再分析完整作用域。UTF-16 范围、原生诊断与 nib 源诊断由 Rust 生成，前端只适配显示。源错误允许保存但阻止执行及成功计数，词符消费同一处理结果并按实际模型查询。恢复以 `native_to_source` 保护字面内容，冻结请求与重试不重新编译。

词库补全由视图插件防抖调度查询，结果就绪后交给 CodeMirror 展示。Rust 从 SDK 词符和 source map 得出可替换范围，前端不解析语法；词法查询等待输入停顿 200ms，可选语义查询等待 350ms，分析耗时计入停顿时间。同一标签内继续输入时，仅为展示映射旧候选范围，等待期间保留列表但禁止过期插入；离开标签、切换上下文或资源代次时关闭。文本或光标变化增加修订，即使值恢复相同也拒绝旧结果；插入前核对模型 profile、资源 generation、只读与 IME 状态。选中补全词后以单次事务插入词汇及 `, `，复用已有逗号和水平空白，光标位于分隔符之后。

补全和选词共用 WASM formatter，依据 SDK 词符保护结构字符、依据 profile 生成权重，最后用 `native_to_source` 保护注释标记；单次插入使用单一历史事务，失败保留原文。完整词库页持有独立会话，快捷弹窗使用局部会话，共用检索和组合；数字权重与括号强调分别保存。资源代次改变清除旧快照及关联查询，追加组合先完成异步格式化与创作提交，再导航，避免保护等待自身。

`pnpm prompt:wasm` 通过 xtask 编译并调用 wasm-bindgen，生成 JS、声明与 WASM 位于已忽略的 `src/bindings/prompt-wasm/`，不手改或提交。开发启动与生产构建会重建；修改共享 Rust 解析后须重启开发服务，使原生宿主和 Worker 同步加载。结构化类型仍由 `pnpm types` 生成并提交。WASM 和 Worker 只同源加载，CSP 开放 `wasm-unsafe-eval`，不开放通用脚本求值。

## 本地化

前端使用 i18next / react-i18next，双语目录位于 `shared/i18n/locales/en` 和 `zh-cn`，随应用打包。英语提供键与插值类型，简体中文通过 `satisfies` 保持相同键结构；数量使用 `count` 及复数形式，富文本整句用 `Trans`。界面文字、tooltip、可访问名称和应用自定义原生对话框均使用目录，用户内容及外部诊断保留原值。

语言偏好归 `settings::ApplicationPreferences`，取值 `system`、`en`、`zh-CN`，复用 `PreferencesWriter` 与配置库。设置加载前按系统语言初始化，之后采用已保存值；`useLanguage` 同步 i18next 和文档 `lang`，响应系统语言变化。日期与数字经共享格式函数显示。

组件用 `useTranslation` 订阅变化，普通显示函数按调用时语言使用共享 `t`。模块级映射保存键或 getter，不能固定翻译；缓存和编辑状态保留业务值与原始错误。`useMessageState`、`deferMessage` 及 `MessageError` 延迟解释本地消息并保留错误语义，切换语言不清空状态。

`api::UserMessage` 以语义变体携带字段、身份与参数，是 IPC 和持久记录的消息契约；`ApiError` 分类与定位独立保留。SDK 和平台详情用 `external` 原文传递，不匹配文案推断类别。新增消息同时更新前端解释、双语目录及生成类型，继续遵守凭据脱敏边界。

## 工具与检查

Rust、Node 和 pnpm 版本由仓库配置固定，Cargo 和 pnpm 使用锁文件；安装用 `pnpm install --frozen-lockfile`，Cargo 检查用 `--locked`，不要删除锁文件绕过问题。统一检查还需 Python 3.12–3.14，资源工具单元只依赖标准库；完整词库构建通过 `uv sync --project tools/lexicon --locked` 安装 [pyproject.toml](../tools/lexicon/pyproject.toml) 与 `uv.lock` 中的依赖。桌面运行不需要 Python。

安装检查工具：

```sh
cargo install --git https://github.com/rhnu/rusteward.git --locked rusteward
cargo-dev --version
winget install --id rvben.rumdl --exact
rumdl --version
```

项目不覆盖 Cargo 的 `dev` 子命令。工具说明见 [Rusteward](https://github.com/rhnu/rusteward) 和 [rumdl](https://rumdl.dev/)。

| 命令                                          | 用途                                           |
| --------------------------------------------- | ---------------------------------------------- |
| `pnpm dev`                                    | 启动桌面应用与 Vite 服务。                     |
| `pnpm dev:web`                                | 仅启动前端，缺少宿主时显示提示。               |
| `pnpm build:web`                              | 构建提示词 WASM，检查 TypeScript 并构建前端。  |
| `pnpm build:desktop`                          | 构建 Windows 可执行程序，不生成安装包。        |
| `pnpm types` / `pnpm types:check`             | 写入 / 只读检查通信类型。                      |
| `pnpm prompt:wasm`                            | 构建共用提示词 WASM。                          |
| `pnpm fmt` / `pnpm fmt:check`                 | 修复 / 只读检查 Rust、前端和 Markdown 格式。   |
| `pnpm docs:fix <文件...>` / `pnpm docs:check` | 修复指定文档 / 检查 Markdown。                 |
| `pnpm lint`                                   | Rusteward / Clippy 与 Oxlint。                 |
| `pnpm test`                                   | Rust、Vitest 与 Python 的单元测试入口。        |
| `pnpm test:lexicon`                           | 不加载模型依赖的资源工具单元测试。             |
| `pnpm check`                                  | 编译、格式、lint、单元、类型一致性和前端构建。 |

Rusteward 管理 Rust 格式与 Clippy，Oxfmt 管理前端和工程配置，rumdl 独立管理 Markdown。`oxlint.config.ts` 与 `oxfmt.config.ts` 使用类型化配置并纳入工具 TypeScript 检查。Oxlint 的 Stylistic 规则与 `pnpm fmt:web` 维护声明空行：import 段后、函数及类成员之间一行，变量可分组，重载与实现紧邻，箭头函数、函数表达式和 `useCallback` 也按函数处理。

Rust 检查顺序为编译 → 格式 → lint → 单元测试。按影响选择检查，默认只新增或运行纯逻辑单元测试，不引入集成、UI、E2E、性能或快照测试；内存后端可验证调度逻辑，不能代替真实服务与恢复验收。文档修改收尾运行 `pnpm docs:fix <本次修改的文件...>`；桌面构建独立于统一检查。

应用图标的矢量源为 [app-icon.svg](../apps/desktop/src/assets/app-icon.svg)，标题栏、启动页与浏览器图标共用此文件。修改后运行 `pnpm --filter @nib/desktop exec tauri icon src/assets/app-icon.svg`，生成的多尺寸及平台资源位于 `src-tauri/icons/`，Windows 程序使用 `icon.ico`。

## 词库资源与构建

应用代码和资源维护使用不同分支。main 的 `resources/lexicon/` 保存 `recipe.json`、`models.lock.json`、`novelai.json` 与模型许可，分别定义词条筛选与语义契约、固定模型、NovelAI 补充数据和许可说明。独立的 orphan `resource` 分支保存 `catalog.json`、`lexicon/sources.lock.json`、`lexicon/cache/` 与 `lexicon/versions/<version>/`；资源版本采用独立的稳定 `major.minor.patch`，不随应用版本变化。普通应用开发与 `pnpm check` 不需要检出该分支或下载 LFS 对象。

首次建立资源分支时，在主工作区执行：

```sh
git worktree add --orphan -b resource ../nib-resource
```

远端已有资源分支、本地尚无该分支时，改为：

```sh
git fetch origin resource
git worktree add --track -b resource ../nib-resource origin/resource
```

资源维护需要 Git LFS；先执行 `git lfs install`，已有资源工作树通过 `git -C ../nib-resource lfs pull` 取得实际文件。orphan 分支不继承 main 的文件，必须维护自己的 `.gitattributes`，不能依赖主分支的规则：

```gitattributes
* text=auto eol=lf
*/cache/*.gz filter=lfs diff=lfs merge=lfs -text
*/versions/** -text
*/versions/**/*.sqlite3 filter=lfs diff=lfs merge=lfs -text
*/versions/**/*.f16 filter=lfs diff=lfs merge=lfs -text
*/versions/**/*.onnx filter=lfs diff=lfs merge=lfs -text
*/versions/**/*.onnx_data filter=lfs diff=lfs merge=lfs -text
*/versions/**/tokenizer.json.gz filter=lfs diff=lfs merge=lfs -text
```

`sources.lock.json` 固定来源提交、文件身份、SHA-256 与许可说明。默认数据来自 ffdkj，`--enhanced` 显式加入 DanbooruSearchOnline 的别名、分组与共现数据，资源元数据保留各自来源和许可。规范词条使用稳定的 Danbooru 名称身份；原名、译名和别名分开保存，画师保留未翻译的英文或假名名称。插入使用资源提供的 NAI 适配文本 `promptText`，前端不从原名推导或维护重命名映射；分类不与风格分组混用，共现查询仅表达关联作品或题材。

离线工具入口为 `python tools/lexicon/lexicon.py`，默认 `--resource-dir` 是主工作区同级的 `nib-resource`，默认临时工作目录为 `.dev/lexicon-build`。更新来源必须显式运行 `refresh-source`；`build` 读取既有来源锁，不隐式改写来源版本。在主工作区执行：

```sh
uv sync --project tools/lexicon --locked
python tools/lexicon/lexicon.py refresh-source --resource-dir ../nib-resource
uv run --project tools/lexicon --locked python tools/lexicon/lexicon.py build --version 1.0.0
python tools/lexicon/lexicon.py export-cache --resource-dir ../nib-resource
```

将示例版本替换为本次资源版本；输出默认位于 `../nib-resource/lexicon/versions/1.0.0/`，已存在的版本目录不会覆盖。`--lexical-only` 只构建基础词库，`--enhanced` 加入增强来源，`--reuse-models <directory>` 复用并校验已有模型文件。`fetch` 下载锁定来源，`normalize` 生成规范词条，`models` 准备固定模型，`encode` 编码语义文档，`merge` 校验并合并分片，`pack` 调用 `nib-lexicon` 生成资源。编码默认使用 CPU、有界批次和按文本长度分桶，`--batch-size`、`--bucket-size`、`--threads` 调整本机资源使用，`--shard-index` 与 `--shard-count` 可拆分编码。

已有规范词条和语义产物时，可直接重新打包而不重复编码：

```sh
uv run --project tools/lexicon --locked python tools/lexicon/lexicon.py pack --version 1.0.0 --input .dev/lexicon-build/normalized.jsonl --semantic-dir .dev/lexicon-build/semantic
```

包内 `resource.json` 描述资源身份、版本、组件依赖及文件 URL、大小和哈希，`lexicon.json` 保存词库领域格式；`build.json` 记录代码基线提交、dirty 状态、打包源码与输入哈希、来源锁和构建配方身份。基础 `core` 组件支持 SQLite 名称、别名与译名查询，`semantic` 组件依赖同版本的 `core`，另含 fp16 索引、稳定键列表、本地 CPU 查询模型与压缩 tokenizer。原生词库 consumer 核对领域契约并打开完整快照后才启用新代次；基础安装不加载模型，ONNX 编码器惰性初始化。索引、模型指纹、tokenizer、维度、截断、前缀和归一化属于同一契约。原生绑定使用 `ort 2.0.0-rc.15`，该代 API 使用固定 RC 并由锁文件记录完整依赖，CPU 运行库随原生程序链接。

文档向量缓存以规范文档内容、模型、模板、归一化和编码环境身份为键，未变化词条复用已提交批次，新词或变化词条才重新编码；删除词条不进入新索引。`build` 优先使用本地 `.dev/lexicon-build/embeddings.sqlite3`，缺少时从资源工作树的 `lexicon/cache/embeddings.sqlite3.gz` 与 `metadata.json` 恢复。`export-cache` 将已提交缓存导出到该稳定位置，`import-cache` 可显式恢复。缓存由 LFS 维护，位于版本目录之外；客户端只下载发布的资源文件，不获取构建缓存或依赖 Git LFS。

通用下载目录固定为 [resource 分支的 catalog.json](https://raw.githubusercontent.com/rhnu/nib/refs/heads/resource/catalog.json)，界面不接受下载地址。`nib-resources` 负责目录刷新、组件依赖闭包、按内容身份复用文件、大小与 SHA-256 校验，以及有效强 ETag 和 Range 响应下的续传。宿主将资源 ID 与目标组件集合交给 app 启动任务；任务由 app 持有，离开页面不会取消。完整资源组校验并经 consumer 准备成功后，才原子切换活动记录；失败或取消保留旧版本。资源代次租约保留仍被查询使用的文件，卸载停用 consumer。开发阶段不兼容旧资源布局，旧安装需重新安装。

前端通用 `downloads` 组件由设置页提供，不依赖具体词库模块；安装和卸载按资源 ID 失效声明了 `meta.downloadableResource` 的消费者查询。词库状态查询声明 `lexicon`，按 generation 变化增加修订并拒绝旧补全与插入；词库查询只消费可用代次，不拥有目录地址或下载操作。未安装空状态通过工作台导航进入资源下载设置，沿用材料提交和未应用遮罩保护。管理界面的操作说明见[资源下载](features.md#资源下载)。

## 持续检查

[CI](../.github/workflows/ci.yml) 按职责拆分：Linux quality 检查前端与配置格式、Markdown、前端 lint 和不含模型依赖的 Python 单元；Linux web 运行前端单元、准备 WASM 与 Web 产物；Windows native 完成 Rust 编译、格式、lint、单元与类型一致性；Windows desktop 复用已检查的 Web 产物构建桌面程序，并收集可执行产物。当前 Windows CPU 版 ONNX Runtime 静态链接到程序。Changes 作业按事件基线识别仅文档修改，这类修改仍运行 quality，web、native 与 desktop 按预期跳过；最终 CI 作业同时核对需要运行的成功项与允许跳过的分项。构建上传短期产物，不生成安装包、签名或自动更新。

Web 产物缓存使用实际构建输入的内容指纹，包含前端、提示词 WASM、工具及相关配置。指纹未变化时复用可信 main 保存的已检查产物，仍运行前端单元测试；未命中时才安装 WASM 工具并完成 WASM、类型检查与 Web 构建。仅原生实现变化可复用相同指纹的 Web 产物，桌面 CI 不重复构建前端。

Node、Rust 与 wasm-bindgen 安装逻辑集中在 `.github/actions/`。pnpm store、Rust 的平台 / profile / target、ONNX 下载与 wasm-bindgen CLI 使用各自缓存键；只有可信 main 运行写入共享缓存，PR 可以读取。GitHub Actions 使用发布 tag，Rusteward 按项目约定调用 `rhnu/rusteward@main`，不再每次从 Git 源码安装。

## 资源发布

资源生成与发布使用本地 CLI，从主工作区先校验，再提交资源工作树中的来源锁、缓存、版本包及 `.gitattributes`，最后发布：

```sh
cargo xtask resources verify --id lexicon --version 1.0.0
git -C ../nib-resource add .gitattributes lexicon
git -C ../nib-resource commit -m "chore(resources): add lexicon 1.0.0"
cargo xtask resources publish --id lexicon --version 1.0.0 --name "Prompt lexicon" --description "Vocabulary and optional semantic search."
```

`verify` 检查本地版本身份、文件大小与哈希、组件依赖及固定 release 地址；两个子命令均可用 `--resource-dir` 指定资源工作树。`publish` 要求资源工作树干净，并使用已登录的 GitHub CLI 与仓库远端权限；先推送 LFS 对象和 `resource` 分支，再创建对应资源提交的 tag。tag 与 GitHub Release 标题统一为 `resource-lexicon-v1.0.0`，不含空格，资源 release 不占用应用的 latest 位置。

发布不覆盖同身份资产；已有资产须大小和哈希一致，缺失文件可继续上传。所有 release 资产核对完整并确认公开下载地址可访问后，才更新资源分支的 `catalog.json`、创建目录更新提交并正常推送，不使用 force。来源锁、包和缓存随资源分支维护，应用检查和构建不负责生成或发布资源。
