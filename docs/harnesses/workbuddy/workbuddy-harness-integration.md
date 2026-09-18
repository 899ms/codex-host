# WorkBuddy native Harness plugin

WorkBuddy 作为独立的 `workbuddy` Harness 运行 WorkBuddy AI 随应用分发的原生 CLI。插件选择 CLI 公开的标准 ACP stdio 接口，而不是控制 WorkBuddy Desktop、模拟它的私有身份，或把独立 CodeBuddy 安装重命名为 WorkBuddy。

## 接口选择与已确认版本

本集成在 macOS 上检查了 **WorkBuddy AI 5.5.2**。应用内置 CLI 的包版本为 **CodeBuddy 2.137.1**，路径为：

```text
/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy
```

内置 `product.json` 将产品、认证端点和应用数据目录配置为 WorkBuddy；内部 CLI 入口仍名为 `codebuddy`，不表示它应被发现为独立的 `codebuddy` Harness。插件通过此固定的 WorkBuddy 应用路径发现 macOS 安装，不自动回退到 PATH 中的 CodeBuddy。macOS 用户只需安装 WorkBuddy AI App，不需要另外全局安装 CLI，也不要求 App 窗口保持运行；上述文件路径是 5.5.2 的实测打包布局，不是 WorkBuddy 对外承诺的稳定路径。`CODEXHOST_WORKBUDDY_COMMAND` 可显式选择一个可直接执行且支持 `--acp` 的 WorkBuddy CLI；显式命令无效时检查失败，不静默换用其他产品。Windows 虽有官方 App，但其内置 CLI 路径与启动约定尚未验证；Linux Desktop 路径也未验证。因此首版只在 macOS 自动发现，其他平台仅在用户已有兼容的直接可执行 CLI 并显式配置时尝试连接。

WorkBuddy 的[快速开始](https://www.workbuddy.ai/docs/workbuddy/Quickstart)描述产品安装与登录，[官方 ACP 文档](https://www.workbuddy.ai/docs/zh/cli/acp)明确以 `codebuddy --acp` 启动协议服务。CLI 的 ACP `initialize` 已在无提示、无模型请求的探测中成功，并声明 Session load 与委派相关能力；配置、取消、权限和问题流程也存在于该 CLI 的公开 ACP 接口与文档中。因此选择：

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/WorkBuddy AI.app/Contents/MacOS/Electron" \
  "/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy" \
  --acp
```

这是 macOS 应用内置入口的实际启动形态；显式命令覆盖仍直接追加公开的 `--acp` 参数。每个可写 Host Session 拥有一个 stdio ACP 子进程。普通 Prompt 不进入 Shell 参数，Host 只通过 ACP 请求发送内容。

## 认证与数据隔离

直接运行内置 CLI 时，其内部默认值可能回退到 `~/.codebuddy`。插件不会沿用这一跨产品默认值：它只把 `WORKBUDDY_CONFIG_DIR` 视为用户选择；没有该值时使用 `~/.workbuddy-ai`，随后强制传给子进程的 `WORKBUDDY_CONFIG_DIR` 与 `CODEBUDDY_CONFIG_DIR` 指向同一 WorkBuddy 根。这样即使普通 CodeBuddy 配置了自己的 `CODEBUDDY_CONFIG_DIR`，WorkBuddy 的历史、认证和设置也不会泄漏到该目录。WorkBuddy CLI 负责认证、原生设置、工具和 MCP 配置；codexhost 不保存、复制或推断其凭据。

只完成 `initialize` 后进行的无 Prompt `session/new` 探测返回了 `Authentication required`。CodexHost 不读取或复制 WorkBuddy Desktop 的私有登录态，因此不能依赖 GUI 登录一定可供独立 ACP 进程使用。若 ACP 要求认证，应在 Host 外启动相同产品配置和数据根的内置 TUI，然后执行官方 [`/login`](https://cloud.tencent.com/document/product/1831/137046)：

```sh
CODEBUDDY_CONFIG_DIR="$HOME/.workbuddy-ai" \
WORKBUDDY_CONFIG_DIR="$HOME/.workbuddy-ai" \
ELECTRON_RUN_AS_NODE=1 \
"/Applications/WorkBuddy AI.app/Contents/MacOS/Electron" \
"/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"
```

进入 TUI 后输入 `/login`，完成浏览器认证再重试 Harness。这里使用的仍是 App 内置 CLI，不表示需要另装一个 CLI。不要使用 Desktop owner runtime 的凭据，也不要发明 `codebuddy auth login` 命令。本轮没有接受登录提示、发送模型 Prompt 或触发付费调用，因此认证后的真实 WorkBuddy Turn 仍待验收。

## Desktop 私有运行时边界

WorkBuddy Desktop 还包含面向官方应用的 owner runtime、签名身份、租约和 Session admission/grant 流程。这些不是第三方 Harness 的公共认证接口。本插件明确不会：

- 调用 `_codebuddy.ai/activateWorkbuddyOwnerRuntime` 或构造私有 admission、grant、签名和租约元数据；
- 接管或恢复 WorkBuddy Desktop 已存在的任务；
- 冒充 Desktop 以访问 Office 能力、连接器、官方自动化或其他 owner-only 服务；
- 将 Desktop 私有登录态复制到 ACP 子进程。

公开的 `_codebuddy.ai` ACP 扩展并不都属于 owner runtime。例如问题响应使用 CLI 支持的公开 interruption 扩展；扩展命名空间及其兼容规则以[官方 ACP 扩展参考](https://cloud.tencent.com/document/product/1831/137025)为依据。插件只调用已由公开 ACP 会话声明、且为当前 Harness 行为所必需的扩展。

## 能力边界

WorkBuddy 插件复用经过验证的 CodeBuddy ACP Session 语义，但保持独立身份、命令发现和原生数据目录。能力声明只覆盖公开 ACP 进程可以表达的行为：

| 能力 | 当前行为 |
| --- | --- |
| Inspect、Create、多个 Turn、可写 Resume | 已实现。创建和恢复使用 WorkBuddy ACP Session；恢复校验 Harness 身份、cwd 与原生 Session 身份。 |
| 流式文本、Reasoning 与工具 | 按 ACP 事件投影为公共 Item；工具调用、结果和原生权限请求保持同一调用身份。 |
| Cancel | 使用原生取消；取消后的连接恢复沿用 ACP Session 的进程重建与状态恢复约束，不能把仅收到取消回执当作新 Turn 已可用。 |
| Model、Thinking、Permission Mode | 使用 ACP 返回的原生配置目录并等待原生确认，不在 Host 中硬编码 WorkBuddy 模型或权限模式。 |
| Question | 使用原生 interruption/question 流程映射到 Host Question；只调用公开会话支持的扩展。 |
| Usage | 读取原生模型请求用量。未实现账号总额度，也不把 credits 推断为美元。 |
| Native history | 从隔离的 WorkBuddy 原生历史读取当前父链，保留持久化用户消息 ID；缺失、歧义、损坏或不完整状态不会伪装成成功。 |
| Native subagents | 投影原生 Agent 子任务状态，并从同一 WorkBuddy 数据根读取受约束的只读子 Thread；派生 Session 会固定并复制已保留 Agent 结果引用的子 Transcript 前缀。这不等于获得 Desktop 私有任务或连接器。 |
| Slash commands | 暴露固定且可安全映射的 `/compact` 与 `/init`。命令目录在 Adapter 与 Session 之间保持一致；会切换 Session、脱离当前 Thread 或依赖原生 UI 的命令不通过 Host 暴露。 |
| Context compaction | `/compact` 交给原生 WorkBuddy 执行；只有原生历史持久化了成功的压缩记录才投影成功的 `contextCompaction` Item。自动压缩保留在触发它的原 Turn 内。 |
| Fork | 创建独立、可继续写入的 WorkBuddy Native Session，精确保留所选 checkpoint 及以前的完整 Turn。支持同目录和跨目录，来源 Session 不被修改。 |
| Revise previous message | 通过 `rollbackLastTurn` 创建独立、可写的新 Session，并精确移除一个完整的最后 Turn；源 Session 保持不变，Model、Thinking 和 Permission Mode 会继承或采用显式修订设置。 |
| Cross-Harness delegation | 普通持久化 WorkBuddy Thread 的委派 CLI 发现、凭据传递以及创建、读取、等待、继续、取消路径已接线；这与 WorkBuddy 自身的 Agent 子任务是两套独立能力。由于尚未完成已登录 WorkBuddy 的递归调用验收，README 暂不标记支持。 |
| Images | 当前公共 Turn 输入仍为文本；CLI 声明图像能力不等于 Host 已提供图片输入。 |

上述“已实现”表示 Adapter 的协议和公共契约路径已接线，不表示本轮完成了认证后的付费在线验收。尤其是 Model 目录、权限名称、历史格式和子 Agent 事件仍须在已登录的目标账号与实际 WorkBuddy 版本上复核；运行时以原生响应为准，不把 2.137.1 的观察结果硬编码为永久产品能力。

### Fork、跨目录 Fork 与修订边界

WorkBuddy 2.137.1 对标准 ACP `session/fork` 返回 `Method not found`，所以本集成不会虚构一个标准 ACP Fork。派生流程组合该版本公开 CLI 的 `--resume ... --fork-session` 管理模式、原生 `/fork` 和公开 `_codebuddy.ai/session/rollback` 扩展：先生成不调用模型的临时原生副本，再由目标目录中的 WorkBuddy ACP Session 执行原生 Fork，最后回滚到请求的精确 Turn 边界。所有模型工作仍由最终的 WorkBuddy Native Session 承担。

原生 `session/load` 只在当前项目存储中按 Session ID 查找，不能直接跨项目加载来源 Session。跨目录 Fork 因此把上述原生临时副本的完整字节，以排他创建和仅当前用户可读写权限桥接到目标项目；目标 `/fork` 成功后，只在文件仍与适配器创建内容完全一致时删除这份桥接文件。原生 CLI 在来源项目创建的临时副本没有公开删除 API，可能保留在 WorkBuddy 数据目录中；适配器不会绕过原生所有权直接删除它。

`--fork-session` 和原生 `/fork` 都不会复制 `<sessionId>/subagents/*.jsonl`。对于保留前缀中的 Agent 结果，适配器按 `callId` 关联调用，通过结构化的 `subAgent.sessionId` 与包含式 `lastId` 确定子 Transcript 边界，再把精确前缀以排他创建和 `0600` 权限复制到最终 Session。它不会依赖跨 Session 全局扫描到来源 sidecar；来源删除后派生 Session 仍可独立读取。源文件、目标文件、内部 Session 身份、字节数、行数、SHA-256 与历史 cwd 均被复验，符号链接、歧义、越界范围、并发变化或非精确的已存在目标会使派生失败。

最终 Native Ref 记录目标 cwd、目标项目 slug、继承主历史前缀，以及每个继承子 Transcript 的 provenance 和原生目标绑定记录。Resume 和后续历史读取都会重新验证这些约束；继承前缀变化、派生后的追加内容来自其他 cwd、来源在派生期间变化、checkpoint 不存在或原生回滚未精确落盘时，操作失败关闭而不是返回近似 Session。工具历史继续使用其原始 cwd 投影，因此跨目录 Fork 不会把旧命令伪装成在目标目录执行。

### 跨 Harness 委派与原生子 Agent

普通非临时 WorkBuddy ACP 进程仅在 CodexHost 已提供完整的 `CODEXHOST_CLI_PATH`、`CODEXHOST_RUNTIME_ENDPOINT`、`CODEXHOST_RUNTIME_TOKEN` 和 `CODEXHOST_THREAD_ID` 时，通过公开 `--append-system-prompt` 获得固定的 CLI 发现说明。敏感值只保留在子进程环境中，不进入参数或 Prompt 文本。WorkBuddy 调用现有 CodexHost 委派协调器后，子任务仍是普通、持久化、可恢复的 Harness Thread；Host 没有 WorkBuddy 专用委派分支。

WorkBuddy 原生 Agent 工具创建的是同一 Native Session 体系内的子 Agent，Adapter 只读投影它们的状态和 Transcript。它们不是 CodexHost 跨 Harness Thread，也不会自动获得其他 Harness 的身份或能力。

## 插件、路由与发行

插件源码位于 `packages/adapters/workbuddy`，Manifest、Adapter、Session 和 Native Ref 都使用 `workbuddy` 身份。新 Thread 使用共享 `encodeHarnessPluginRoute` 路由，不新增 WorkBuddy 专用 Host codec 或回退分支。

插件通过 `scripts/release/harness-plugins.json` 预装。构建产物只包含 Adapter Bundle、Manifest 和资源，不包含 WorkBuddy AI 应用、CLI 二进制或登录态。macOS 用户安装 WorkBuddy AI App 即获得本集成使用的内置 CLI，但仍须按需完成该 CLI 配置根的首次认证；独立插件根目录也可通过自己的 `enabled.json` 显式启用，但不能与同 ID 的预装副本同时存在。

受管 macOS Remote/SSH Host 与 CodeBuddy 一样必须先在目标 Mac 的 Aqua 登录会话安装并检查 Broker；插件不会退回 SSH 后台进程：

```sh
codexhost broker install --harness workbuddy
codexhost broker status --harness workbuddy
```

本集成的产品身份不改变原生所有权：WorkBuddy 认证、数据保留、网络访问和计费仍由 WorkBuddy CLI 负责，codexhost 负责 Thread 映射、公共事件投影和插件生命周期。

## 验证状态

本轮完成了以下无模型请求探测：

- 读取 WorkBuddy AI 5.5.2 内置产品元数据及 CodeBuddy 2.137.1 CLI 包版本；
- 通过内置 CLI 启动 `--acp` 并成功完成 `initialize`；
- 确认本机独立 ACP `session/new` 返回认证要求，集成不依赖 Desktop 私有登录态；
- 确认标准 ACP `session/fork` 不存在，并核对公开 CLI Fork、原生 `/fork` 与 rollback 扩展；
- 核对公开 ACP 能力与私有 owner runtime/admission 的边界。

没有执行登录确认、真实模型 Prompt、付费调用、危险权限、真实跨 Harness 委派、真实压缩、Fork、Resume、历史或子 Agent 的 WorkBuddy 在线验收。Fork、修订、命令、委派、Adapter、插件加载、发行 Bundle、Host 路由和 Desktop 的自动化验证使用受控 fixture；实际结果以对应变更的验证报告为准，不能由本文替代。
