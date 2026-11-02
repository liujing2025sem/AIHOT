import { IntentLink } from "../../components/ui/IntentLink";
import { AsideCard } from "../../components/ui/Page";
import { IconChevronRight, IconDoc, IconPlug, IconList } from "../../components/icons";

const entries = [
  { to: "/admin/studio", title: "采编工作台", note: "选素材、写稿、校对与发布", icon: IconDoc },
  { to: "/admin/channels", title: "API 渠道", note: "配置采编使用的模型与接口", icon: IconPlug },
  { to: "/admin/sources", title: "信源管理", note: "维护来源、采集方式与启用状态", icon: IconList },
];

/** The same management destinations stay within reach above the feed on phones. */
export function StudioRail({ compact = false }: { compact?: boolean }) {
  if (compact) return (
    <nav aria-label="采编与管理" className="flex items-center gap-1 border-b border-line-soft pb-2">
      {entries.map(({ to, title, icon: Icon }, i) => (
        <IntentLink key={to} to={to} className={`inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-control px-1 text-[12px] font-medium transition-colors hover:bg-bg-sunk ${i === 0 ? "text-accent" : "text-ink-3"}`}>
          <Icon size={15} /><span>{title}</span>
        </IntentLink>
      ))}
    </nav>
  );

  return (
    <AsideCard title="采编工作台">
      <p className="text-[13px] leading-[1.75] text-ink-3">把行业线索整理成可用的内容。</p>
      <IntentLink to="/admin/studio" className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-control bg-accent px-3.5 py-3 text-[13px] font-semibold text-accent-contrast transition-colors hover:bg-accent-ink">
        进入采编工作台 <IconChevronRight size={15} />
      </IntentLink>
      <nav aria-label="采编设置" className="mt-4 divide-y divide-line-soft border-t border-line-soft">
        {entries.slice(1).map(({ to, title, note, icon: Icon }) => (
          <IntentLink key={to} to={to} className="-mx-2 flex items-center gap-3 rounded-control px-2 py-3.5 transition-colors hover:bg-bg-sunk">
            <span className="text-ink-4"><Icon size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink">{title}</span>
              <span className="mt-1 block text-[12px] leading-relaxed text-ink-4">{note}</span>
            </span>
            <IconChevronRight size={14} className="shrink-0 text-ink-4" />
          </IntentLink>
        ))}
      </nav>
    </AsideCard>
  );
}
