# 账号与额度设置

在 codexhost 的「设置 → 账号」统一查看各 Harness 的账号与额度。Codex 托管账号使用一份正式会话存储和一个受管主后台；设置页登录使用独立短命后台。其他 Harness 的认证和切换仍由其原生客户端管理。

> 账号管理要求文件式认证、无 API Key 环境覆盖及所需原生协议能力，不使用精确版本白名单。简化实现的代码、真实账号及跨平台 Desktop 验证待完成；旧实现的验证不能沿用。此功能只保全正式 home 的历史，不提供其他 home 的历史合并。

切换时记录当前窗口的本地 Codex Thread ID，成功且界面可用后通过原生入口打开同一 Thread；切换失败不导航，用户导航、超时或卸载结束恢复。

## 账号列表

页面只有一张「账号 / 5 小时额度 / 7 天额度 / 管理」表格。窄窗口下每个账号独立排列，两个额度窗口并排，最窄布局再纵向堆叠。视觉沿用原设置外壳：淡紫色终端标记、无边框搜索、行内默认操作与紧凑的管理入口。工具栏的「账号」数量包含已保存的 Codex 账号和实际返回的其他 Harness 账号，不随搜索筛选改变。

- 主标题显示完整邮箱或账号名称，单行省略并可悬停查看完整身份；Agent 名称、真实套餐与「Codex 当前」标记作为次级信息，不显示本地 `CODEX_HOME` 路径。
- 搜索按邮箱、账号名称、Agent 或套餐筛选整个列表，仅在两类账号都不匹配时显示一个空状态。Codex 按 Host 返回顺序在前，其他 Harness 通常按稳定的 Harness ID 顺序排列，Antigravity CLI 固定放在这些 Harness 的最后；不按剩余额度或当前状态重排。
- 5 小时与 7 天额度分别对齐比较；周额度归入 7 天列。缺少的窗口仅显示「—」，不补成已用 0% 或剩余 100%。月额度、模型组及产品专属额度在账号信息下独立具名显示，不冒充全账号总额度，也不合并或丢弃重复报告。
- 默认按「剩余」展示，也可切换为「已用」，表头同步说明口径。进度条和数字使用相同口径，风险颜色仍按已用比例判断：70% 起警示，90% 起强调。
- 每个窗口在百分比旁显示弱化的倒计时，最多两个单位：超过一天为 `6d17h`，不足一天为 `4h54m`，不足一小时为 `14m`。下方右对齐显示本地时间 `09/15 10:08`；悬停和辅助技术可读取包含年份、时区的完整重置时间。无有效重置时间时不编造日期或倒计时。
- 页面本地每分钟及重新获得焦点时更新倒计时，不重新查询 Host、不重建账号行。到点只显示「待刷新」，不会自动把额度设为 100%；关闭设置后停止计时。
- Codex 额度查询不以邮箱是否存在筛选账号；无邮箱的已保存账号仍可查询和刷新。加载、读取失败、暂无数据分别展示；失败可重试，未知数据不按 0% 处理。单个账号的请求不会阻塞其他账号的额度展示，页面关闭后的响应不会更新页面。
- Codex 套餐类型来自原生凭据中的账号信息；列表收集不代替切换时的原生认证验证，普通启动不额外验证登录。`prolite` 按当前产品对应关系高亮显示为 Pro 5x，`pro` 高亮显示为 Pro 20x；Plus、Team 等保持普通标签，`unknown` 不显示。5x/20x 是展示层映射，不改变协议原值。官方接口不提供订阅续期时间，因此不显示续期日期。

## 其他 Harness 的只读账号额度

统一列表中展示 Grok Build、agy（Antigravity）、Claude Code 当前原生认证可读取的真实额度。每行管理列标明「原生管理」，信息按钮解释其管理边界。这不是多账号管理：不提供添加、删除、切换、设为默认或重置卡操作，也不修改 Codex 当前账号。搜索和已用/剩余切换作用于所有行，刷新按钮重新查询两类额度。各 Harness 独立并行查询，任一有效结果返回后立即显示，不等待其他 Harness；全局刷新期间同样逐项恢复。

- 仅在返回有效额度窗口时显示账号。API Key、第三方 Provider、未登录、无可用数据或查询失败时不显示占位行。Host 按 Harness 缓存完成的账号检查结果 15 秒，关闭后立即重开设置页可复用该短期结果；工具栏「刷新额度」显式绕过缓存，刷新后不复用上一份账号额度，避免退出或改变认证后展示旧账号。
- 左侧展示 Harness Logo；主标题优先显示邮箱或可识别名称，Harness 名称和套餐作为次级信息。没有账号身份时以 Harness 名称为主标题，不重复名称或显示「当前登录账号」，不会猜测邮箱。邮箱按列宽省略，悬停可查看完整身份。不记录或展示账号快照更新时间；原型中的示例套餐不作为真实数据来源。
- Grok Build 复用原生 xAI OAuth 认证和 billing 查询，展示周期、重置时间及产品用量；不将其他 issuer 的 Token 发到 xAI。套餐使用比例优先读取 `creditUsagePercent`；省略时按原生规则使用旧版套餐额度 `monthlyLimit` / `used`，没有正数套餐上限但有可识别的周/月周期及有效重置时间时，按原生零用量语义展示已用 0% / 剩余 100%，保留账号行。请求失败、空配置或异常用量字段不补成 0%；不使用 `onDemandCap` / `onDemandUsed` 的按需消费金额替代套餐比例。显式配置 `XAI_API_KEY`、`GROK_API_KEY` 或 `GROK_TOKEN` 时保守地不展示保存的 OAuth 账号。此页展示 Harness 账号额度，不判定某个 Thread 的逐模型凭据或实际 Billing Source。
- agy 执行原生 `--print=/usage --output-format stream-json`，由 CLI 自己解析认证，展示实际模型组与窗口。当前该输出不提供账号邮箱或套餐，以 Harness 名称为主标题。
- Claude Code 使用 Agent SDK 0.3.220 的 `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` 主动查询，并通过 `accountInfo()` 读取身份。仅投影 `rate_limits_available` 为真且有效的套餐窗口，包括原生返回的模型独立窗口；不将 session Token、会话花费或额外用量金额混为额度百分比。当前不展示 `extra_usage` 金额。旧 SDK/CLI 不支持该实验性操作时不展示。
- 查询不需要已有 Thread，不发起 Model Turn；Claude SDK 检查使用空输入流、无工具且不持久化 Session，并在成功、失败、超时后关闭检查进程。Broker 路径转发同一个只读能力。

公共数据链路是 `HarnessAdapter.inspectAccount()` → `codexhost/harness/accounts/sources` / `codexhost/harness/accounts/inspect` → 设置页；旧 Host 仍可回退到聚合的 `codexhost/harness/accounts/list`。渐进式与聚合路由共享同一份按 Harness 的 15 秒缓存和在途请求。账号快照只有可展示身份、套餐与额度，无凭据、原生路径或原始 SDK 对象；Host 不直接依赖具体 Adapter。仅查询当前 Host 已加载插件，单插件失败或超时不会阻断其他账号的返回与展示。

## 重置卡

有重置卡快照时，在 Codex 行的管理列显示「重置卡 N 张」入口，点击可展开最近到期时间、接口提供的逐张到期清单以及「使用重置」操作。不单独占用表格列；没有重置卡数据时不显示入口，也不推断为零张。

只允许当前 Codex 账号消耗重置卡。消耗前保留确认提示，使用期间禁止重复消耗，不自动重试，结果由官方接口返回。额度重置时间与重置卡到期时间是两类独立信息。

## 全局切换、删除与登录

「切换到此账号」作用于当前 Host 的所有 Codex Thread，包括已有 Thread 的后续 Turn。切换不改变 Thread ID、历史、Model、Provider、目录或权限；不改变其他 Harness。已有上下文会随下一次请求用于新账号，账号不是独立数据空间，也不等于实际 Billing Source。

切换使用停止后端方案：进入 `changing`，拒绝新请求和重复切换，保存 A 的最新凭据，检查文件式存储及无 API Key 环境覆盖，停止自己的受管后端并等待退出，再停止当次检测到的其他 Codex 后端。退出前 Token 可能轮换，因此再保存 A，然后原子写入 B、重启，通过原生 `account/read` 和落盘身份验证后 ready。不扫描会话、Goal、队列或临时状态，不发送 Model Turn 或查询额度；旧原生 RPC 随后端退休明确失败，不排队、不自动重放。

外部停止是必要步骤：仍在运行的后端保留旧 Token，可能写回共享 `auth.json`。按 `codex`、`codex.exe` 或官方二进制 basename 匹配，以 PID／启动身份检查及有界升级终止。范围包括 VS Code／CLI，不限于当前 `CODEX_HOME` 或 app-server，会中断终端 CLI 会话；不关闭编辑器、Desktop、Host 或其他 Harness，不递归停止外部工具子进程，不追杀 IDE 自动重启的后端。任务和未保存内容可能丢失，完整运行时设置无损恢复不作保证。点击切换无额外确认弹窗。原生认证在途时提示 busy，不强行打断。设置页登录本身保持主后台运行，仅需安装新凭据时进入切换流程；退出与 recover 停止主后台但不停止外部后端。删除非当前保存账号不停止后台。Harness picker 只有一个 Codex，Composer 不提供账号选择。

切换、退出、回滚和 recover 的原生验证最多等待 10 秒，每约 200 ms 调用 `account/read {refreshToken:false}`，等待 ChatGPT 账号（退出时为空）并核对正式文件身份。暂时的空账号或读取错误不立即判失败，不强制 Token 轮换，原生 Codex 按需刷新。

失败诊断写入 Host diagnostic output 及 `<CODEX_HOME>/.codexhost-native-accounts/diagnostics.log`（`0600`、最后 200 行）。每行仅含操作、固定失败步骤、可选数字 RPC 错误码和步骤耗时；回滚失败另记 `rollback-*`，不记录任何身份、凭据、路径或错误原文。`npm start` 终端不是持久 Host stderr 日志，排查优先读取此文件；成功不增加失败行。

发生拒绝时，页面应结束等待并恢复按钮；需要重试时由用户显式发起。切换期间 Desktop 若更换内部 Request Client，响应仍应完成原请求，而不是让页面永久等待。

删除仅允许非当前保存账号，保留确认，不删除任何 Thread 或 home，也不自动选择其他账号。受控「退出登录」保存当前最新凭据后清除原生登录，已保存账号仍可再次选择；退出和删除不同。

「添加 Codex 账号」使用原生设备代码登录。在账号目录下创建私有临时 `CODEX_HOME`，以最小环境运行独立、短命的 `codex app-server`，不执行用户任务，主后台保持运行。成功后保存凭据：当前 A 添加不同 B 只保存 B；此前未登录或重登当前身份时，才通过切换流程安装。当前账号重新登录必须安装新字节，不能因为 ID 相同跳过。

Desktop 原生登录、取消和退出原样交给官方后端，不进入 Host 临时登录或切换流程。Host 不校验登录方式和未知参数，不替换 loginId，不重建原生结果、错误或完成通知。官方通知先交付 Desktop，再异步同步凭据收藏；备份失败不改变官方操作结果、不关闭原生准入，后续刷新可重试。Host 主动切换或恢复后台后，仍从正式后台读取实际身份并通知 Desktop 更新显示。

已保存账号的「登录」入口可重新获取授权，邮箱缺失不代表未认证。完成事件按本次登录操作对账，即使早于启动应答也能处理；轮询只更新快照，不凭旧邮箱推断成功。操作已经结束但完成结果未收到时，显示「登录结果未确认」，请检查已保存账号状态。

取消、10 分钟超时和迟到事件绑定本次登录操作；停止登录进程，所有结束路径均移除临时目录，不保留公开清理状态。账号已保存与 Codex 是否就绪分别展示。切换在停止后失败时，写回 A、重启并验证；回滚也失败则 Codex unavailable。`recover` 停止、重启并验证当前 `auth.json` 身份，同时重试管理初始化。没有 Journal：中断切换留下完整 A 或 B，下次收集据此对账，不重放旧操作意图。其他 Harness 保持运行。

Desktop 的 Host 连接初始化与 Codex 就绪状态分开：Codex unavailable 或正在切换时，Host 只返回自身身份、正式 home 和运行平台，不启动额外后台、不宣称认证成功，也不把 Desktop 接入认证 staging。原生请求仍受准入限制；恢复后同一个 Desktop 连接使用保留的原生初始化参数继续工作。终端会以固定原因说明启动被阻断，不输出凭据；其他 Codex 后端存在不阻断启动。

本地托管模式使用 capability-token 保护的官方 loopback listener，Desktop 客户端与一个管理连接共享主后台，然后异步初始化账号管理；管理失败不影响原生 Codex。设置页临时登录进程与主后台独立。SSH 维持远端原生单账号，不传输本地凭据。

## 存储、安全与升级边界

- Launcher 显式传递所支持的绝对 home／配置路径；指定 `CODEX_ELECTRON_USER_DATA_PATH` 时也传递 Chromium 的 `--user-data-dir`，避免只隔离部分 Electron 数据。不会把 API Key 等秘密拼入启动参数，也不把 SSH 管理环境的目录覆盖带入本地 Desktop。
- 正式 `CODEX_HOME` 规范化且固定。v3 `.codexhost-native-accounts/vault.json` 保存元数据及每个账号完整原生 `auth.json` 文本，包括当前账号；不另建长期账号 home，不持久化 current，当前身份由正式文件的 issuer／subject／workspace 推导。
- 普通 Node fs 使用目录 `0700`、文件 `0600`，以临时文件加 rename 原子写入。敏感凭据为明文，OS 权限是唯一保护；删除文件不是安全擦除。不使用 Rust 私有文件 IPC、OS keyring、进程退出记录或监督收据。
- 启动先运行共享主后台，再异步初始化管理与收集凭据；慢或损坏的 Vault 只禁用管理，损坏文件不覆盖。启动不检查 Journal 恢复门槛、不停止外部 Codex 后端。
- 启动、账号列表刷新及原生认证通知按稳定身份收集最新副本。退出保留保存账号，但不会隐式重新登录。普通列表刷新不写 `auth.json`、不重启后台、不依赖额度查询。
- 0.8.x 的 v1／v2 Vault 读取后改写为 v3。缺少可用副本的条目显示 `requiresLogin`，禁用切换并提供登录入口。
- 一次性扫描遗留 `transaction.json`、`login.json`、`login/`、`.codexhost-process*.json`、`.codexhost-writer.lock` 中的凭据副本，仅补齐缺失副本或添加未知身份，随后删除记录；不恢复旧事务或登录意图，不读取旧 OS 密钥。
- 公开 v2 快照包含 phase `ready/changing/unavailable`、`instanceId/revision`、原生推导 current、accounts（含 `requiresLogin`）、`pendingOperation` 及 `manage/switch/login/delete/logout/recover` 能力。原因仅为 `unsupported-storage`、`recovery-required`、`ssh-single-account`、`unsupported-version`；不再有 `cleanupRequired`、`legacyHistoryPreserved`、`keyring-unavailable` 或 `migration-required`。不含 Token 或私有路径，current 不代表后台可用。
- 非当前额度通过受控 WHAM 查询，不启动额外后台。OAuth 刷新有 single-flight、修改租约和凭据 CAS；缓存显示获取时间，失败使用 last-good，不把未知用量补成零。
- 除上述正式 home 内的 0.8.x 遗留记录外，不扫描旧账号登记或其他 home；其数据库、附件、记忆、队列和项目关系保持原样，不合并历史。切换不改变 Thread 的历史目录或 Harness 归属。
- 外部程序仍可能在切换后重新启动或改写共享凭据，目标文件与后台验证不等于多客户端原子切换。缩小外部停止范围、统一工作准入租约、在两种 Thread 恢复路径之间择一及重新评估非当前 OAuth 刷新均明确延后。

## 用量浮窗

用量浮窗不重复展示 5 小时和 7 天额度；额度继续由专属额度入口展示。

选择 Codex 时，用量浮窗只读显示当前 Host 的全局账号身份，而不是 Thread 的历史绑定。切换 Host 后跟随相应 Host 的状态。即使尚无 Token 用量，也可查看当前身份；其他 Harness 不显示 Codex 账号。

## 实现与验证

- `docs/codex-native-account-switching-design.md`：设计、核心参考及发布验收边界。
- `openspec/changes/implement-codex-native-accounts/evidence.md`：旧验证失效说明和简化实现待验证边界。
- `openspec/changes/implement-codex-native-accounts/tasks.md`：简化工作及未完成验证。
- `packages/host-runtime/src/account/native-codex-accounts.ts`：账号控制面、切换、退出、恢复和独立登录。
- `packages/host-runtime/src/account/native-account-store.ts`：Node fs 明文 v3 Vault 与旧格式收集。
- `packages/host-runtime/src/native-account-host.ts`：本地能力与降级组成。
- `packages/host-runtime/src/native-account-observer.ts`：原生认证后的收藏同步、Host 替换正式后台后的身份显示更新；不接管认证。
- `packages/host-runtime/src/codex-runtime/official-native-auth-activity.ts`：观察原生认证写入，防止 Host 切换中断未完成登录。
- `packages/desktop-control/src/renderer-host-response-ownership.ts`：通过原生请求生命周期保留在途 Host 响应的 Client 归属，不重发请求或解释账号操作结果。
- `packages/renderer-extension/src/settings/accounts-page.ts`：账号生命周期、查询、登录与操作。
- `packages/renderer-extension/src/settings/accounts-list.ts`：统一账号行、管理入口与重置卡展开。
- `packages/renderer-extension/src/settings/accounts-usage.ts`：额度窗口分列、额外具名额度和重置卡详情。
- `packages/renderer-extension/src/settings/accounts-reset-time.ts`：紧凑重置时间与页面本地倒计时。
- `packages/renderer-extension/src/settings/accounts-details.ts`：账号操作和原生管理说明对话框。
- `packages/renderer-extension/src/settings/harness-accounts.ts`：其他 Harness 只读账号查询状态。
- `packages/host-runtime/src/harness-accounts.ts`：公共只读账号聚合与校验。
- `packages/shared-contracts/src/harness-accounts.ts`：浏览器安全的只读快照与请求契约。
- `packages/renderer-extension/src/settings/accounts.css`：明暗主题及窄窗口布局。
- `packages/renderer-extension/test/settings/`：设置页及额度单元测试。
- `tests/e2e/renderer-settings-accounts.spec.ts`：真实设置外壳与真实渲染代码，使用隔离的模拟客户端验证布局和交互；不连接真实账号服务。
