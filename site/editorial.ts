/** User decisions, 2026-11-01. Publishing placement is separate from product fact ownership. */
export const editorialDirection = {
  version: 'chipshow-blog/2026-11-03',
  publication_site: 'chipshow.com', placement: 'blog', public_language: 'en', review_language: 'zh',
  directions: ['driver IC', 'LED packages', 'display cabinets', 'power supplies', 'control systems', 'display applications', 'standards and industry data'],
  daily_digest: true, allow_unconfirmed: true, canonical_path: null,
} as const;

/** A review routing hint, not an exclusion rule or semantic industry classifier. */
export function editorialTopic(text: string): string | null {
  const topics: [string, RegExp][] = [
    ['ic', /驱动|\b(?:driver IC|driver chip|MBI\d|MBS\d)/i],
    ['cabinet', /箱体|维护结构|\b(?:cabinet|front maintenance|rear maintenance|chassis)\b/i],
    ['led-package', /灯珠|封装|\b(?:LED packag\w*|MiP|COB|SMD)\b/i],
    ['power', /电源|\bpower suppl\w*/i], ['control', /控制系统|\b(?:controller|control system|receiving card)\b/i],
    ['standards', /法规|标准|\b(?:regulation|standard|directive)\b/i],
    ['application', /商显|显示|\b(?:display|signage)\b/i],
  ];
  return topics.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/** Public prose is English; original URLs may retain the publisher's encoded/unencoded path. */
export function assertPublicEnglish(draft: { title_en: string; body_en: string; meta_description_en: string }) {
  for (const field of ['title_en','body_en','meta_description_en'] as const) {
    const text=draft[field].replace(/https?:\/\/[^\s<>]+/g, url=>' '.repeat(url.length));
    const hit=/[\u3400-\u9fff]+/u.exec(text);
    if(hit)throw Object.assign(new Error(`公开英文稿 ${field} 的字符 ${hit.index}–${hit.index+hit[0].length} 含中文“${hit[0]}”，请改为英文；中文说明留在内部审稿。`),{statusCode:400});
  }
}

export function editorialDirectionText() {
  return `# 当前有效编辑方向（用户决定：2026-11-01）
发布在 chipshow.com 的 Blog 内容体系；具体栏目和永久链接待当前CMS映射，不编造canonical或另建资讯域名。
Blog英文对外，中文Blog稿仅内部审稿；两版绑定同一原文版本。中文社媒和中文视频可公开，但须在独立字段、独立状态中另审另导出，不能混进Blog。P0只增加社媒，视频和下载中心P1。行业资讯覆盖IC、灯珠/封装、箱体/维护结构、电源、控制系统、应用与行业数据；户外用电只是首个试产专题，不能限制其他方向。
行业资讯可因自身阅读价值入选；未匹配既有采购问题不能单独作为淘汰理由，不强加采购追问、产品入口或CTA。
保留独立资讯、每日合并页、事件更新、专题、比较和追踪表。事件追踪变化，稿件可组合多个事件与长期资料；无固定每日八条或仅三类索引的限制。
尚未证实的消息允许报道：news_status写unconfirmed，标题、摘要、正文均保留Unconfirmed report / Reportedly等限定，列原信源与原日期；日期未知如实标明，发现日期不是发布日期。后续确认、否认或更正保留原记录。
厂商自述写According to [source]；参数属于原厂及其条件，不迁移成Chipshow产品事实。同行短讯只报事实、不评价；技术文和教程不点名比较同行，上游部件品牌可点名。标据传不能豁免BLOCK或未经授权的图片、客户资料与商务承诺。
控制软件教程必须以工程实机截图、软件版本、实际步骤和报错处理为依据；缺工程资料HOLD，模型只能整理和翻译，不补写菜单、参数或操作步骤。客户画像只作为聚合的读者需求定向，不当事实来源，不给模型单条询盘。公司能力继续以已批准公司资料为准。
GEO内容按部件/技术、应用场景、读者问题和实际观察的竞争内容缺口关联；这些是可扩展线索，不是硬性准入门槛。`;
}
