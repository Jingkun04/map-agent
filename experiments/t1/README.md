# T1 批量实验代码

若只做自动评分、最后再补一个人工满意度，使用 [AUTOMATED.md](AUTOMATED.md) 的 `--automated` 流程。它与下述需要外部作者、双人 gold 和人工裁判校准的原版 T1 分开报告。

本目录把网页现有的规划、关系提议、审阅、修复和让步提示词放在 `src/agent-model.js`，命令行运行器与网页共用 `src/core.js` 和这些模型阶段。`run.js` 只生成地图；`score.js` 只读统一地图表示并打分；`judge.js` 用统一渲染图做图片比较。正式留出集实验尚需组员完成描述、双人 gold 和裁判人工校准，不能把 pilot 结果当作正式结论。

G1 现定义为**共享规划 + 地图生成 + 单轮基础物理修复**：只允许 `fill_depressions` 和 `recompute_climate` 两种规则动作，不做地点约束修复、冲突让步或多轮搜索。G2 保留完整阶段。此定义在开发集上确定，正式留出集运行前须冻结；不能根据留出集成绩再调整 G1。`replay-g1.js` 可从已保存的开发集规划离线复现新 G1，不调用 API。

## 开发集小试跑

在 `map-agent-main` 目录的 PowerShell 中逐条执行：

```powershell
node experiments/t1/run.js --data experiments/t1/pilot-descriptions.json --out experiments/t1/pilot-runs --pilot --samples 1 --max-usd 0.25
node experiments/t1/score.js --data experiments/t1/pilot-descriptions.json --out experiments/t1/pilot-runs --render
node experiments/t1/analyze.js --out experiments/t1/pilot-runs
```

`--max-usd` 按公开**高峰价**累计用量，到达上限时在下一次 API 请求前干净暂停；单个在途请求可能使估算略超上限。原始 token 用量保存在 `api-calls.jsonl`；DeepSeek 未返回实际账单金额，故 `cost_actual` 留空。停止程序或盒盖导致电脑休眠后，重跑第一行会跳过已完成的阶段；提高 `--max-usd` 可以从预算暂停处继续。某阶段标为 `.failed.json` 后不会偷偷重抽；修改代码后需换新输出目录。`--dry-run` 只检查描述和 manifest，不使用 API。

## 正式运行前的输入

1. 将全部 30 条描述保存为 `descriptions.json`，字段格式参照 `pilot-descriptions.json`；其中 10 条 `dev`、20 条 `test`、5 条 `tier=unsat`，至少 10 条 `author=external`。
2. 两名标注者分别填写 `gold/D01.A.json` 和 `gold/D01.B.json`，讨论后定稿 `gold/D01.json`；每条描述都要有三份。格式参照 `gold/P01.json`，但 pilot gold 只是代码检查样例。正式留出集地图生成之前必须定稿 gold。
3. 开发集校准统一表示、独立检查器和裁判后，固定源码、参数与数据。正式输出目录要新建，不能沿用 pilot 目录。

```powershell
node experiments/t1/run.js --data experiments/t1/descriptions.json --out experiments/t1/runs --dry-run
node experiments/t1/run.js --data experiments/t1/descriptions.json --out experiments/t1/runs --max-usd 5
node experiments/t1/score.js --data experiments/t1/descriptions.json --out experiments/t1/runs --render
node experiments/t1/analyze.js --out experiments/t1/runs
```

`run.js` 每个描述与采样保存一次共用规划、一个 S0、一个 G1、一个 G0、一个 G2。G0/G2 的顺序按样本键固定打乱。每个阶段结束后原子保存 JSON 和压缩的统一地图表示 `.rep.json.gz`；API 每次回复立即写进 `api-calls.jsonl`。`manifest.json` 检查描述、gold、代码、模型和参数哈希，防止断点续跑时混用版本。`score.js` 生成 `runs.csv`、逐义务的 `scores.json` 和同一风格的 PNG。评分器只读取 `.rep.json.gz`，不调用生成器的 `verify`。

## 裁判和人评

正式图片裁判要求先准备至少 20 张**人工逐项核对**的开发集地图：`calibration.json` 是数组，每项 `{ "id": "C01", "image": "绝对路径或工作目录相对路径", "checklist": [{ "id": "c1", "text": "地图是否东临海", "human": "pass" }] }`。`human` 可为 `pass/fail/unclear`。逐项一致率低于 80% 时程序停止两两比较。正式裁判只评 20 条留出描述，每次三对图，各问正反两次；失败/缺图的样本留空并报告。pilot 可用 `--pilot` 绕过校准，但结果只能用于接口检查。

```powershell
node experiments/t1/judge.js --data experiments/t1/descriptions.json --out experiments/t1/runs --calibration experiments/t1/calibration.json --max-usd 1
node experiments/t1/human-pack.js --data experiments/t1/descriptions.json --out experiments/t1/runs --raters 6
```

`human-pack.js` 在输出目录 `human/` 生成不显示组别的本地 HTML 表单和 `blinding-key.json`；后者只给整理结果的人，不发给评委。评分者下载 CSV 后由组员收集。程序不会自动发消息或上传问卷。

## 模型与实验边界

生成模型默认 `deepseek-flash`，关闭 thinking，温度 0.7；G2 最多 6 轮修复，结构化反馈，soft 接受变差轮次；G1 只做上述单轮物理修复。更换模型、温度、提示词或检查器会改变 manifest，需新目录。图片裁判目前可用同一个 DeepSeek 视觉模型；它与生成模型同家族，需在报告中说明，并通过人工校准检验位置偏差。`G0+` 是方案中的可选扩展，当前命令不运行，也不能据此声称排除了模型调用预算差异。
