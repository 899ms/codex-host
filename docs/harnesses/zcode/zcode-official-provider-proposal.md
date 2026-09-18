# ZCode 官方账号模型接入：背景与候选方案

> 状态：调研与候选方案，暂缓实施。保留当前 app-server 接入，不增加固定官方模型、不实现 Desktop 账号桥。
>
> 本文不代表已经支持官方账号。当前能力以 [ZCode Harness 接入](zcode-harness-integration.md)为准。

## 背景与目标

当前 ZCode Adapter 能读取自定义 API Key Provider，但用户在 ZCode Desktop 中可选择的官方 BigModel 模型没有出现在 codexhost 中。观察到的官方模型为 `GLM-5.3-Flash` 和 `GLM-5.3`，账号方案为 Start Plan（界面显示“体验”）。

目标不是只显示这两个模型名称，而是在 codexhost 的独立 Thread 中使用 ZCode Harness，并按原生账号权益及计费语义执行请求。以下目标不能混为一谈：

- **接入 ZCode Harness**：保留它的 Agent Loop、工具、权限、历史和 Native Session。
- **调用 GLM Model**：其他 Harness 也可能通过兼容的 Provider 调用 GLM，不等于接入 ZCode。
- **使用官方账号方案**：需要原生账号、权益和请求认证；另行配置 API Key 不自动继承 Desktop 中的体验额度。

当前 Adapter 在可用模型目录为空时返回 `authenticationRequired`。这是 Adapter 的错误分类，不足以证明用户未在 ZCode Desktop 登录。

## 当前接入方式

```text
Codex Desktop
    ↕ codexhost 公共 Harness 契约
ZCode Adapter
    ↕ 双向 JSON-RPC / stdin、stdout
Host Node → resources/glm/zcode.cjs app-server --stdio --surface terminal
    ↕
Model Provider
```

当前不是 ACP，不是终端输入模拟，也没有连接正在运行的 ZCode Desktop。每个已打开的 Session 独立拥有一个原生进程。

Adapter 支持两种实际接口集合：旧的工作区 Registry，以及新版进程级 Registry。只有 `workspace/readState` 明确返回方法不存在时才切换路径；不按操作系统或版本字符串判断。新版路径通过无提示词、延迟持久化的临时 Session 读取原生模型目录，随后关闭。

这解决了接口兼容问题，但没有补齐 ZCode Desktop 对官方账号的管理职责。

## 调研依据与验证边界

调查对象为 Windows ZCode Desktop `3.12.3`，内置运行时报告 `0.16.5`。以下路径相对于安装目录；ASAR 内文件及打包符号属于版本相关实现细节，不是稳定公共 SDK。

| 证据位置 | 确认的行为 |
| --- | --- |
| `resources/glm/zcode.cjs` | app-server 初始化进程级 Registry；接收账号配置同步；模型请求前通过反向 RPC 获取认证材料。 |
| `resources/config/provider/zcode-builtin.json` | 声明官方账号型 Provider、方案类型和内置模型；这些声明不等于当前账号具有可用权益。 |
| `resources/app.asar` 内 `out/host/index.js` | Desktop 解析账号连接与权益，向 Agent 同步账号配置，并提供请求认证。 |
| ASAR 内 `out/host/chunk-3CQYXRMM.js` | 原生服务客户端包含模型选择、Provider 设置、Agent 和 Session 等服务。 |
| ASAR 内 `out/preload/index.cjs` | Desktop 通过 Electron MessagePort 向 Renderer 提供原生服务连接。 |
| ASAR 内 `out/renderer/assets/styles-ou2or4Yg.js` | Start Plan 的验证码配置获取、官方 SDK 调用、请求前验证、重试和取消流程。 |

本地配置检查仅输出了 `setting.json` 中允许查看的账号体系和方案字段，确认该案例选择 `bigmodel` / `start-plan`；未读取或解密凭据文件，文档不保存用户凭据或完整配置。

已执行的隔离探测使用安装的原生运行时、临时 HOME/数据目录、空个人 Provider 配置，不进行账号同步、不发送提示词。原始 Session 快照的可用模型数为 0，临时 Session 随后成功关闭。这证明仅有内置官方 Provider 声明不会自动生成可用目录；结合代码中的账号同步流程，可解释该案例，不应归因于 Renderer 漏显示模型。

此前通过的 Windows 原生生命周期测试使用本地模拟 Provider，不能作为真实官方账号对话的验收。尚未验证外部 Adapter 连接 Desktop 服务、真实官方模型调用、验证码交互及其跨版本稳定性。调研没有重启 ZCode、开启调试端口或发送官方模型请求。

## 缺失的原生链路

### 账号权益与模型目录同步

Desktop 的原生账号服务读取账号连接、当前方案和权益，生成账号 Provider 配置，然后调用：

```text
provider/updateAccountConfig
```

同步内容包括 `revision`、`basedOnZCodeBuiltinRevision`、Provider 配置，以及 `availability`、`entitled`、`current` 等状态。Start Plan 的模型列表还会结合服务端权益数据生成。

app-server 的该账号配置来源等待调用方同步，并不因为能读取 `provider_config.json` 就自动拥有 Desktop 的账号状态。当前 Adapter 未执行这段同步。

该接口不能替代旧版任意 Provider 注册接口，也不能通过手写 `entitled: true` 让模型假装可用。

### 每次请求的认证材料

官方模型请求前，运行时通过反向 RPC 请求：

```text
interaction/requestProviderRuntimeHeaders
```

Desktop 根据原生账号状态提供 `requestAuth`。被调查版本中的主要路径为：

| 方案 | 原生认证来源 |
| --- | --- |
| Start Plan / 体验 | 账号的 ZCode JWT。 |
| 个人 Coding Plan | 对应方案的请求密钥。 |
| 团队 Coding Plan | 按组织、项目解析的请求密钥。 |

当前 `session.ts` 未处理该反向认证请求。即使先补齐目录，模型也不能因此完成请求。

### Start Plan 验证码

Renderer 从 `codingPlanSubscriptionService.getCaptchaConfig()` 获取配置，调用官方 SDK，执行无感验证或用户交互。结果通过原生响应携带验证码相关请求头：

- `X-Aliyun-Captcha-Verify-Param`
- `X-Aliyun-Captcha-Verify-Region`

代码包含发送前验证、`captcha-retry`、请求关联、排队及取消处理。不能将一次验证码结果作为长期静态配置或跨请求重复使用，也不应以自动绕过验证替代原生流程。

独立 CLI 的账号实现中，调查到的 standalone 路径明确处理 `individual-coding-plan`。其存在不证明当前 app-server 会自动继承登录，也不能作为 Start Plan 体验方案的替代路径。

## 方案比较与当前决定

| 路线 | 优点 | 约束与结论 |
| --- | --- | --- |
| 保持 app-server，使用自定义 Provider | 已有原生协议和生命周期实现，不增加 Desktop 依赖。 | 当前采用；不承诺官方体验额度。 |
| 固定两个官方模型名称 | 只需改变显示或筛选范围。 | 无法解决权益、认证、验证码，不作为接入方案。 |
| 保持 app-server，补充官方账号与认证桥 | 可以保留现有 Session 执行路径。 | 需要取得真实账号配置及逐请求认证，并处理验证码；目前没有验证可复用的外部桥，不能只复制 Token。 |
| 通过 ZCode Desktop 原生服务执行 Session | 有机会直接复用原生账号同步、认证和验证流程，减少重写账号逻辑。 | 如重启研究，优先做可行性原型；依赖已运行且已登录的 Desktop，外部连接入口尚未验证。 |
| 换为一次性 CLI 调用 | 单次输入输出简单。 | 不自动解决 Start Plan；恢复、工具审批、取消和历史仍需适配，不能作为当前完整能力的等价替换。 |
| 独立 CLI 的个人 Coding Plan 路径 | 安装包中存在相应原生实现。 | 可另行研究，但不解决本案例的体验方案，且与 app-server 的衔接未验证。 |
| 在其他 Harness 中配置 GLM API Key | 如果仅需模型，可不接入 ZCode。 | 使用该 Key 对应的认证及计费，不继承 ZCode Harness 行为或体验额度。 |

当前决定：暂缓官方账号接入，保留 app-server 和自定义 Provider；体验方案继续在 ZCode Desktop 中使用。不是已证明无法实现，而是尚未找到经验证、可维护的外部原生入口。

## 候选方案：Desktop 协作模式

以下仅描述未来原型的方向，不是已提供的配置模式。

```text
codexhost ZCode Adapter
    ↕ 用户授权的原生服务连接（入口待验证）
ZCode Desktop 原生服务
    ├─ 模型目录、账号连接和权益
    ├─ 独立 Native Session
    ├─ 请求认证
    └─ 原生 Start Plan 验证流程
```

安装包中的 `modelSelectionService`、`providerSettingsService`、`zcodeAgentService` 和相关 Session 服务是调查入口。原生 `createSession`、`resumeSession` 等流程已经包含账号配置同步。但这些服务通过 Desktop 内部的 MessagePort / ChannelServer 通信，不是现成的外部 HTTP API；服务存在不等于外部接入已可行。

优先验证完整原生 Session 服务，而不是从安装包提取凭据或复制鉴权代码。不能通过模拟聊天窗口点击、借用用户已有对话、修改 ASAR 或绑定混淆函数名来假装建立了稳定接口。若只有私有调试连接可用于实验，需明确其版本与安全限制；不得把无认证的常驻调试端口作为产品接口。

### 模型范围

首个原型可聚焦 BigModel Start Plan 中的 `GLM-5.3-Flash` 和 `GLM-5.3`，但仅作为测试及支持范围：

1. 从原生模型目录和账号状态判断是否实际可用。
2. 保留原生 Provider/Model 身份及 Thinking 选项，不只用模型名称区分。
3. 登出、权益变化或模型下架时，不继续报告可用，也不静默改用另一账号或计费来源。
4. 自定义 Provider 保持原行为，不被这两个模型的范围限制。

### Session 所有权与兼容性

- 通过原生接口创建 codexhost 自己的独立 Native Session，不复用用户正在使用的对话。
- 原生 Session 的事实来源保持唯一，不能让 stdio 和 Desktop 两套路径并发控制同一 Session。
- 如果最终需要共存两种执行路径，明确记录恢复所需的来源信息；恢复失败时不得静默换后端或创建空会话。具体表示需在原型通过后核对现有契约，不预先扩展公共协议。
- Desktop 路径关闭时只释放自身 Session、订阅和连接，不能套用现有 stdio 的进程树终止逻辑去关闭整个 ZCode Desktop。
- 验证工具审批、问题交互、取消、断线和终态去重，避免 codexhost 与 ZCode Desktop 同时响应同一交互。
- 验证工作区身份、会话级运行环境、Skills、工具进程及委派环境。不能假设 Desktop 管理的共享进程具备当前独立进程的全部语义。
- 历史、Fork、修订、文件 diff、压缩、Goal 和子代理逐项验证。不得用会回退工作区文件的旧 Fork 操作代替 codexhost 的上下文分叉。

### 验证码与安全

优先让 ZCode 的原生界面承接必要验证。需要确认 Adapter 创建的 Session 能被对应工作区的原生验证码订阅识别，验证结果能够返回同一请求。

覆盖无感通过、弹窗、取消、超时、重试、多 Session 并发和 Desktop 退出。取消后不得把迟到的认证结果提交给下一次请求。

不把 OAuth Token、API Key 或验证码结果持久化到 Host 映射、插件设置、Renderer 存储或日志。外部连接必须有明确授权和作用域；不暴露通用凭据读取接口，不伪造权益或绕过验证。真实请求可能消耗官方额度，应作为另行确认的验收步骤，而不是连接诊断自动执行的动作。

## 分阶段验证与停止条件

| 阶段 | 需要证明的事实 | 停止条件 |
| --- | --- | --- |
| 1. 连接原型 | 用户授权下能取得原生服务连接，范围可控，断开可清理，不修改安装包。 | 找不到可靠入口，或只能依赖未经授权的连接、抓取秘密及脆弱函数补丁。 |
| 2. 真实模型目录 | 能读取当前账号实际可用的官方模型，区分未登录、无权益、验证待处理和运行时故障。 | 只能硬编码目录或假设权益。 |
| 3. 独立 Session 与对话 | 创建独立 Session，完成一次经过原生认证及必要验证码的短对话。 | 只能显示模型、只能复用既有用户对话，或验证结果无法关联请求。 |
| 4. 生命周期与隔离 | 取消后继续、关闭、重连、恢复可用，且不影响其他 Desktop Session。 | 必须终止整个 Desktop，或无法确保身份、恢复及终态语义。 |
| 5. 能力回归与产品化 | 核对既有能力、账号失效、并发验证、版本兼容及旧接口回归，文档与能力声明一致。 | 仅凭一次对话成功就保留未验证的完整能力声明。 |

前三阶段通过前，不为此改造模型 Picker、搭建双后端管理层或承诺交付日期。初期仅针对已调查的本地 Windows 安装包；macOS、其他版本和远程连接需要独立验证。

## 预期代码边界

仅在原型通过并批准实施后考虑修改：

- `packages/adapters/zcode/`：原生 Desktop 连接、模型目录、Session 创建/恢复、事件及交互映射。按职责新增模块，复用语义相同的历史和输出投影。
- `adapter.ts`、`session.ts`、`transport.ts`：核对执行路径、请求分发与资源所有权，不把 Desktop 服务伪装成可随意终止的自有子进程。
- Adapter 测试：补充原生服务 fixture、失效与取消边界，保留已有双协议回归；fixture 不替代真实账号验收。
- Host/Renderer：不预先新增 ZCode 专属账号流程。如果必须由 codexhost 展示新的授权交互，先明确公共契约缺口，再评估单独扩展；不得让 Renderer 导入 Harness SDK 或 Electron 私有 API。

不改变 Rust、Host Runtime 与 Adapter 的职责边界。现阶段只保留本方案及已确认限制，没有新增执行后端或官方模型支持。
