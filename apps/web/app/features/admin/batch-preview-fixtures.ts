import type { CoverAngle, DirectionId, ReviewChoice } from './batch-session.ts';

export type SourceParagraph = {
  id: string;
  text: string;
  highlight?: string;
  reason?: string;
  suggestion?: string;
};

export type DemoArticle = {
  id: string;
  title: string;
  titleEn: string;
  type: '升级旧页' | '采购指南' | '技术解释' | '行业快报';
  reader: string;
  question: string;
  answer: string;
  opportunity: string;
  effort: number;
  priority: number;
  reason: string;
  directions: Record<DirectionId, { label: string; reason: string; outline: string[] }>;
  original: string;
  patch: string;
  narrowerQuestion: string;
  omitted: string;
  evidence: string;
  checklist: string[];
  body: { heading: string; text: string }[];
  sourcePage?: { url: string; label: string; paragraphs: SourceParagraph[] };
};

export function demoArticleTitle(article: DemoArticle, reviewChoice: ReviewChoice | null): string {
  return reviewChoice === 'narrow' ? `Buyer Checklist: ${article.titleEn}` : article.titleEn;
}

export const demoArticles: DemoArticle[] = [
  {
    id: 'size-guide', title: 'LED 显示屏尺寸，买家到底该怎么选？',
    titleEn: 'How to Choose an LED Display Size for Your Space', type: '升级旧页',
    reader: '准备安装室内或户外 LED 屏的采购负责人',
    question: '场地已经定了，怎样把可用尺寸变成可询价的屏幕方案？',
    answer: '先区分安装空间、可视区域和内容比例，再把观看距离、安装限制与交付尺寸交给供应商核对。',
    opportunity: '优先验证', effort: 4, priority: 3,
    reason: '先补已有指南的采购决策路径。流量潜力是演示分组，尚未读取实时搜索数据。',
    directions: {
      answer: { label: '给买家一条选尺寸路径', reason: '推荐。让采购看完就知道询价要提供什么。', outline: ['可用空间与屏幕净尺寸', '内容比例如何影响尺寸', '询价前要交给供应商的资料'] },
      scenario: { label: '从一面待安装的墙开始', reason: '用场地场景带出尺寸和安装限制。', outline: ['确认墙面与安装位置', '按内容用途比较方案', '在报价前核对现场条件'] },
      compare: { label: '比较两种尺寸方案', reason: '适合已经拿到初步方案的买家。', outline: ['相同宽度，不同画面比例', '可视面积与维护空间', '如何比较供应商的尺寸表'] },
    },
    original: 'A larger LED screen always gives every viewer a clearer image.',
    patch: 'Choose the display size together with viewing distance, content size and the available installation space.',
    narrowerQuestion: '买家询价前应提供哪些场地尺寸和内容信息？',
    omitted: '本篇先不推荐具体屏幕尺寸，也不承诺观看效果。',
    evidence: '演示核对项：原句把屏幕变大直接等同于看得更清楚，缺少观看距离和内容条件。这里未加载真实信源。',
    sourcePage: {
      url: 'https://example.com/led-display-size-guide',
      label: '示例 URL 与原文，用于展示旧页优化流程；待接入实际页面。',
      paragraphs: [
        { id: 'source-intro', text: 'Choosing an LED display starts with the space you have available. Measure the wall and select a screen that fits.', highlight: 'Measure the wall and select a screen that fits.', reason: '安装空间、可视区域和维护净空混在一起，采购难以拿这句话去询价。', suggestion: '将可视区尺寸、整体安装尺寸和维护净空分别列出。' },
        { id: 'source-viewing', text: 'A larger LED screen always gives every viewer a clearer image. Choose the biggest size that your budget allows.', highlight: 'A larger LED screen always gives every viewer a clearer image.', reason: '观看距离和内容字号缺失，原句给出了过度承诺。', suggestion: '同时核对观看距离、内容字号、内容比例和可用安装空间。' },
        { id: 'source-enquiry', text: 'Contact a supplier for a quotation and further information.', highlight: 'Contact a supplier for a quotation and further information.', reason: '读者缺少下一步要准备的具体资料，转化入口不够清楚。', suggestion: '增加现场照片或图纸、观看位置、内容样例和安装限制的询价清单。' },
      ],
    },
    checklist: ['Can the drawing label the visible screen area and the overall installed dimensions separately?', 'Which site dimensions, viewing positions and clearance requirements should I provide?', 'How will the proposed aspect ratio handle my typical content?'],
    body: [
      { heading: 'Start with the usable space', text: 'Record the available width and height, then identify clearance, structural limits and maintenance access. Keep the visible display area separate from the overall installed dimensions.' },
      { heading: 'Match the content to the display', text: 'Tell your supplier whether the screen will show presentation slides, advertising, live video or a mix. Ask how the proposed aspect ratio handles your typical content.' },
      { heading: 'Prepare an enquiry that can be quoted', text: 'Share a site drawing or photo, the intended viewing positions, installation location and content examples. Request a drawing that labels both display dimensions and required clearances.' },
    ],
  },
  {
    id: 'maintenance', title: '店铺靠墙安装，前维护够不够？',
    titleEn: 'Front-Service LED Displays: What to Check Before Installation', type: '采购指南',
    reader: '空间有限的零售项目采购与安装团队',
    question: '背后没有检修通道，前维护方案还需要确认什么？',
    answer: '把模组、供电、接收卡和线缆分别列清，确认每项的更换路径及工具空间。',
    opportunity: '值得测试', effort: 3, priority: 2,
    reason: '与下一篇属于同一演示流量组，准备时间更短，所以排在前面。',
    directions: {
      answer: { label: '直接给安装前核对清单', reason: '推荐。把“前维护”拆成可核实的部件和动作。', outline: ['哪些部件能够从前面更换', '拆装和安全空间', '验收时演示一次维护'] },
      scenario: { label: '从靠墙安装的限制讲起', reason: '让采购看懂通道不足的实际影响。', outline: ['检查现场空间', '查看供电与线缆路径', '确认维护工具与流程'] },
      compare: { label: '前维护与后维护怎么比', reason: '比较条件，不给所有项目同一个答案。', outline: ['检修路径比较', '安装空间比较', '用现场条件选方案'] },
    },
    original: 'Front service removes the need to check the space around the screen.',
    patch: 'Front service still requires clearance for removal, access to components and a safe maintenance procedure.',
    narrowerQuestion: '采购应如何确认一块屏的前维护范围？',
    omitted: '先不判断现有墙面能否安装，保留现场测量和结构确认。',
    evidence: '演示核对项：前维护描述需要明确部件范围和操作空间。真实产品的维护方式必须按对应规格书确认。',
    checklist: ['Which modules, power supplies, receiving cards and cables can be serviced from the front?', 'What tools and working clearance are required for each maintenance task?', 'Can the installation team demonstrate component removal and replacement during handover?'],
    body: [
      { heading: 'Ask which components are front-serviceable', text: 'Confirm access to modules, power supplies, receiving cards and cabling separately. A broad front-service label is not a replacement for the product-specific maintenance procedure.' },
      { heading: 'Keep enough working space', text: 'Ask the installation team to show how a component is removed and replaced. Include tools, temporary supports and a safe working area in the site review.' },
      { heading: 'Make the handover practical', text: 'Request the relevant maintenance documents and an agreed demonstration during handover. Record any task that needs a different access route.' },
    ],
  },
  {
    id: 'power', title: '报价里的最大功耗，能直接算电费吗？',
    titleEn: 'LED Display Power Consumption: What Your Electricity Estimate Needs', type: '技术解释',
    reader: '需要估算运营电费的广告屏采购者',
    question: '拿到功耗参数后，怎样提出一份有条件的电费估算？',
    answer: '分开看最大功率、典型使用条件、运行时长和当地电价，避免把功率直接当成用电量。',
    opportunity: '值得测试', effort: 5, priority: 2,
    reason: '与前维护题同组。需要补充计算条件，预计人工比较时间更长。',
    directions: {
      answer: { label: '先解释电费需要哪些输入', reason: '推荐。让买家知道缺什么，再讨论结果。', outline: ['功率和用电量的区别', '询问使用条件', '列出估算输入与边界'] },
      scenario: { label: '从一份报价表读功耗', reason: '贴近采购看到参数时的疑问。', outline: ['识别最大功率字段', '核对典型条件', '提出需要补充的问题'] },
      compare: { label: '最大值与使用值分别做什么', reason: '比较两种数据的用途。', outline: ['供电设计用什么', '费用预算用什么', '缺少条件时如何表达'] },
    },
    original: 'Use the maximum rated power as the exact electricity cost for normal operation.',
    patch: 'Treat maximum rated power and operating energy separately. Estimate electricity cost with documented operating conditions, runtime and the applicable tariff.',
    narrowerQuestion: '向供应商询问电费估算时，必须补齐哪些输入？',
    omitted: '不计算具体电费，也不推断本产品的典型功耗。',
    evidence: '演示核对项：功率与电量不能混用；输入条件不完整时，不能给出确定电费。本演示不包含实际产品参数。',
    checklist: ['Does the quoted figure describe maximum rated power or measured operating power?', 'Which brightness setting, content and measurement conditions apply to the operating figure?', 'What runtime and local electricity tariff should be used for the estimate?'],
    body: [
      { heading: 'Separate the two questions', text: 'Maximum rated power helps describe an electrical requirement. Electricity use over time depends on the operating conditions and hours of use.' },
      { heading: 'Ask for the conditions behind the figure', text: 'Request the brightness setting, content conditions and measurement basis behind a stated operating power figure. Keep these conditions beside the estimate.' },
      { heading: 'Keep the estimate transparent', text: 'List the documented power input, planned runtime and electricity tariff. If an input is missing, show the gap instead of presenting an unsupported total.' },
    ],
  },
  {
    id: 'camera', title: '舞台屏刷新率高，拍摄就不会闪吗？',
    titleEn: 'Camera-Ready LED Displays: Questions Beyond Refresh Rate', type: '技术解释',
    reader: '需要直播或录制的活动项目负责人',
    question: '选舞台 LED 屏时，怎样把相机拍摄效果纳入验收？',
    answer: '把相机、拍摄设置、控制链路和测试画面列入联合测试，不用单个指标替代实际拍摄验证。',
    opportunity: '待补证', effort: 4, priority: 1,
    reason: '先保留具体买家问题，真实流量和拍摄证据都需要补齐。',
    directions: {
      answer: { label: '给出拍摄前的测试清单', reason: '推荐。把指标转成可执行的验收动作。', outline: ['约定相机和拍摄设置', '使用实际控制链路', '记录测试结果与限制'] },
      scenario: { label: '从彩排时的拍摄问题讲起', reason: '让项目经理看到测试的必要性。', outline: ['准备彩排测试', '观察典型画面', '共同确认可用设置'] },
      compare: { label: '参数承诺与实拍验收怎么比', reason: '帮助采购比较不同报价中的证据。', outline: ['参数能说明什么', '实拍能验证什么', '写清验收条件'] },
    },
    original: 'A high refresh rate guarantees flicker-free footage with any camera.',
    patch: 'Evaluate camera performance with the intended camera settings, display configuration and signal chain under representative test conditions.',
    narrowerQuestion: '租赁舞台屏需要安排哪些拍摄验收项目？',
    omitted: '不保证任意相机下无闪烁，也不指定未经测试的参数。',
    evidence: '演示核对项：不能把单个刷新率指标写成所有拍摄条件下的保证。上线内容需补真实技术资料或测试结果。',
    checklist: ['Which camera and shooting settings will be used in the acceptance test?', 'Will the test use the intended display configuration, signal chain and representative content?', 'How will the team record observations and retain the working configuration?'],
    body: [
      { heading: 'Agree on a practical test', text: 'Use the camera and planned shooting settings for the event. Include representative display content and the intended control chain in the test.' },
      { heading: 'Record conditions alongside results', text: 'Keep the display configuration, camera settings and observations together. A result from a different setup should not be treated as a guarantee for the new event.' },
      { heading: 'Make acceptance specific', text: 'Agree on the test conditions and the way results will be reviewed before the event. Retain the working configuration for the production team.' },
    ],
  },
  {
    id: 'hot-topic', title: '临时热点：新控制器发布，买家先看什么？',
    titleEn: 'A New LED Controller: What Buyers Should Verify First', type: '行业快报',
    reader: '正在比较控制系统的采购者',
    question: '看到新品发布后，怎样判断是否值得进一步评估？',
    answer: '先核对官方型号、发布日期、兼容条件与现有项目需求，再决定是否进入测试。',
    opportunity: '热点示例', effort: 2, priority: 0,
    reason: '这条虚构热点只用来演示插队与恢复，不代表实际新闻。',
    directions: {
      answer: { label: '先给新品核对清单', reason: '推荐。保留信息边界，不把发布即等同可用。', outline: ['确认发布与型号', '核对兼容条件', '安排项目测试'] },
      scenario: { label: '从现有项目是否要换开始', reason: '把新品信息放回买家的使用条件。', outline: ['现有项目的限制', '新品相关变化', '还需要验证的条件'] },
      compare: { label: '新旧方案该比较什么', reason: '先比较字段，不编造具体参数。', outline: ['列出当前配置', '检查新增能力', '保留验证问题'] },
    },
    original: 'The newly announced controller works with every existing LED display.',
    patch: 'Check the manufacturer’s compatibility information and validate the intended configuration before selecting a new controller.',
    narrowerQuestion: '买家评估新控制器前需要核对哪些兼容信息？',
    omitted: '不讨论未核实的性能提升或上市时间。',
    evidence: '虚构热点演示。没有真实发布方、日期、型号或来源。禁止将本演示作为新闻使用。',
    checklist: ['What is the exact product model and official announcement?', 'Which display, receiving system and signal sources does the manufacturer list as compatible?', 'What validation is required for the configuration in my project?'],
    body: [
      { heading: 'Verify the announcement', text: 'Identify the exact model and official announcement before using the update in a purchasing decision.' },
      { heading: 'Check the intended configuration', text: 'Review compatibility information for the display, receiving system and signal sources in your project.' },
      { heading: 'Keep validation separate from the announcement', text: 'Arrange testing for the planned setup. An announcement alone does not establish suitability for every installation.' },
    ],
  },
];

export const demoCatalog = Object.fromEntries(demoArticles.map(article => [article.id, article]));
export const defaultBatchIds = demoArticles.filter(article => article.id !== 'hot-topic')
  .sort((a, b) => b.priority - a.priority || a.effort - b.effort).map(article => article.id);

export const coverAngleLabels: Record<CoverAngle, string> = { product: '产品细节', scene: '使用场景', diagram: '结构示意' };
const coverBriefs: Record<string, Record<CoverAngle, string>> = {
  'size-guide': { product: '提供 LED 屏正面全景，能看清可视区域边界；另附外形尺寸图。', scene: '提供实际场地的屏幕与后排观看位置，保留人物或门窗作为比例参照。', diagram: '标出可视区、整体安装尺寸和维护净空，尺寸数值由项目资料确认。' },
  maintenance: { product: '提供前维护模组拆装照片，露出工具、吸取位置和对应部件。', scene: '提供靠墙安装的真实场景，能看清人员站位与维护操作空间。', diagram: '用部件示意标出模组、电源、接收卡与线缆的检修路径。' },
  power: { product: '提供箱体、AC 电源入口与电表的同框照片，保留清晰设备主体。', scene: '提供广告屏运行现场和电量测量环境，测量条件写在图片说明中。', diagram: '将屏体、AC 输入、电表和运行时长连成简洁示意，文字只用短标签。' },
  camera: { product: '提供屏体与现场摄影机同框照片，展示真实拍摄设备。', scene: '提供舞台彩排现场，保留 LED 屏、相机与拍摄位置。', diagram: '以短标签标出相机设置、LED 屏、控制链路和测试画面。' },
  'hot-topic': { product: '提供发布方授权的控制器产品图，型号需与官方公告一致。', scene: '提供控制器连接真实项目设备的场景，保留相关连接关系。', diagram: '按官方兼容信息画出控制器、接收系统和信号源，不添加未核实功能。' },
};

export function coverSuggestion(article: DemoArticle, angle: CoverAngle): string {
  return coverBriefs[article.id]?.[angle] ?? '提供主体清晰、拥有使用授权的图片素材。';
}
