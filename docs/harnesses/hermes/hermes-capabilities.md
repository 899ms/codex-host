# Hermes 原生能力与接入边界

Hermes 插件仍使用 `hermes acp`，实现只位于 `packages/adapters/hermes/`。公共 Adapter、Host Runtime 和 Renderer 没有 Hermes 专用分支。

## Edit Diff

工具的 ACP `content: [{ type: "diff", path, oldText, newText }]` 保留为待确认修改，只有原生工具状态为 `completed` 才输出 `fileChange`，并通过 `sourceItemIds` 关联工具。失败、拒绝或取消的工具不会把预览当作已应用修改。原生最后一次 diff 更新覆盖先前预览；历史重放使用相同投影，但仅当原生回放仍包含 diff 块时能展示差异。只有普通工具摘要的旧历史不能重建修改内容。

Hermes 的 `skill_manage` 会将 unified diff 的 hunk 转换为 `oldText/newText`，原文件行号已丢失。插件保守标记 `diffScope: "fragment"`、`kind: "update"`，不把缺失 oldText 推断成新建文件，也不把空 newText 推断成删除文件。展示的是原生片段，不用于合并为整文件补丁。每个工具最多保留 32 个片段、1 MiB 文本；超出则不投影 diff，工具输出仍保留。工具文本/图片从 ACP 标准嵌套 `content` 块读取。

## 斜杠命令和压缩

Session 从原生 `available_commands_update` 动态建立命令目录，支持其实际公布的 `/help`、`/tools`、`/context`、`/compress`、`/version`。不会硬编码宣称旧版本支持命令；未公布或不支持的参数在发送 Prompt 前拒绝。只有原生声明 input 的命令接受文本参数。

命令走原生 `session/prompt`，沿用单 Turn 排他、取消、故障和关闭流程。`/compress` 执行 Hermes 的压缩实现，结果及更新后的 Usage 原样投影。原生命令对应 `contextCompaction` Item。仅原生明确返回 `Context compressed: … messages` 及 token 数量确认时成功；`Compression failed:`、`Error executing /compress:` 或不可用结果让 Item 和 Turn 失败。原生可能报告无上下文或其他未确认结果，并仍返回 `end_turn`；此时 Turn 正常结束，Item 以原生文本为原因结束为无操作的 `cancelled`，不声称用户取消或压缩成功。取消请求发给原生，等待真实 Prompt 终态；不能保证原生同步压缩函数立即响应中断。关闭 Session 终结活动 Turn，迟到输出不会污染后续状态。

原生 ACP 不把这些命令写入会话 Transcript，因此它们不生成虚构 `NativeTurnRef`，也不进入 `readSnapshot()` 的持久化历史。普通聊天仍使用原有历史逻辑。压缩后原生恢复的是压缩后的模型上下文，不保证保留压缩前所有可见 Turn。

`/model` 通过既有模型选择接口处理，确保 Host 得到确认后的配置。目录不暴露 `/reset`（会使 Host 历史失效），也不暴露 `/queue`、`/steer`（需要不同于当前单 Prompt 的并发协议）。用户直接输入文本的行为仍交给 Hermes 原生解释。

## 剩余能力和实现路径

| 能力 | 当前 ACP 原生事实 | 当前结论 |
| --- | --- | --- |
| 提问 | ACP 只有 permission 请求；没有安装 TUI gateway 的 `clarify` 回调 | 不伪造问题或自动回答，维持未支持 |
| Thinking 选择 | `set_config_option` 对非权限键仅存入字典，没有更新 Agent reasoning；也不公布 reasoning 选项 | 不把 RPC 接受误报为设置生效 |
| Fork | `session/fork` 深拷贝完整会话，参数没有 checkpoint | 无法实现公共契约要求的指定中间 Turn 边界，维持未支持 |
| 修订上一条 | ACP 无非破坏性截断或 rollback 接口 | 不修改源会话，不用完整复制冒充少一轮历史 |
| 自动压缩事件 | ACP 提供压缩后的 Usage/摘要，没有对应压缩开始和确认完成事件 | 手动命令可用，不宣称自动压缩生命周期可观测 |

官方 TUI gateway 是另一套正式支持的协议，具有 `clarify`、reasoning、`session.compress`、带消息数量边界的 `session.branch(count)`、`session.undo`、恢复、审批和中断。完整迁移后可以用 branch 加 undo 组合满足源隔离的修订语义，并验证单轮空历史和配置保留。它区分进程内 runtime Session 与持久化 Session，管理自己的 owner 和附着客户端；官方明确不支持独立进程并发写同一会话。它的 rewind 在 `prompt.submit` 上以 `confirm_truncate` 破坏性改写持久化行，且幸存行 ID 会改变。不能为 ACP 会话临时启动 gateway 发几个 RPC，就声称满足独立派生、源会话隔离和稳定历史身份。后续可在 Hermes 插件内部完整迁移传输，并对既有 ACP 会话、身份、审批、取消和历史提供迁移验收；当前不混用这两个会话 owner。

## 原生依据与验证范围

源码核查固定于 NousResearch/hermes-agent `1450c7fcfb5cca740e9b76545bd2ecdec94f4aa0`：

- [ACP 命令目录、派发、压缩](https://github.com/NousResearch/hermes-agent/blob/1450c7fcfb5cca740e9b76545bd2ecdec94f4aa0/acp_adapter/commands.py)
- [ACP 工具 diff 和输出块](https://github.com/NousResearch/hermes-agent/blob/1450c7fcfb5cca740e9b76545bd2ecdec94f4aa0/acp_adapter/tools.py)
- [ACP Prompt、取消、配置和 Fork](https://github.com/NousResearch/hermes-agent/blob/1450c7fcfb5cca740e9b76545bd2ecdec94f4aa0/acp_adapter/server.py)
- [ACP 全量深拷贝和 source=acp 持久化](https://github.com/NousResearch/hermes-agent/blob/1450c7fcfb5cca740e9b76545bd2ecdec94f4aa0/acp_adapter/session.py)
- [官方协议对比、gateway owner 和 rewind 语义](https://github.com/NousResearch/hermes-agent/blob/1450c7fcfb5cca740e9b76545bd2ecdec94f4aa0/website/docs/developer-guide/programmatic-integration.md)

聚焦测试覆盖成功/失败 diff、历史一致性、内容边界、命令协商、参数拒绝、压缩 RPC 失败/原生文本失败，以及取消和关闭生命周期。没有安装并认证的 Hermes 可执行程序，因此未进行真实模型压缩或 Desktop 端到端测试；源码核查和模拟协议测试不能替代这些验证。
