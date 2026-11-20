import type { AdminNavEntry } from '../../modules';

export type WorkbenchNavEntry = AdminNavEntry & { icon?: string };

/** Query tabs are routes in the workbench, not five simultaneously active links. */
export function isWorkbenchNavActive(pathname: string, search: string, target: string): boolean {
  const url = new URL(target, 'https://studio.invalid');
  if (url.pathname === '/admin/studio' && url.searchParams.has('tab')) {
    const tab = url.searchParams.get('tab');
    if (tab === 'drafts' && pathname.startsWith('/admin/studio/drafts/')) return true;
    if (tab === 'materials' && pathname.startsWith('/admin/studio/materials/')) return true;
    return pathname === url.pathname && (new URLSearchParams(search).get('tab') || 'materials') === tab;
  }
  return pathname === url.pathname || pathname.startsWith(`${url.pathname}/`);
}

export const workbenchNavigation: WorkbenchNavEntry[] = [
  { to: '/admin/workbench', label: '工作台', icon: 'home' },
  { to: '/admin/studio?tab=materials', label: '新闻材料', icon: 'news' },
  { to: '/admin/studio?tab=drafts', label: '稿件', icon: 'drafts' },
];

export const studioPageLabels: Record<string, { title: string; description: string }> = {
  materials: { title: '新闻材料', description: '选择原文，准备单篇稿件或一期短讯。' },
  drafts: { title: '稿件', description: '编辑、审稿与交付。' },
  tasks: { title: '处理进度', description: '查看进度、取回结果或继续任务。' },
  sources: { title: '信源与采集', description: '管理材料来源和采集设置。' },
  review: { title: '审稿设置', description: '调整审稿规则，查看人工核对记录。' },
};
