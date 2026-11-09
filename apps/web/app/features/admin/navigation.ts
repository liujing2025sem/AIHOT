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
  { to: '/admin/studio?tab=materials', label: '今日选稿', icon: 'news' },
  { to: '/admin/studio/pitch', label: '专业内容', icon: 'guide' },
  { to: '/admin/studio?tab=drafts', label: '我的稿件', icon: 'drafts' },
  { to: '/admin/studio/published', label: '发布记录', icon: 'published' },
];

export const studioPageLabels: Record<string, { title: string; description: string }> = {
  materials: { title: '今日选稿', description: '从已采集的信息中勾选材料，准备你的下一篇英文稿。' },
  drafts: { title: '我的稿件', description: '继续编辑、核对证据，把准备好的文章交付出去。' },
  tasks: { title: '采编任务', description: '查看正在处理的任务，接续生成或取回已有结果。' },
  sources: { title: '信源与采集', description: '维护信息入口。采集与模型开关沿用当前设置。' },
  review: { title: '审稿策略', description: '管理人工观察和审稿策略，不影响已保存稿件的阅读。' },
};
