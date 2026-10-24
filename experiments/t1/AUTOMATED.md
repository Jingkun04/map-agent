# T1 自动评测版（人工满意度留到最后）

这套流程由 `automated-cases.js` 事先固定 30 条结构化描述和对应的可核查 gold：10 条开发集、20 条留出集、5 条不可满足（开发集 2、留出集 3）。描述与 gold 同源生成，`author=programmatic`；没有外部作者、双人独立标注或人工仲裁。结果只能说明系统在这套**结构化自动题库**上的表现，不能替代原方案的人类编写设定实验。图片裁判也未经人工校准，只作探索性补充。

在 `map-agent-main` 目录逐行执行：

```powershell
node experiments/t1/automated-cases.js
node experiments/t1/run.js --automated --data experiments/t1/auto-descriptions.json --out experiments/t1/auto-runs --dry-run
node experiments/t1/run.js --automated --data experiments/t1/auto-descriptions.json --out experiments/t1/auto-runs --limit 3 --max-usd 0.25
node experiments/t1/run.js --automated --data experiments/t1/auto-descriptions.json --out experiments/t1/auto-runs --max-usd 2
node experiments/t1/score.js --data experiments/t1/auto-descriptions.json --out experiments/t1/auto-runs --render
node experiments/t1/judge.js --data experiments/t1/auto-descriptions.json --out experiments/t1/auto-runs --max-usd 0.5
node experiments/t1/reparse-judge.js --out experiments/t1/auto-runs
node experiments/t1/analyze.js --out experiments/t1/auto-runs
node experiments/t1/satisfaction-pack.js --data experiments/t1/auto-descriptions.json --out experiments/t1/auto-runs --count 10
node experiments/t1/export-results.js
```

`--max-usd` 是基于公开高峰单价的**累计估算上限**，生成与裁判分开计，单个在途请求可能略超上限。输出目录保存 manifest、每阶段原始响应、token 使用量、统一地图表示、PNG、逐项 gold 得分、图片裁判正反顺序和统计汇总。程序停止后用同一命令可跳过已完成阶段。修改任何被冻结的代码或 gold 后应使用新输出目录。

自动主指标是 17 条可满足留出描述的明写义务通过率，按描述先平均 3 次采样，再比较组别；3 条不可满足留出描述单列。`unsat_declared` 仅记录系统是否声明了无法满足，不等于人工核实的诚实处理分类。`analysis.json` 中的显著性计算为探索性，不能弥补题库同源、无人工仲裁的局限。

`reparse-judge.js` 对图片裁判的已保存原文做确定性的前缀解析，处理 `**B**`、`回答：B` 等形式。它保留原始 `judge_pairs.csv`，另写 `judge_pairs_reparsed.csv` 和 `image-judge-reparsed-summary.json`；后者是图片比较的修正解析结果。中途断线后可续跑图片裁判，务必等调用结束再重解析。

最后的 `satisfaction/rate.html` 是隐藏组别的单项 1–5 分满意度表，默认选 10 条留出描述的第 1 次采样，每条显示三张图。填写后下载 CSV；`blinding-key.json` 只供结果整理者使用。满意度是补充指标，不修改已冻结的自动主指标。

`export-results.js` 从完整运行目录重建 `results/t1-automated-2026-10-24/REPORT.md`、逐题 CSV、统计 JSON，并复制关键原始日志与 gold。完整地图和运行文件已另打包为该目录下的 `raw-run.zip`；它是本次运行的一次性快照，重新运行导出脚本不会更新这个压缩包。
