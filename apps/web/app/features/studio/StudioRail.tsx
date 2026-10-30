import { IntentLink } from "../../components/ui/IntentLink";
import { AsideCard } from "../../components/ui/Page";
import { IconChevronRight } from "../../components/icons";

const entries = [
  { to: "/all", title: "全部资讯", note: "搜索、筛选，回看已有素材" },
  { to: "/daily", title: "日报与往期", note: "日报、周报、月报的阅读入口" },
  { to: "/hot", title: "热点榜", note: "多来源事件与讨论走势" },
  { to: "/topics", title: "主题目录", note: "浏览已有主题与关联内容" },
  { to: "/starred", title: "我的收藏", note: "保存在当前浏览器的阅读线索" },
  { to: "/more", title: "我的工作台", note: "外观、工具与个人阅读设置" },
];

export function StudioRail() {
  return (
    <>
      <AsideCard title="Studio 工作台">
        <nav aria-label="Studio 工作台" className="-mx-2 -mb-2 divide-y divide-line-soft">
          {entries.map((entry) => (
            <IntentLink key={entry.to} to={entry.to} className="flex items-center gap-3 rounded-control px-2 py-3 transition-colors hover:bg-bg-sunk">
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium text-ink">{entry.title}</span>
                <span className="mt-1 block text-[12px] leading-relaxed text-ink-4">{entry.note}</span>
              </span>
              <IconChevronRight size={14} className="shrink-0 text-ink-4" />
            </IntentLink>
          ))}
        </nav>
      </AsideCard>
      <AsideCard title="内容管理">
        <p className="text-[13px] leading-[1.75] text-ink-3">管理信源、检查内容和运行情况，请登录原有后台。</p>
        <IntentLink to="/admin" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">进入管理后台 <IconChevronRight size={14} /></IntentLink>
        <p className="mt-2 text-[11.5px] text-ink-4">仅管理员可访问管理数据。</p>
      </AsideCard>
      <AsideCard title="当前内容说明">
        <p className="text-[12.5px] leading-[1.8] text-ink-3">本机编辑试验稿保留原有标记。日报与热点以实际数据为准；分类和主题仍含框架示例，LED 行业目录尚待配置。</p>
        <IntentLink to="/changelog" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">查看更新与接入范围 <IconChevronRight size={14} /></IntentLink>
      </AsideCard>
    </>
  );
}
