# Codex 原生账号管理

## 1. 范围与支持条件

codexhost 通过替换正式 `CODEX_HOME` 的原生凭据实现全局 Codex 账号切换。Account 是认证身份，不等于 Harness、Model、Provider 或 Billing Source；不建立 Model 代理、每账号后台或 per-Thread 账号路由。

管理要求文件式认证、无 API Key 环境覆盖及所需原生协议能力，不使用精确版本白名单。SSH 保持远端原生单账号，不传输本地凭据。新实现验证待完成，见 [验证状态](../openspec/changes/implement-codex-native-accounts/evidence.md)。

## 2. 用户行为

- 设置页提供全局切换，已有 Codex Thread 后续请求使用当前账号；Thread ID、持久化历史及 Harness 归属保持。账号不是独立数据空间。
- 切换会中断检测到的本机 Codex 后端，包括 VS Code 和终端 CLI；目前不限于相同 `CODEX_HOME` 或 app-server。任务及未保存内容可能丢失，点击切换没有额外确认弹窗。
- 不重启 Desktop、Host、编辑器或其他 Harness；不递归终止外部工具子进程，也不保证工具副作用停止或回滚。
- 设置页添加 B 时主后台继续使用 A；无当前账号或重新登录当前身份时，才通过切换流程安装新凭据。同身份也必须安装新字节。
- 删除仅允许非当前保存账号，保留确认，不停止后台。退出登录保留保存副本，以后仍可选择。
- Harness picker 只有一个 Codex；Composer 只读显示当前身份，不提交 per-draft 账号选择。

从源码构建启动使用 `npm start`；macOS／Windows 启动脚本会停止正在运行的 Desktop，不用于常规文档验证。

## 3. 职责与公共边界

- Host 账号模块负责凭据集合、设置页设备代码登录、切换、退出和恢复，使用普通 Node fs；不使用 Rust 私有文件 IPC 或 OS keyring。
- `OfficialRuntimeOwner` 拥有主 app-server、Desktop 与管理连接、工作准入、generation 和原生订阅。
- Rust 仅提供通用原生进程及平台能力，不解释账号或 OAuth 语义；不再保留账号用进程退出记录、监督收据或私有文件协议。
- Desktop 原生认证由官方后端处理。Host 仅观察未完成认证以阻止冲突切换，并在通知后收集凭据。
- 浏览器安全公共契约不含凭据或私有路径；Renderer 只显示状态、提交操作并处理修订及导航。

## 4. 凭据与私有存储

`<CODEX_HOME>/.codexhost-native-accounts/vault.json` 使用 v3 格式，保存每个账号的元数据和完整原生 `auth.json` 文本，包括当前账号。保留原生字节及未知字段，不重建等价文档。当前身份只由正式 `auth.json` 的 issuer／subject／workspace 推导，绝不持久化独立 current 选择；邮箱或 JWT 解码不替代原生认证验证。

启动、列表刷新、原生账号通知收集正式凭据，按稳定身份新增或更新轮换后的副本。普通收集不写 `auth.json`、不重启后台、不查询额度；原生退出保留保存副本，不隐式重新登录。

### 权限与写入

使用普通 Node fs，目录 `0700`、文件 `0600`，临时文件加 rename 原子替换。凭据是敏感明文，OS 权限是唯一保护，不提供额外加密、私有文件 helper、写入者锁或 OS keyring 访问。日志、Renderer、命令参数和公开错误不得泄露凭据。删除文件不是安全擦除，SSD、备份和快照可能保留内容。

### 0.8.x 兼容清理

v1／v2 Vault 读取后改写为 v3；无可用凭据副本的条目保留元数据并显示 `requiresLogin`。一次性扫描遗留 `transaction.json`、`login.json`、`login/`、`.codexhost-process*.json` 和 `.codexhost-writer.lock` 中可用的凭据副本，仅补齐缺失副本或添加未知身份，随后删除这些遗留记录，不恢复旧操作意图、不访问旧密钥。损坏 Vault 不覆盖，账号管理 unavailable，但原生 Codex 继续工作。不扫描其他 home 或旧账号登记，不合并或删除其历史。

## 5. 运行时与启动

启动确定规范化的正式 `CODEX_HOME`，以该 home 为 cwd 启动一个 Host 拥有的官方 loopback app-server：回环地址、动态端口、capability-token 认证，Desktop 客户端与一个管理连接共享主后台。随后异步初始化账号管理；失败只禁用管理，不阻断原生使用。启动不读取 Journal 来决定是否放行，不维护进程退出记录或监督收据，不按精确版本白名单预检，也不停止外部 Codex 后端。

Host transport initialize 独立于 Codex readiness：changing／unavailable 时仍可返回 Host 身份、正式 home 和平台元数据，保留客户端协商，不宣称原生认证成功。设置页的临时登录后台不接受 Desktop 任务连接。其他 Harness 不因 Codex 故障关闭。

## 6. 切换流程

```text
进入 changing，拒绝新原生工作；原生认证在途则 busy
  → 保存 A 的最新凭据
  → 检查目标副本、文件式存储及无 API Key 环境覆盖
  → 停止 Host 主 app-server，等待进程退出
  → 停止当次检测到的外部 Codex 后端
  → 再保存 A（退出前 Token 可能轮换）
  → 原子写入 B 的 auth.json
  → 重启，以 account/read 和落盘身份验证 B
  → ready
```

不扫描 Thread、Goal、队列或临时会话；退休连接的在途 RPC 明确失败，新工作不排队、不自动重放。验证不发送 Model Turn 或额度请求。

切换、退出、回滚及 recover 的验证每约 200 ms 读取 `account/read {refreshToken:false}`，最多等待 10 秒（含无应答的读取）。目标非空时等待 `account.type === "chatgpt"`，目标为空时等待 `account === null`，再核对正式 `auth.json` 身份；暂时的空账号、类型不符、身份不符或 RPC 错误均可重试，超时使用最后观察到的失败类别。Host 不强制轮换 Token，原生 Codex 按需刷新。协议初始化成功只表示连接就绪，不等于目标账号验证成功。文件式存储及环境覆盖检查不变。

外部停止是必要步骤：存活后端保留旧 Token，可能写回共享 `auth.json`。按 `codex`、`codex.exe` 和官方二进制 basename 匹配，核对 PID／启动身份并有界升级终止。当前批次跨 `CODEX_HOME`，也不限于 app-server，会中断终端 CLI；不追杀 IDE 自动重启的实例。启动、普通关闭、退出登录、回滚及 recover 不执行此批次。Host 不能阻止其他程序随后改写凭据，成功验证不是多客户端原子切换保证。

### 失败与恢复

停止后发生失败，写回已保存的 A 凭据、重启并验证；无法确认进程退出时不冒险写入或启动竞争后台。回滚也失败则 Codex unavailable。`recover` 停止、重启并验证当前 `auth.json` 身份，同时重试账号管理初始化；不是 Journal 重放。

每个失败步骤向 Host diagnostic output 和 `<CODEX_HOME>/.codexhost-native-accounts/diagnostics.log` 各写一行 JSON，只含 operation（switch/logout/recover）、固定 step、可选数字 RPC code 和步骤 elapsedMs；验证重试只在最终失败时写一行，回滚失败另记 `rollback-*`。文件权限 `0600`，保留最后 200 行；诊断写入失败不能阻止回滚。不得记录 Token、邮箱、账号 ID、路径或原始错误文本。

`npm start` 的终端不是 Host stderr 持久日志：`run-host-runtime.ts` 使用 process.stderr，Shim 将子 Host stderr 泵送到自己的 stderr（Desktop 启动的 CLI 管道）。源码启动脚本仅继承 Launcher stderr；Launcher 就绪后脱离终端，Desktop 的进程输出也不是该终端的 Host 日志。仓库没有为此管道配置独立持久 Host stderr 文件，Desktop 如何保存由官方壳决定；排查以 diagnostics.log 为准。

不使用 Journal、提交收据或持久恢复状态机。原子替换使中断切换后的 `auth.json` 保持完整 A 或 B，下一次收集据此对账；不承诺崩溃后恢复原操作意图。

## 7. 登录与退出

### Desktop 原生认证

`account/login/*` 和 `account/logout` 原样转发，参数、loginId、结果、错误及通知均由官方解释。Host 只观察未完成认证以拒绝冲突切换，并在通知交付后异步收集凭据。收集失败不改变官方结果或关闭原生准入。

### 设置页添加／重新登录

在账号目录下创建私有临时 `CODEX_HOME`，以最小环境运行独立、短命的 `codex app-server` 进行原生设备代码登录，主后台继续运行。该进程不承载用户任务。

成功后保存凭据；当前 A 添加不同 B 仅保存 B，A 不变。无当前账号或重登当前身份时，使用第 6 节切换流程安装新字节。取消或 10 分钟超时停止登录进程，所有结束路径均移除临时目录，不保留 staging 恢复意图或公开清理状态。完成与取消关联本次操作及原生 loginId，不凭邮箱推断成功；已保存与后台是否可用是不同事实。

### 设置页退出与删除

退出使用无目标凭据的切换流程，但不停止外部后端：保存当前凭据，停止主后台，再保存最新副本，清除原生登录、重启并验证无当前身份。保存账号仍可选择。删除仅修改非当前账号的保存集合，不停止后台、不删除 Thread 或 home、不自动切换账号。

## 8. Thread、响应与公开状态

后台替换产生新 generation，旧响应及通知不能污染新代次。Owner 保留原生初始化和订阅参数，通过原始 Thread ID 懒执行 `thread/resume`，不复制历史或重放 Turn；失败明确报告。Renderer 在成功切换后经原生入口重新打开选中的本地 Codex Thread；用户导航、超时、拒绝或卸载结束恢复。临时内容及完整运行时设置不保证无损恢复。在途账号应答仍归原 Request Client，不重复提交操作。

v2 快照包含 phase `ready/changing/unavailable`、`instanceId/revision`、原生推导 current、accounts（含 `requiresLogin`）、`pendingOperation` 及能力 `manage/switch/login/delete/logout/recover`。能力原因仅为 `unsupported-storage`、`recovery-required`、`ssh-single-account`、`unsupported-version`；后者表示缺少所需协议能力，不是版本白名单。移除 `cleanupRequired`、`legacyHistoryPreserved`、`keyring-unavailable` 和 `migration-required`。current 不代表后台已就绪，busy 是操作错误。

## 9. 额度与明确延后项

额度不变：当前账号使用官方 `account/rateLimits/read`；非当前账号使用 WHAM 和每账号 single-flight OAuth 刷新保存凭据，绝不安装到正式 home 或启动额外后台。保留现有身份校验、并发写入保护与 last-good 缓存；失败不补零，只有当前账号可以消费重置卡，消费不自动重试。

以下未完成，明确延后：统一 `OfficialWorkGate` lease kinds；在 Owner 懒恢复与 Renderer 导航恢复之间择一；将外部停止范围缩小到同 `CODEX_HOME`／仅 app-server；重新评估非当前账号 OAuth 刷新。

## 10. 来源与验证

原生凭据封装和非当前账号额度读取参考 opencodex `2d4d7a22381a2e497c2442902104619e25f937c7`。复用代码保留 [MIT 许可证](../third-party/opencodex.LICENSE)，发行包包含来源声明。reference 仓库不是构建或运行时依赖。

旧验证针对已移除的事务／恢复实现，不作为简化实现通过的证据。新实现的代码、真实账号、平台和 Desktop 验证均待完成，见 [验证状态](../openspec/changes/implement-codex-native-accounts/evidence.md) 与 [任务清单](../openspec/changes/implement-codex-native-accounts/tasks.md)。
