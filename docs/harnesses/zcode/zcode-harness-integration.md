# ZCode Harness 接入

## 原生路径与交付

插件 ID 为 `zcode`，入口是 `packages/adapters/zcode/src/plugin.ts`。使用 ZCode 自带的 `app-server --stdio --surface terminal` 双向 JSON-RPC，而不是模拟终端或套用其他 Harness 的 ACP。已验证 macOS 上 ZCode 内置运行时 `0.16.5`；该接口没有独立的兼容性承诺，升级后应重新运行原生验收。

插件已加入预装清单，使用公共 Loader、Harness route codec 和普通可写 Thread。Host Runtime 不直接依赖 ZCode Adapter。Renderer 的 Agent/Model/Thinking/权限选择、连接页、侧栏图标、Thread 恢复及 Desktop Controller/诊断工具名单均已接入。

## 安装、配置和数据

安装 [ZCode Desktop](https://zcode.z.ai/cn/docs/install)，或提供支持上述原生 app-server 的 ZCode CLI。自动发现先检查 PATH 和常见 CLI 安装目录，再检查 Desktop 的 `resources/glm/zcode.cjs`。macOS 默认路径是 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`。其他位置可设置 `CODEXHOST_ZCODE_COMMAND` 为可执行文件或 `zcode.cjs` 的完整路径；显式配置无效时不会回退到另一份安装。

Provider 优先使用原生 CLI 配置。当原生 CLI 的模型目录为空时，插件从 `~/.zcode/v2/config.json` 读取启用的 Desktop Provider，经 `workspace/updateProviderRegistry` 注册到当前子进程内存。`CODEXHOST_ZCODE_CONFIG` 可指定采用相同 `provider` 结构的文件，并覆盖自动配置来源。支持 Anthropic、OpenAI、OpenAI-compatible Provider，传递原生 reasoning levels 及各档位对应的 Provider 参数。API Key 不写入 Host 映射或插件目录，也不输出原生 stderr。

检查会读取真实 Catalog，但不创建用户 Session、不发送模型请求，也不证明远端凭据有效。模型、Thinking 与权限切换仅在原生响应确认生效后返回成功。

CLI 默认使用自身的 `~/.zcode/cli` 配置及数据库；桥接 Desktop Provider 不代表接管 Desktop 的数据库、登录状态、代理、MCP、Hooks 或其他偏好。原生 `ZCODE_SESSION_DB_PATH` 可指定数据库。导入列出当前原生数据库内可见的根 Session，不自动迁移 Desktop 历史。不要让多个进程同时执行同一个 Native Session。

## 能力和语义

| 能力 | 当前行为 |
| --- | --- |
| Thread | 创建、可写恢复、后续 Turn、历史快照、Session 导入接口；保留原生 Session ID 与工作区 |
| 输出 | 文本与 Reasoning 流、Bash、一般工具、MCP 工具结果、原生上下文压缩、Usage |
| 文件差异 | 查询 v4 原生文件检查点生成 diff；不靠工具文字或当前磁盘内容推断旧内容 |
| 人工交互 | 原生权限选项、允许/拒绝、单选/多选/自由回答、取消；原样提交对应原生响应 |
| 配置 | 原生 Model、Thinking、build/edit/plan/yolo/auto 模式；无人值守完整访问映射到原生 yolo |
| 取消 | 只停止匹配的当前 Turn；原生清理确认后开放下一 Turn；忙碌时拒绝第二次 start |
| Fork | v4 `forkAssistant` 从稳定完成的助手消息创建独立 Session，不恢复工作区文件；不支持跨 cwd |
| 修订上一条消息 | 派生到前一 Turn；仅一轮时创建保留配置的空 Session；原 Session 保留 |
| 命令 | `/compact` 与 `/goal`（设置、查看、暂停、继续、替换、清除）；普通 native Skill/Command 调用由 ZCode 执行 |
| 子代理 | 原生 Agent/SendMessage 及后台状态；通过原生子 Session 关系校验后读取已结束子代理的记录 |
| Goal | 原生目标执行与后续自主 Turn；不在 Host 仿造自动循环 |
| 委派 | 公共 Coordinator 可创建、读取、等待和继续 ZCode Thread；每个 Session 接收 Host 注入的运行环境 |

原生旧 `session/fork` 会回退文件，不能用于 CodexHost 的会话分叉。插件只调用 v4 稳定消息分叉，校验派生内容前缀，并使用派生 Session 新的消息身份。

每个 Session 独立拥有一个原生进程；工厂环境与 `OpenSessionInput.environment` 合并传给实际执行进程，Thread 覆盖值优先。关闭会调用原生关闭接口并回收自己的进程树；RPC 超时、协议损坏或进程退出使该 Session 故障，接受的 Turn 只产生一次终态。恢复历史不消费 `outputs`，Host 是输出流的唯一消费者。

## 明确的限制

- 原生运行中的子代理没有独立的无副作用 Transcript 读取接口。`session/resume` 会恢复并修复会话状态，因此读取运行中子代理时返回可重试的 `sessionBusy`，完成后可读。
- 终端运行面不提供 ZCode Desktop 的私有浏览器/Computer Use 桥、Wiki 管理 UI、Bot Channel、定时任务管理、额度和账号切换。需要 Desktop 动态登录头的 Start Plan/官方 MCP 登录流程尚未桥接；使用原生 CLI 可用的认证或 API Key Provider。
- ZCode 原生设置与权限规则可能按它自己的语义持久化；Host 不模拟会话级设置来覆盖原生行为。
- 运行时自行发现的 Skills、MCP 和 Hooks 按 CLI 配置工作。ZCode 支持 `.agents/skills`，可读取 CodexHost 安装的委派 Skill；真实跨 Harness 递归委派仍需目标环境同时具备可执行 CLI 和可达的 Runtime。
- Windows、Linux、SSH/Remote Control 和真实云端 Provider 未做本次原生验收。Desktop 产品接线有 Renderer、Controller 契约测试及浏览器 Picker 端到端测试；本次未重启用户正在运行的 Codex Desktop 做交互验收。

## 验证

常规测试使用可执行的 JSON-RPC fixture，验证接受响应与事件竞争、重复事件、原生退出、协议损坏、取消、恢复和清理。实际搬移后的插件经过 Loader 和 AppServerHost，覆盖创建、Turn、Host 重启后恢复、继续以及 Coordinator 委派。Renderer 测试覆盖 ZCode 选择、配置隔离、公共 route 编解码、锁定 Thread 恢复与现有 Harness 回归。

原生测试显式启用，使用安装的 ZCode 运行时、临时 HOME/数据库与本地 Anthropic HTTP fixture，不使用真实凭据或计费模型：

```sh
CODEXHOST_TEST_ZCODE_RUNTIME=/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs \
  npx vitest run --config tests/vitest.config.js packages/adapters/zcode/test/native.test.ts
```

覆盖原生检查不建 Session、流式请求、工具审批、问题、实际文件写入与 diff、取消后续聊、恢复、配置切换、分叉不改文件、回退、压缩、Goal、子代理，以及工具进程委派环境和 Skill 发现。默认测试会跳过这一文件；需要显式运行才能声称通过原生验证。
