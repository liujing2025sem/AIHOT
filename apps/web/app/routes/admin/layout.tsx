import { Suspense, useEffect, useState, type CSSProperties } from 'react';
import { SITE } from '@aihot/site';
import { Await, Link, Outlet, useLocation, useNavigation, type ShouldRevalidateFunction } from 'react-router';
import { Activity, BookOpenText, ChevronRight, CircleHelp, Files, Layers3, LogOut, Menu, Newspaper, PanelLeftClose, PanelLeftOpen, Rss, Send, Settings2, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import type { Route } from './+types/layout';
import type { AdminMe, AdminNavCounts } from '@aihot/contracts/admin';
import { NavigationProgress } from '../../components/shell/Chrome';
import { Button } from '../../components/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../components/ui/primitives/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/primitives/accordion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/primitives/tooltip';
import { Toaster } from '../../features/admin/toast';
import { isWorkbenchNavActive, workbenchNavigation, type WorkbenchNavEntry } from '../../features/admin/navigation';
import { adminGet } from '../../lib/admin.server';
import { webModules } from '../../site-modules';

export async function loader({ request }: Route.LoaderArgs) {
  const counts = adminGet<AdminNavCounts>(request, '/api/admin/nav-counts').catch((): AdminNavCounts => ({}));
  const me = await adminGet<AdminMe>(request, '/api/admin/me');
  return { me, counts, countsKey: crypto.randomUUID() };
}
export const shouldRevalidate: ShouldRevalidateFunction = () => true;
export const meta: Route.MetaFunction = () => [{ title: `${SITE.name} 编辑台` }, { name: 'robots', content: 'noindex, nofollow' }];
export const headers: Route.HeadersFunction = () => ({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Accel-Buffering': 'no' });

const icons: Record<string, LucideIcon> = { news: Newspaper, guide: BookOpenText, drafts: Files, published: Send, sources: Rss, tasks: Layers3, settings: Settings2, review: ShieldCheck, activity: Activity, ideas: Sparkles };
type Counts = Pick<Route.ComponentProps['loaderData'], 'counts' | 'countsKey'>;
function NavCount({ counts, countsKey, name }: Counts & { name?: string }) {
  if (!name) return null;
  return <Suspense key={countsKey} fallback={null}><Await resolve={counts} errorElement={null}>{(resolved: AdminNavCounts) => resolved[name] ? <span className="ml-auto rounded-full bg-accent-soft px-2 text-xs tabular-nums text-accent">{resolved[name]}</span> : null}</Await></Suspense>;
}
function NavItem({ entry, collapsed, onNavigate, counts, countsKey }: Counts & { entry: WorkbenchNavEntry; collapsed: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const active = isWorkbenchNavActive(location.pathname, location.search, entry.to);
  const Icon = icons[entry.icon || ''] || Layers3;
  const link = <Link to={entry.to} onClick={onNavigate} aria-current={active ? 'page' : undefined} aria-label={collapsed ? entry.label : undefined} className={`flex min-h-11 items-center gap-3 rounded-card px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${collapsed ? 'justify-center px-0' : ''} ${active ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-bg-sunk hover:text-ink'}`}><Icon className="size-[19px] shrink-0" aria-hidden="true"/>{!collapsed && <><span className="min-w-0 truncate">{entry.label}</span><NavCount name={entry.count} counts={counts} countsKey={countsKey}/></>}</Link>;
  return collapsed ? <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{entry.label}</TooltipContent></Tooltip> : link;
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { me, counts, countsKey } = loaderData;
  const navigation = useNavigation();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [location.pathname, location.search]);
  const advanced: WorkbenchNavEntry[] = [
    { to: '/admin/studio/planning', label: '选题建议', icon: 'ideas' },
    { to: '/admin/studio?tab=tasks', label: '采编任务', icon: 'tasks' },
    { to: '/admin/studio?tab=sources', label: '信源与采集', icon: 'sources' },
    { to: '/admin/studio/social', label: '社媒派生' },
    { to: '/admin/studio?tab=review', label: '审稿策略', icon: 'review' },
    { to: '/admin/content', label: '内容诊断' },
    { to: '/admin/sources', label: '信源配置', count: 'sources', icon: 'sources' },
    ...webModules().flatMap(m => m.admin?.content ?? []),
    { to: '/admin/feedback', label: '反馈', count: 'feedback' },
    { to: '/admin/channels', label: '模型连接', icon: 'settings' },
    { to: '/admin/runs', label: '运行记录', count: 'runs', icon: 'activity' },
    { to: '/admin/models', label: '模型与评测' },
    { to: '/admin/selectbench', label: '精选评测' },
    { to: '/admin/audit', label: '审计记录' },
  ];
  const moduleGroups = webModules().flatMap(m => m.admin?.groups ?? []);
  const allEntries = [...workbenchNavigation, ...advanced, ...moduleGroups.flatMap(g => g.items), { to: '/admin/settings', label: '设置', icon: 'settings' }];
  const current = allEntries.find(e => isWorkbenchNavActive(location.pathname, location.search, e.to));
  const advancedActive = advanced.some(e => isWorkbenchNavActive(location.pathname, location.search, e.to));
  const sidebar = (compact: boolean, mobile = false) => <>
    <div className={`flex h-20 shrink-0 items-center ${compact ? 'justify-center' : 'gap-3 px-3'}`}>
      <Link to="/admin/studio" onClick={() => setMobileOpen(false)} aria-label="Chipshow 编辑台" className="flex items-center gap-3 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent"><span className="grid size-10 shrink-0 place-items-center rounded-card bg-accent text-[13px] font-bold tracking-tight text-accent-contrast">CS</span>{!compact && <span className="text-sm font-semibold tracking-tight text-ink">Chipshow Studio<span className="mt-0.5 block text-[11px] font-normal text-ink-4">你的智能内容编辑台</span></span>}</Link>
    </div>
    <nav aria-label={mobile ? '移动工作台导航' : '工作台导航'} className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-5">
      {!compact && <p className="px-3 pb-2 pt-3 text-[11px] font-medium tracking-wider text-ink-4">内容工作</p>}
      {workbenchNavigation.map(entry => <NavItem key={entry.to} entry={entry} collapsed={compact} counts={counts} countsKey={countsKey} onNavigate={() => setMobileOpen(false)}/>)}
      {moduleGroups.map(group => <div key={group.group} className="pt-4">{!compact && <p className="px-3 pb-2 text-[11px] text-ink-4">{group.group}</p>}{group.items.map(entry => <NavItem key={entry.to} entry={entry} collapsed={compact} counts={counts} countsKey={countsKey} onNavigate={() => setMobileOpen(false)}/>)}</div>)}
      {compact ? <div className="mt-4 border-t border-line pt-3"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="w-full" aria-label="展开管理导航" onClick={() => setCollapsed(false)}><Settings2 className="size-[19px]"/></Button></TooltipTrigger><TooltipContent side="right">管理与设置</TooltipContent></Tooltip></div> : <Accordion type="single" collapsible defaultValue={advancedActive ? 'manage' : undefined} key={advancedActive ? 'active' : 'rest'} className="mt-5 border-t border-line pt-2"><AccordionItem value="manage" className="border-0"><AccordionTrigger className="rounded-card px-3 py-3 text-xs text-ink-4 hover:no-underline">管理与工具</AccordionTrigger><AccordionContent className="pb-0">{advanced.map(entry => <NavItem key={entry.to} entry={entry} collapsed={false} counts={counts} countsKey={countsKey} onNavigate={() => setMobileOpen(false)}/>)}</AccordionContent></AccordionItem></Accordion>}
    </nav>
    <div className="shrink-0 space-y-2 border-t border-line pt-3">
      <NavItem entry={{ to: '/admin/settings', label: '设置与上线方式', icon: 'settings' }} collapsed={compact} counts={counts} countsKey={countsKey} onNavigate={() => setMobileOpen(false)}/>
      <div className={`flex items-center gap-2 rounded-card bg-bg-sunk py-3 ${compact ? 'justify-center px-0' : 'px-3'}`}>{!compact && <><span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold text-accent" aria-hidden="true">{me.name.slice(0, 1)}</span><span className="min-w-0 flex-1 truncate text-xs text-ink-2">{me.name}{me.dev && <span className="ml-1 text-amber-ink">开发</span>}</span></>}<form method="post" action="/api/auth/logout"><Button type="submit" variant="ghost" size="icon" className="size-7" aria-label="退出登录"><LogOut className="size-4"/></Button></form></div>
    </div>
  </>;
  return <TooltipProvider delayDuration={200}><div className="admin-workspace flex min-h-dvh bg-bg" style={{ '--studio-sidebar-width': collapsed ? '76px' : '244px' } as CSSProperties}>
    <NavigationProgress active={navigation.state === 'loading'}/>
    <aside className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar px-3 pb-4 lg:flex ${collapsed ? 'w-[76px]' : 'w-[244px]'}`}>{sidebar(collapsed)}</aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(v => !v)}>{collapsed ? <PanelLeftOpen className="size-5"/> : <PanelLeftClose className="size-5"/>}</Button>
          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}><DialogTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开工作台导航"><Menu className="size-5"/></Button></DialogTrigger><DialogContent side="left" className="flex w-[min(320px,90vw)] flex-col gap-0 bg-sidebar p-3 pb-5"><DialogTitle className="sr-only">工作台导航</DialogTitle><DialogDescription className="sr-only">选择今日选稿、专业内容、我的稿件或管理功能。</DialogDescription>{sidebar(false, true)}</DialogContent></Dialog>
          <span className="hidden text-xs text-ink-4 sm:inline">编辑台</span><ChevronRight className="hidden size-3 text-ink-4 sm:inline" aria-hidden="true"/><span className="truncate text-sm font-medium text-ink">{current?.label || '内容工作'}</span>
        </div>
        <Link to="/admin/studio?tab=tasks" className="flex shrink-0 items-center gap-1.5 text-xs text-ink-3 hover:text-accent"><CircleHelp className="size-4" aria-hidden="true"/><span>查看处理进度</span></Link>
      </header>
      <main id="admin-main" className="min-w-0 flex-1"><Outlet/></main>
    </div><Toaster/>
  </div></TooltipProvider>;
}
