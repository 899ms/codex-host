# ZCode Harness 接入

## 原生路径与交付

插件 ID 为 `zcode`，入口是 `packages/adapters/zcode/src/plugin.ts`。使用 ZCode 自带的 `app-server --stdio --surface terminal` 双向 JSON-RPC，而不是模拟终端或套用其他 Harness 的 ACP。已验证 macOS 的工作区 Registry 接口，以及 Windows ZCode Desktop `3.12.3` 的进程级 Registry 接口；两者内置运行时均报告 `0.16.5`，但接口集合不同。Adapter 按实际接口能力选择路径，不按操作系统或版本字符串分支。该接口没有独立的兼容性承诺，升级后应重新运行原生验收；安装发现和进程启动成功仍不代表协议及认证可用。

插件已加入预装清单，使用公共 Loader、Harness route codec 和普通可写 Thread。Host Runtime 不直接依赖 ZCode Adapter。Renderer 的 Agent/Model/Thinking/权限选择、连接页、侧栏图标、Thread 恢复及 Desktop Controller/诊断工具名单均已接入。

## 安装、配置和数据

安装 [ZCode Desktop](https://zcode.z.ai/cn/docs/install)，或提供支持上述原生 app-server 的 ZCode CLI。自动发现先检查 PATH 和常见 CLI 安装目录，再检查 Desktop 的 `resources/glm/zcode.cjs`。macOS 默认路径是 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`。其他位置可设置 `CODEXHOST_ZCODE_COMMAND` 为应用安装目录，也兼容可执行文件或 `zcode.cjs` 的完整路径；显式配置无效时不会回退到另一份安装。

Windows 自动检查 `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs` 和 `%ProgramFiles%\ZCode\resources\glm\zcode.cjs`；PATH 中找到 Desktop `ZCode.exe` 时，优先使用该可执行文件同一安装目录的内置脚本，不拼接另一份安装。内置脚本由 Host 的 Node 运行时启动，无需额外安装独立 CLI；独立 `.cmd` CLI 仍通过公共 Windows 启动包装执行。脚本必须可读且为普通文件，环境变量名按 Windows 大小写不敏感规则读取。自定义安装既不在 PATH 中也不在上述目录时，仍需显式配置；不扫描整个磁盘或猜测未知安装布局。

连接设置页的本地 ZCode 右侧详情卡片填写应用安装目录，例如 `D:\program\Zcode`，无需填写 `.exe` 或脚本。Adapter 自动定位目录内的 `resources/glm/zcode.cjs`，目录不完整时不回退到其他安装。支持保存或清除覆盖配置。设置持久化在 Host 数据目录，优先于 `CODEXHOST_ZCODE_COMMAND`；清除后恢复环境变量或自动发现。重启 codexhost 后应用，不热替换运行中的 Session，保存成功不代表原生协议或认证检查成功。详见[自定义启动路径设置](../../architecture/harness-plugin-runtime.md#自定义启动路径设置)。

启动 Desktop 内置 `resources/glm/zcode.cjs` 时，先保留原生脚本已有的 Provider 配置查找位置；这些位置不可用时，才检查同一安装目录的 `resources/config/provider/zcode-builtin.json`。找到后仅给子进程补充 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`，由 ZCode 原生启动逻辑继续管理活动配置缓存、个人配置及刷新，不复制或修改安装目录文件。用户显式提供原生 Provider 配置路径时不覆盖，独立脚本和可执行文件的启动语义不变；已识别的 Desktop 布局两处都缺失时明确报告安装缺少内置 Provider 配置。

Provider 和模型目录有两条原生路径：

- **工作区 Registry**：保留 `workspace/readState`。优先使用原生已有配置；模型目录为空时，从 `~/.zcode/v2/config.json` 读取启用的 Desktop Provider，经 `workspace/updateProviderRegistry` 注册到当前子进程内存。`CODEXHOST_ZCODE_CONFIG` 可指定同一 `provider` 结构的文件并覆盖自动来源。支持 Anthropic、OpenAI、OpenAI-compatible Provider 及原生 reasoning 参数。
- **进程级 Registry**：仅当 `workspace/readState` 返回 JSON-RPC `-32601`（方法不存在）时，使用 `workspace/readPresentation` 确认工作区，再创建 `persistence: deferred` 的临时 Session 读取原生模型目录；禁用标题生成，传入空 MCP 配置，不发送提示词，读取后用 `session/close` 和 `expectedPersistence: deferred` 关闭。模型、默认选择、禁用原因及 Thinking 来自原生 Session 快照，不从账户文件推测。Provider 注册、凭据与模型规则由 ZCode 自身加载，包括原生 `provider_config.json`（默认位于 `~/.zcode/v2/`，路径受原生数据目录配置控制）。不调用 `workspace/updateProviderRegistry` 或把 `provider/updateAccountConfig` 当作替代。此路径遇到显式 `CODEXHOST_ZCODE_CONFIG` 会报错提示使用原生配置，不静默忽略或迁移旧文件。

认证失败、超时、进程错误和格式错误不会触发接口降级。临时 Session 清理失败时检查不报告成功，调用方继续回收进程。API Key 不写入 Host 映射或插件目录，也不输出原生 stderr。

检查不创建持久化用户 Session、不发送模型请求，也不证明远端凭据有效。快照可以没有当前模型，Host 不伪造默认选择；没有可用模型时提示在 ZCode 中配置并认证 Provider。新接口的模型选择携带原生 reasoning 选项，回滚保留原生选择；旧接口的请求结构保持不变。模型、Thinking 与权限切换仅在原生响应确认生效后返回成功。

配置与数据库位置由各原生运行时解析，旧 CLI 默认使用自身的 `~/.zcode/cli`；不把旧版路径强加给进程级 Registry 运行时。桥接 Provider 不代表接管 Desktop 的登录状态、代理、MCP、Hooks 或其他偏好。原生 `ZCODE_SESSION_DB_PATH` 可指定数据库。导入列出当前原生数据库内可见的根 Session，不自动迁移 Desktop 历史。不要让多个进程同时执行同一个 Native Session。

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

恢复及历史派生校验真实工作目录身份：比较文件系统解析后的路径，必要时用非零文件 ID 与卷/设备 ID 确认同一目录，接受指向同一目录的盘符大小写、分隔符、符号链接或 junction 别名。不会统一转成小写而误放行大小写敏感目录；目录缺失、无法读取或身份无法确认时拒绝。通过原生 `session/resume` 确认 Session 身份和工作区后，模型目录读取及旧接口的临时 Provider 注册使用该原生工作区标识，再读取已激活 Session 的快照，避免别名路径导致恢复后模型不可用。执行 cwd 仍来自 Desktop，不放宽跨工作区 Fork 限制，也不扫描或迁移原生历史。

## 明确的限制

官方账号模型的调研依据、候选路线和暂缓实施决定见[官方账号模型接入：背景与候选方案](zcode-official-provider-proposal.md)；该方案不代表当前能力。

- 原生运行中的子代理没有独立的无副作用 Transcript 读取接口。`session/resume` 会恢复并修复会话状态，因此读取运行中子代理时返回可重试的 `sessionBusy`，完成后可读。
- 终端运行面不提供 ZCode Desktop 的私有浏览器/Computer Use 桥、Wiki 管理 UI、Bot Channel、定时任务管理、额度和账号切换。官方账号 Provider 所需的 `provider/updateAccountConfig` 账号状态同步和 `interaction/requestProviderRuntimeHeaders` 请求认证尚未接入；Start Plan（体验方案）还依赖 Desktop 的原生验证码流程。自定义 API Key Provider 可被读取，不代表官方账号模型可用；不硬编码模型列表或伪造权益。官方 MCP 登录流程同样尚未桥接。
- ZCode 原生设置与权限规则可能按它自己的语义持久化；Host 不模拟会话级设置来覆盖原生行为。
- 运行时自行发现的 Skills、MCP 和 Hooks 按 CLI 配置工作。ZCode 支持 `.agents/skills`，可读取 CodexHost 安装的委派 Skill；真实跨 Harness 递归委派仍需目标环境同时具备可执行 CLI 和可达的 Runtime。
- Windows 已用安装的原生运行时与本地模拟 Provider 验收；本次未在 macOS 重新跑原生运行时，旧接口由双协议 fixture 回归覆盖。Linux、SSH/Remote Control 和真实云端 Provider 未做本次原生验收。Desktop 产品接线有 Renderer、Controller 契约测试及浏览器 Picker 端到端测试；本次未重启用户正在运行的 Codex Desktop 做交互验收。

## 验证

常规测试使用可执行的 JSON-RPC fixture，验证接受响应与事件竞争、重复事件、原生退出、协议损坏、取消、恢复和清理。实际搬移后的插件经过 Loader 和 AppServerHost，覆盖创建、Turn、Host 重启后恢复、继续以及 Coordinator 委派。Renderer 测试覆盖 ZCode 选择、配置隔离、公共 route 编解码、锁定 Thread 恢复与现有 Harness 回归。

Windows 发现测试使用合成文件清单覆盖用户/系统安装、PATH 便携安装、中文和空格路径、`.cmd`、显式配置不回退及候选文件校验。目录身份测试覆盖 Windows 路径别名、大小写敏感目录、跨卷和无有效文件 ID；协议 fixture 验证目录别名恢复后继续写入、拒绝不同工作区以及失败后重试。新旧协议使用同一组生命周期测试；兼容性测试还覆盖精确降级条件、缺少当前模型、原生 reasoning 默认值、旧 Provider 覆盖拒绝、临时 Session 清理和检查不持久化。这些 fixture 测试不替代安装包的原生验收。

原生测试显式启用，使用安装的 ZCode 运行时、临时 HOME/数据库与本地 Anthropic HTTP fixture，不使用真实凭据或计费模型：

```sh
CODEXHOST_TEST_ZCODE_RUNTIME=/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs \
  npx vitest run --config tests/vitest.config.js packages/adapters/zcode/test/native.test.ts
```

验证进程级 Registry 安装包时，额外设置 `CODEXHOST_TEST_ZCODE_PROFILE=process`；测试在临时原生目录写入仅指向本地 HTTP fixture 的 `provider_config.json`，不读取或修改用户 Provider 配置。例如 Git Bash：

```sh
CODEXHOST_TEST_ZCODE_RUNTIME='D:/program/Zcode' CODEXHOST_TEST_ZCODE_PROFILE=process \
  npx vitest run --config tests/vitest.config.js packages/adapters/zcode/test/native.test.ts
```

Windows `3.12.3` 已通过上述原生测试。覆盖检查不新增持久化 Session、流式请求、工具审批、问题、实际文件写入与 diff、取消后续聊、恢复、配置切换、分叉不改文件、回退、压缩、Goal、子代理，以及工具进程委派环境和 Skill 发现。默认测试会跳过这一文件；需要显式运行才能声称通过原生验证。
