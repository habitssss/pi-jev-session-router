// Synthetic evaluation cases, not model-performance guarantees.
// The roles refer to configured descriptions, not model names or versions.
// Real classification needs an explicitly authorized live evaluation; offline
// tests only verify request construction and the safety/size contract.
export const routingBoundaries = [
  {
    id: "many-files-known-method",
    prompt: "请认真、全面地完成这次跨模块修改，务必做到最好：将给定清单中的 80 个文件里完全匹配的按钮文案‘提交’替换为‘保存’。文件清单和替换规则已明确，只做文本替换，不修改任何逻辑或样式。",
    acceptableRoles: ["execution"],
    acceptableThinking: ["off", "low"],
    rationale: "Known mechanical method; file count and emphatic wording must not trigger escalation.",
  },
  {
    id: "environment-failure-only",
    prompt: "上次没有完成 README 的一个拼写修正，唯一原因是写入时返回 EACCES，尚未开始修改。管理员已修复文件权限。现在只把明确位置的‘recieve’改为‘receive’，不做其他修改。",
    acceptableRoles: ["execution"],
    acceptableThinking: ["off", "low"],
    rationale: "A resolved permission failure is not evidence of a reasoning limitation.",
  },
  {
    id: "missing-context",
    prompt: "还是不行，继续修。",
    acceptableRoles: ["stay"],
    acceptableThinking: [],
    rationale: "No identifiable task or failure evidence; do not invent prior attempts or escalate.",
  },
  {
    id: "unknown-cause",
    prompt: "一个服务更新数据库后会失效缓存，但并发写入时偶尔返回旧值，顺序执行正常。需要阅读写入路径、缓存失效逻辑和异步回调，比较可能的执行顺序，定位原因并补回归测试。目前未做过排查，也没有失败尝试。",
    acceptableRoles: ["analysis"],
    acceptableThinking: ["medium", "high", "xhigh"],
    rationale: "An unknown cause needs analysis, but no evidence calls for the highest capability tier or maximum effort.",
  },
  {
    id: "coupled-constraints-with-evidence",
    prompt: "设计支付账本的在线迁移方案，必须同时满足跨区域重试下不重复扣款、旧客户端兼容、不停机回滚和审计顺序一致。已有测试记录：单表唯一键仍无法阻止双写阶段的重复入账；串行化事务在网络分区测试中破坏可用性；按时间戳回滚会丢失迟到事件。请解释这些方案相互冲突的原因，比较替代设计，给出不变量、故障矩阵和可验证的迁移步骤。错误会造成真实资金损失。",
    acceptableRoles: ["deep-analysis"],
    acceptableThinking: ["high", "xhigh", "max"],
    rationale: "Interacting correctness constraints and concrete failed alternatives justify direct use of the deepest-analysis role.",
  },
] as const;
