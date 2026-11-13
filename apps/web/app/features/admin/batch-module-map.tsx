import { useId, useState } from 'react';
import './batch-module-map.css';

type ModuleStatus = 'code' | 'partial' | 'prototype' | 'external';
type Module = { id: string; label: string; group: string; status: ModuleStatus; result: string; next: string; sources: string[] };
export const studioModules: Module[] = [
  { id: 'materials', label: '信源与原文素材', group: 'input', status: 'code', result: '保存来源、原文快照、日期与版本，供后续核对。', next: '接入批量工作台的真实素材卡。', sources: ['packages/backend/src/studio/studio.ts', 'apps/web/app/routes/admin/studio-material.tsx'] },
  { id: 'signals', label: '搜索与询盘线索', group: 'input', status: 'partial', result: '已有搜索 CSV 与聚合买家需求入口。', next: '补自动流量回流，保留数据日期与来源。', sources: ['packages/backend/src/admin/studio-search-signals.ts', 'packages/backend/src/studio/studio-demand.ts'] },
  { id: 'questions', label: '买家问题库', group: 'input', status: 'code', result: '让文章围绕具体买家问题展开。', next: '在推荐卡显示本篇承接的问题。', sources: ['packages/backend/src/admin/studio-questions.ts'] },
  { id: 'opportunity', label: '新稿与旧页机会', group: 'plan', status: 'code', result: '选择新短讯、新解释、新教程或旧页更新。', next: '同等流量潜力下优先省时项，排序说明可展开。', sources: ['packages/backend/src/admin/studio-recommendations.ts'] },
  { id: 'pitch', label: '方向与段落计划', group: 'plan', status: 'code', result: '确定角度、范围、旧页保留段落与修改位置。', next: '把逐段计划绑定到原文高亮。', sources: ['packages/backend/src/studio/studio-pitch-v2.ts', 'packages/backend/src/studio/studio-pitch-fragments.ts'] },
  { id: 'rules', label: '写作规则中心', group: 'make', status: 'code', result: '装载直接表达、SEO 初步诊断、Humanizer 与分品牌写作方法。', next: '在目标实例安装私有规则包，保留源版本与摘要哈希。', sources: ['packages/backend/src/studio/writing-policy-bundle.ts', 'scripts/editorial-pilot-lib.ts', 'industry/writing/skills'] },
  { id: 'review', label: '主稿与事实审校', group: 'make', status: 'code', result: '生成稿件、检查事实，按绑定版本确认修改。', next: '把已有审稿接口接到本轮可回退工作台。', sources: ['packages/backend/src/studio/studio.ts', 'packages/backend/src/studio/studio-brief.ts', 'packages/backend/src/studio/editorial-gate.ts'] },
  { id: 'media', label: '封面与正文配图', group: 'make', status: 'partial', result: '已有技术图与媒体处理；本轮可试上传、改字、素材需求与历史候选。', next: '把本机候选接入服务器保存与真实媒体交付。', sources: ['packages/backend/src/studio/studio-figures.ts', 'packages/backend/src/studio/studio-draft-media.ts', 'apps/web/app/features/admin/batch-preview.tsx'] },
  { id: 'wp', label: 'WordPress 交付', group: 'deliver', status: 'code', result: '已有草稿、原页身份与影子草稿交付代码。', next: '用允许的真实任务验收，保留原站点发布设置。', sources: ['packages/backend/src/studio/studio-wordpress.ts', 'packages/backend/src/studio/studio-publishing.ts', 'packages/backend/src/studio/studio-upgrade.ts'] },
  { id: 'social', label: '社媒派生与导出', group: 'deliver', status: 'partial', result: '已有 Facebook、LinkedIn 文案派生、审阅和导出。', next: '小红书、公众号图卡与抖音脚本列为后续适配器。', sources: ['packages/backend/src/admin/studio-social.ts'] },
  { id: 'csm', label: 'CSM 多语言', group: 'deliver', status: 'external', result: '英语主稿交给独立 CSM 项目处理翻译。', next: '补交接回执与版本对应，连接状态待实测。', sources: ['docs/LIVE.md'] },
  { id: 'feedback', label: '采用记录与流量复盘', group: 'learn', status: 'partial', result: '已有审校干预、推荐采用记录与搜索数据导入。', next: '补发布后页面流量回流，区分采用、交付与实际访问。', sources: ['packages/backend/src/studio/studio-review.ts', 'packages/backend/src/admin/studio-recommendations.ts', 'packages/backend/src/admin/studio-search-signals.ts'] },
  { id: 'batch', label: '小批快审操作层', group: 'support', status: 'prototype', result: '每批 3 至 5 篇，按阶段处理；连续推进、跳过、插队、返回与撤销。', next: '你确认交互后，将这一操作层接到上述既有业务接口。', sources: ['apps/web/app/features/admin/batch-preview.tsx', 'apps/web/app/features/admin/batch-session.ts'] },
  { id: 'runtime', label: '任务、预算与权限', group: 'support', status: 'code', result: '持久任务队列、模型预算、管理员权限与调用回执支撑生产。', next: '沿用既有开关，实例运行与生产交付单独核验。', sources: ['docs/architecture.md', 'packages/backend/src/providers', 'packages/backend/src/jobs'] },
  { id: 'outlets', label: '站内阅读与公开出口', group: 'support', status: 'code', result: '日报、阅读页、RSS、API、MCP 与站点地图共用公开读取层。', next: '与 WordPress 渠道分开验收，按现有公开范围输出。', sources: ['packages/backend/src/publication', 'packages/backend/src/reports', 'apps/web/app/routes.ts'] },
];
export const studioEdges = [
  ['materials', 'opportunity'], ['signals', 'opportunity'], ['questions', 'opportunity'],
  ['opportunity', 'pitch'], ['materials', 'pitch'], ['rules', 'pitch'], ['pitch', 'review'],
  ['materials', 'review'], ['rules', 'review'], ['review', 'media'], ['review', 'wp'],
  ['media', 'wp'], ['review', 'social'], ['wp', 'csm'], ['wp', 'feedback'], ['social', 'feedback'],
  ['feedback', 'signals'], ['batch', 'opportunity'], ['batch', 'review'], ['batch', 'media'],
  ['runtime', 'materials'], ['runtime', 'review'], ['runtime', 'wp'], ['materials', 'outlets'],
] as const;
const statusLabel: Record<ModuleStatus, string> = { code: '已有代码', partial: '部分能力', prototype: '本轮交互原型', external: '独立项目' };
const groups = [
  ['input', '01', '准备材料与需求'], ['plan', '02', '决定做什么'],
  ['make', '03', '写作、审校与包装'], ['deliver', '04', '交付与分发'],
  ['learn', '05', '用结果改进下一批'], ['support', '支撑', '操作层与运行底座'],
] as const;

export default function BatchModuleMap() {
  const [selected, setSelected] = useState('batch');
  const detailId = useId();
  const item = studioModules.find(module => module.id === selected)!;
  const upstream = studioEdges.filter(edge => edge[1] === selected).map(edge => edge[0]);
  const downstream = studioEdges.filter(edge => edge[0] === selected).map(edge => edge[1]);
  const related = new Set<string>([...upstream, ...downstream]);
  const relationButtons = (ids: string[]) => ids.length ? ids.map(id => <button type="button" key={id} onClick={() => setSelected(id)}>{studioModules.find(module => module.id === id)!.label}</button>) : <span>当前图中无直接依赖</span>;
  return <section className="bm-map" aria-label="全模块依赖架构">
    <header><p className="bm-kicker">AIHOT · STUDIO 全貌</p><h2>这一屏，连接整条内容生产流程</h2><p>点选任一模块，查看它依赖什么、影响哪里，以及下一步接什么。状态依据本地代码，运行与部署另行验收。</p></header>
    <div className="bm-legend"><span className="bm-legend-selected">当前模块</span><span className="bm-legend-related">直接相关</span><span>浅灰为其余模块</span></div>
    <div className="bm-layout"><div className="bm-groups">{groups.map(([group, step, label]) => <section className="bm-group" key={group}>
      <h3><span>{step}</span>{label}</h3><div className="bm-cards">{studioModules.filter(module => module.group === group).map(module => <button type="button" key={module.id} aria-pressed={selected === module.id} aria-controls={detailId} className={`bm-card ${selected === module.id ? 'bm-selected' : related.has(module.id) ? 'bm-related' : ''}`} onClick={() => setSelected(module.id)}><strong>{module.label}</strong><span className={`bm-status bm-status-${module.status}`}>{statusLabel[module.status]}</span></button>)}</div>
    </section>)}</div><aside id={detailId} className="bm-detail" aria-live="polite" aria-atomic="true"><span className={`bm-status bm-status-${item.status}`}>{statusLabel[item.status]}</span><h3>{item.label}</h3><p>{item.result}</p><h4>它依赖</h4><div className="bm-relations">{relationButtons(upstream)}</div><h4>它影响</h4><div className="bm-relations">{relationButtons(downstream)}</div><h4>下一步</h4><p>{item.next}</p><details><summary>展开代码依据</summary><ul>{item.sources.map(source => <li key={source}><code>{source}</code></li>)}</ul></details></aside></div>
    <footer>当前重点：把你认可的快审交互接到已有素材、审稿与媒体接口。自动流量回流和新增社媒适配器按后续切片推进。</footer>
  </section>;
}
