# nib 工作区指导

开始修改前阅读 [README](README.md) 与[开发说明](docs/development.md)，涉及领域行为时再读[功能说明](docs/features.md)与[设计说明](docs/design.md)。

- 稳定版数据库 schema 从 1 开始保留升级历史；结构或持久内容发生不兼容变更时递增版本并提供自动升级。升级独立于新库初始化，在业务 bootstrap 前持有目录锁执行；可重建缓存递增格式版本并重建，不丢弃用户数据。开发版旧库不兼容。
- 软件版本只在根 `Cargo.toml` 的 `workspace.package.version` 维护；Rust 包与 Tauri 继承该值，私有前端包不单独声明软件版本。
- 未实现的业务模块仅有职责说明，不以占位类型、空服务或模拟成功响应填充功能。
- nib 直接依赖 novelai-bridge；NAI 语义与校验归 SDK，应用资源、会话、调度和结果归 nib。
- 应用库不依赖 Tauri；app 的 bootstrap/state 组合业务能力并管理生命周期，桌面宿主负责前端交互、平台适配与 I/O 装配。跨 crate 契约按领域放在 nib-contract，可替换能力由使用它的领域定义。
- Rust 依赖统一从 workspace 继承。修改通信类型后运行 `pnpm types`，不手改生成文件。
- 检查、格式与测试范围遵循开发说明；`pnpm check` 是统一检查入口，桌面构建独立运行 `pnpm build:desktop`。
- 视觉验收默认由用户完成；用户明确要求模型自行验收时，使用子代理执行。
- 维护文档时区分产品设计与当前能力，同一说明只保留一个详细来源；不将本轮验证记录堆入长期文档。
- 图片操作使用紧凑纯图标单排覆层，名称放在 tooltip 与可访问标签中；参数采用紧凑网格或浮层入口，不常驻内部 ID。
