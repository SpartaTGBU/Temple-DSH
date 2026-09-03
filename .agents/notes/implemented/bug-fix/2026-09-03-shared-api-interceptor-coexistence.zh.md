# Agent Note: 共享 API interceptor 共存

Status: implemented

[English](2026-09-03-shared-api-interceptor-coexistence.md) | 中文

## 问题

Host Connection 过去只保存一个 `/api` interceptor。当 MemPalace Dashboard 先于 Typert Gateway 注册端点时，它会取代所有生成的 Remote 端点。Web shell 仍能渲染，但工作区选择、插件检查及其他 unary API 都返回 HTTP 404。

## 决策

Connection 为共享 `/api` 路由保存一组 interceptor 声明。派发会评估请求端点的全部声明：没有所有者时返回 404，恰好一个所有者时交给它处理，多个所有者时以 HTTP 500 拒绝。每个声明仍受 fiber 生命周期约束，销毁时只移除自身。

Web profile 静态挂载应用内 browse picker 及其 Host 后端。该交互适用于本地和远程浏览器，不依赖 Host 显示器，并由交付给用户的同一 Playwright 组合测试。native 与 adaptive picker 包仍是显式替代方案。

## 曾考虑的替代方案

- 保留单个 interceptor 并把 Dashboard 合并进 Typert Gateway：拒绝，因为 Connection 是传输所有权边界，独立功能端点必须无需修改 Gateway 即可组合。
- 为 Dashboard 注册单独的 HTTP 前缀：拒绝，因为这会重复共享 `/api` 的信任、认证、信封和客户端调用约定。
- 继续把 adaptive picker 作为 Web 默认值：对浏览器产品拒绝，因为 OS 对话框依赖 Host 显示器且无法服务远程浏览器；显式部署仍可使用它。

## 后果

- Dashboard、生成的 Remote 服务及未来互不相交的 unary 所有者可在 `/api` 上共存。
- 重叠端点声明在派发时明确拒绝，不再依赖注册顺序。
- Web 选择器一致使用应用内 browse 交互；操作者可通过组合选择 native 或 adaptive 行为。
- Playwright world 继承生产 picker wiring，不再修补一组平行的测试专用条目。

## 验证

Host 测试覆盖互不相交的 Dashboard 与 Typert 风格所有者、重叠声明、认证、销毁和未认领端点。Playwright 覆盖冷启动文件夹创建、现有文件夹采纳、重载持久性、重复名称拒绝、重命名、分组和扁平视图、注册删除、启动自动选择、空白会话折叠及 preset 选择。构建后的集成服务器重复完整工作区生命周期，且没有 `/api` 失败或页面错误。
