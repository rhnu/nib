# nib 工作区指导

开始修改前阅读 [README](README.md) 与[开发说明](docs/development.md)，涉及领域行为时再读[设计说明](docs/design.md)。

- 当前是工程骨架。未实现的业务模块仅有职责说明，不以占位类型、空服务或模拟成功响应填充功能。
- nib 直接依赖 novelai-bridge；NAI 语义与校验归 SDK，应用资源、会话、调度和结果归 nib。
- 应用库不依赖 Tauri；桌面宿主集中装配。查询与可替换能力的契约由使用它的领域模块拥有。
- Rust 依赖统一从 workspace 继承。修改通信类型后运行 `pnpm types`，不手改生成文件。
- 检查、格式与测试范围遵循开发说明；`pnpm check` 是统一检查入口，桌面构建独立运行 `pnpm build:desktop`。
- 维护文档时区分产品设计与当前能力，同一说明只保留一个详细来源；不将本轮验证记录堆入长期文档。
