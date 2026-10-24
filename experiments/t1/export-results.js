#!/usr/bin/env node
// Export a durable, inspectable snapshot of one completed automated T1 run.
const fs = require('fs');
const path = require('path');
const { csv } = require('./score');

const ROOT = path.resolve(__dirname, '../..');
const RUN = path.join(__dirname, 'auto-runs');
const DEST = path.join(ROOT, 'results', 't1-automated-2026-10-24');
const read = name => JSON.parse(fs.readFileSync(path.join(RUN, name), 'utf8'));
const lines = name => fs.readFileSync(path.join(RUN, name), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const sum = (xs, fn) => xs.reduce((s, x) => s + (fn(x) || 0), 0);
const mean = (xs, fn) => xs.length ? sum(xs, fn) / xs.length : null;
const pct = n => `${(100 * n).toFixed(1)}%`;
const pp = n => `${(100 * n).toFixed(1)} 个百分点`;
const money = n => `$${n.toFixed(4)}`;
const round = (n, d = 4) => n == null ? null : +n.toFixed(d);

function costs(calls) {
  return {
    records: calls.length,
    successful: calls.filter(x => x.status === 200 && !x.error).length,
    errors: calls.filter(x => x.error).length,
    prompt_tokens: sum(calls, x => x.usage?.prompt_tokens),
    completion_tokens: sum(calls, x => x.usage?.completion_tokens),
    estimated_offpeak_usd: round(sum(calls, x => x.cost_estimated?.offpeak_usd), 6),
    estimated_peak_usd: round(sum(calls, x => x.cost_estimated?.peak_usd), 6),
  };
}

function main() {
  const manifest = read('manifest.json');
  if (!manifest.automated || manifest.description_ids.length !== 30) throw new Error('Expected completed 30-case automated run');
  const descriptions = JSON.parse(fs.readFileSync(path.join(__dirname, 'auto-descriptions.json'), 'utf8'));
  const scores = read('scores.json'), analysis = read('analysis.json');
  const judge = read('image-judge-reparsed-summary.json');
  const generation = costs(lines('api-calls.jsonl'));
  const imageJudge = costs(lines('judge-calls.jsonl'));
  const arms = ['G0', 'G1', 'G2'];
  const satTest = scores.filter(x => x.split === 'test' && x.tier !== 'unsat' && arms.includes(x.arm));
  const unsatTest = scores.filter(x => x.split === 'test' && x.tier === 'unsat' && arms.includes(x.arm));
  const byArm = Object.fromEntries(arms.map(arm => {
    const sat = satTest.filter(x => x.arm === arm), unsat = unsatTest.filter(x => x.arm === arm);
    return [arm, {
      mean_gold_rate: mean(sat, x => x.gold_explicit_rate),
      test_satisfiable_rows: sat.length,
      test_unsatisfiable_rows: unsat.length,
      unsat_declared: sum(unsat, x => x.unsat_declared),
      failed: sum(scores.filter(x => x.arm === arm), x => x.failed),
      physics_counts: Object.fromEntries(['P1', 'P2', 'P3', 'P4', 'P5'].map(k => [k, sum(sat, x => x[`phys_${k}`])])),
      physics_per_river_mean: mean(sat, x => x.phys_per_river),
      physics_per_1000km_mean: mean(sat, x => x.phys_per_1000km),
    }];
  }));
  const perDescription = descriptions.map(d => {
    const row = { id: d.id, split: d.split, tier: d.tier, description: d.text };
    for (const arm of arms) {
      const r = scores.filter(x => x.desc_id === d.id && x.arm === arm);
      row[`${arm}_gold_mean`] = round(mean(r, x => x.gold_explicit_rate), 6);
      row[`${arm}_failed`] = sum(r, x => x.failed);
      row[`${arm}_unsat_declared`] = sum(r, x => x.unsat_declared);
      row[`${arm}_P4_total`] = sum(r, x => x.phys_P4);
    }
    return row;
  });
  const snapshot = {
    generated_at: new Date().toISOString(), manifest,
    completion: { descriptions: 30, samples_per_description: 3, arm_tasks_planned: 270,
      arm_tasks_completed: 269, arm_tasks_failed: 1, scored_rows_including_S0: scores.length,
      image_judge_responses: judge.responses, image_judge_originally_invalid: judge.originally_invalid,
      image_judge_still_invalid: judge.still_invalid },
    by_arm: byArm, paired_differences: analysis.pairs, image_judge: judge,
    costs: { generation, image_judge: imageJudge,
      combined_offpeak_usd: round(generation.estimated_offpeak_usd + imageJudge.estimated_offpeak_usd, 6),
      combined_peak_usd: round(generation.estimated_peak_usd + imageJudge.estimated_peak_usd, 6) },
    per_description: perDescription,
  };
  fs.mkdirSync(DEST, { recursive: true });
  fs.writeFileSync(path.join(DEST, 'summary.json'), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(DEST, 'per-description.csv'), csv(perDescription, Object.keys(perDescription[0])));
  for (const name of ['manifest.json', 'runs.csv', 'scores.json', 'analysis.json',
    'judge_pairs.csv', 'judge_pairs_reparsed.csv', 'image-judge-reparsed-summary.json',
    'api-calls.jsonl', 'judge-calls.jsonl']) {
    fs.copyFileSync(path.join(RUN, name), path.join(DEST, name));
  }
  fs.copyFileSync(path.join(__dirname, 'auto-descriptions.json'), path.join(DEST, 'descriptions.json'));
  const goldDest = path.join(DEST, 'gold'); fs.mkdirSync(goldDest, { recursive: true });
  for (const d of descriptions) fs.copyFileSync(path.join(__dirname, 'gold', `${d.id}.json`), path.join(goldDest, `${d.id}.json`));

  const armLine = arm => {
    const b = byArm[arm];
    return `| ${arm} | ${pct(b.mean_gold_rate)} | ${b.failed}/90 | ${b.unsat_declared}/9 | ${b.physics_counts.P1} | ${b.physics_counts.P2} | ${b.physics_counts.P3} | ${b.physics_counts.P4} | ${b.physics_counts.P5} | ${b.physics_per_river_mean.toFixed(2)} | ${b.physics_per_1000km_mean.toFixed(2)} |`;
  };
  const pairLine = (key, label) => {
    const p = analysis.pairs[key];
    return `| ${label} | ${pp(p.mean_difference)} | ${pp(p.ci95[0])} 至 ${pp(p.ci95[1])} | ${p.permutation_p.toFixed(6)} | ${p.holm_p == null ? '未作校正' : p.holm_p.toFixed(6)} |`;
  };
  const testLines = perDescription.filter(d => d.split === 'test' && d.tier !== 'unsat').map(d =>
    `| ${d.id} | ${d.tier} | ${pct(d.G0_gold_mean)} | ${pct(d.G1_gold_mean)} | ${pct(d.G2_gold_mean)} | ${d.G0_P4_total}/${d.G1_P4_total}/${d.G2_P4_total} | ${d.G1_failed ? 'G1 一次超时' : ''} |`).join('\n');
  const unsatLines = perDescription.filter(d => d.split === 'test' && d.tier === 'unsat').map(d =>
    `| ${d.id} | ${d.G0_unsat_declared}/3 | ${d.G1_unsat_declared}/3 | ${d.G2_unsat_declared}/3 | ${d.description} |`).join('\n');
  const judgeLines = Object.entries(judge.reparsed).map(([pair, x]) => {
    const [a, b] = pair.split('-'); return `| ${a} 对 ${b} | ${x[a]} | ${x[b]} | ${x.tie} | ${x.comparisons} |`;
  }).join('\n');
  const md = `# T1 自动题库实验详细结果（2026-10-24）

## 结论与范围

在这套事先固定的结构化自动题库中，17 条可满足留出描述的明写义务通过率为 G0 ${pct(byArm.G0.mean_gold_rate)}、G1 ${pct(byArm.G1.mean_gold_rate)}、G2 ${pct(byArm.G2.mean_gold_rate)}。G1 对 G0 提高 ${pp(analysis.pairs['G1-G0'].mean_difference)}，G2 对 G1 提高 ${pp(analysis.pairs['G2-G1'].mean_difference)}。G2 的 P4 湖泊多出口告警同时显著增加，故不能把主指标的提高解释成所有地理质量都提高。

描述与 gold 来自同一份程序化题库，没有外部作者、双人独立标注或人工仲裁。图片评审使用同一模型且没有人工校准。本报告是**探索性自动评测**，不是原定的人类编写设定的正式验证。人工满意度尚未填写。

## 设计与冻结信息

- 题库：30 条中文描述；开发集 10 条，留出集 20 条；不可满足题共 5 条，其中开发集 2 条、留出集 3 条。每条采样 3 次，G0/G1/G2 各 90 个任务；另有 S0 生成基线 90 个。
- 主指标：仅 17 条可满足留出描述。先平均同一描述的 3 次采样，再对 17 条描述取平均；失败样本计 0。
- 模型：\`${manifest.model}\`；temperature ${manifest.temperature}；thinking ${manifest.thinking}；最多 ${manifest.maxIter} 次迭代。
- 固定哈希：data \`${manifest.data_hash}\`；gold \`${manifest.gold_hash}\`；code \`${manifest.code_hash}\`。完整元数据见 [manifest.json](manifest.json)。

## 执行完整性

| 项目 | 结果 |
| --- | ---: |
| G0/G1/G2 计划任务 | 270 |
| 成功完成 | 269 |
| 失败并计 0 | 1（A14-3 G1，单次运行超过 8 分钟后中断） |
| S0 基线 | 90 |
| 自动评分行 | 360 |
| 原始地图 PNG | 359 |
| 图片评审正反顺序调用 | 356/360；缺失 4 次都涉及 A14-3 G1 |
| 图片评审原解析无效 / 重解析后无效 | 21 / 0 |

生成阶段约为本地时间 2026-10-24 11:44–16:54，历时约 5 小时 10 分钟。评分、渲染和图片评审之后依次运行。A14-3 G1 的失败记录在原始运行目录，未补抽替代样本。首次图片评审遇到 DNS 故障，后以联网运行方式续跑；中途一次响应连接终止，续跑时跳过已保存结果。原始日志保留这些错误。

## 自动主指标

| 组别 | 明写义务通过率 | 失败任务 | 不可满足题声明未满足 | P1 | P2 | P3 | P4 | P5 | 每条河 P1–P4 | 每千公里 P1–P4 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${arms.map(armLine).join('\n')}

物理计数和标准化指标只针对 51 张可满足留出图；不可满足声明只针对 9 次不可满足留出采样。G0/G1/G2 的 P4 分别为 ${byArm.G0.physics_counts.P4}/${byArm.G1.physics_counts.P4}/${byArm.G2.physics_counts.P4}。P4 统计湖泊多出口，可能包含误报，需要人工核查具体地图。其他 P 项定义见代码 [evaluate.js](../../experiments/t1/evaluate.js)。

### 描述级配对差值

| 比较 | 平均差值 | 95% bootstrap 区间 | 置换检验 p | Holm 校正 p |
| --- | ---: | ---: | ---: | ---: |
${pairLine('G2-G0', 'G2 − G0')}
${pairLine('G2-G1', 'G2 − G1')}
${pairLine('G1-G0', 'G1 − G0')}

这些检验以 17 条程序化留出描述为单位，不能补足题库同源、无人工仲裁的局限。逐次得分见 [runs.csv](runs.csv)，每项 gold 和物理诊断见 [scores.json](scores.json)，完整配对差值见 [analysis.json](analysis.json)。

### 17 条可满足留出描述

| ID | 难度 | G0 | G1 | G2 | P4 总数 G0/G1/G2 | 备注 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
${testLines}

30 条描述的文本、逐组均值、失败数和 P4 总数见 [per-description.csv](per-description.csv)；题目原文见 [descriptions.json](descriptions.json)，对应 gold 见 [gold](gold)。

### 不可满足的留出描述

\`unsat_declared\` 仅检测系统是否主动列出未满足条件，不判断声明是否完整或正确。

| ID | G0 声明 | G1 声明 | G2 声明 | 矛盾描述 |
| --- | ---: | ---: | ---: | --- |
${unsatLines}

## 图片评审

每对地图交换左右位置问两次；只有两次指向同一组才算胜，其余为平局或顺序不一致。由于 A14-3 G1 缺图，G0–G1 和 G1–G2 各少一对地图。

| 对比 | 左组胜 | 右组胜 | 平局/顺序不一致 | 地图对数 |
| --- | ---: | ---: | ---: | ---: |
${judgeLines}

首轮解析把 21 条以 \`**B**\`、\`回答：B\` 等形式开头的明确答案记为无效。运行 [reparse-judge.js](../../experiments/t1/reparse-judge.js) 后，固定规则仅重解析这些无效项，剩余无效 0 条；原始 [judge_pairs.csv](judge_pairs.csv) 保留，修正结果见 [judge_pairs_reparsed.csv](judge_pairs_reparsed.csv) 和 [image-judge-reparsed-summary.json](image-judge-reparsed-summary.json)。图片模型可能把不可满足题的矛盾误读为已满足，此指标只作补充。

## API 用量与估算费用

| 阶段 | 成功响应 | 错误记录 | 输入 token | 输出 token | 低价估算 | 高价估算 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 生成 | ${generation.successful} | ${generation.errors} | ${generation.prompt_tokens} | ${generation.completion_tokens} | ${money(generation.estimated_offpeak_usd)} | ${money(generation.estimated_peak_usd)} |
| 图片评审 | ${imageJudge.successful} | ${imageJudge.errors} | ${imageJudge.prompt_tokens} | ${imageJudge.completion_tokens} | ${money(imageJudge.estimated_offpeak_usd)} | ${money(imageJudge.estimated_peak_usd)} |
| 合计 | ${generation.successful + imageJudge.successful} | ${generation.errors + imageJudge.errors} | ${generation.prompt_tokens + imageJudge.prompt_tokens} | ${generation.completion_tokens + imageJudge.completion_tokens} | ${money(snapshot.costs.combined_offpeak_usd)} | ${money(snapshot.costs.combined_peak_usd)} |

费用按代码中的 DeepSeek 单价和 API 返回的 token 使用量估算，**不是实际账单**。生成与图片评审的保守估算上限分别设置为 2 美元和 0.5 美元。详见 [api-calls.jsonl](api-calls.jsonl)、[judge-calls.jsonl](judge-calls.jsonl) 与 [summary.json](summary.json)。

## 内存与复现

用户提供的任务管理器截图显示当时内存使用率约 83%，Codex 约 1.57 GB、Edge 约 0.93 GB、实验 Node 约 0.22 GB。图片评审期间系统可用内存多次测得约 2.6–2.8 GB / 15.73 GB，未见持续下降；实验完成后相关 Node 进程退出。没有关闭用户应用。

本目录保存题库、gold、冻结清单、全部逐次评分、API 响应日志、图片评审原始与重解析记录。完整原始运行目录（地图表示、359 张原始 PNG、30 张盲评用图片副本、失败记录等）另打包为 [raw-run.zip](raw-run.zip)；解压后得到 \`auto-runs\` 目录。原目录仍位于 [experiments/t1/auto-runs](../../experiments/t1/auto-runs)，盲评表位于 [satisfaction/rate.html](../../experiments/t1/auto-runs/satisfaction/rate.html)。原目录在 \`.gitignore\` 中，不会自动进入版本控制；本目录是可纳入版本控制的关键数据快照。两处都不包含 API 密钥。关键文件和压缩包的校验值见 [SHA256SUMS.txt](SHA256SUMS.txt)。

测试：本机 \`npm\` 命令不可用；按 \`package.json\` 中顺序逐项运行 7 个 Node 测试脚本，全部通过。重解析规则另用典型前缀样本做了断言检查。人工满意度是唯一尚未完成的补充环节：需为 10 条留出描述的 30 张盲评地图各打 1–5 分并导出 CSV；其结果不进入自动主指标。
`;
  fs.writeFileSync(path.join(DEST, 'REPORT.md'), md);
  console.log(`Saved ${DEST}`);
}

if (require.main === module) try { main(); } catch (e) { console.error(e.stack || e.message); process.exitCode = 1; }
