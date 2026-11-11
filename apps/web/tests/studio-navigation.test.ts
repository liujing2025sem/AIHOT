import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWorkbenchNavActive, workbenchNavigation } from '../app/features/admin/navigation.ts';

const cases = [
  ['/admin/workbench', '', '工作台'],
  ['/admin/studio', '', '今日选稿'],
  ['/admin/studio', '?tab=materials&q=MiP&page=2', '今日选稿'],
  ['/admin/studio/materials/example', '', '今日选稿'],
  ['/admin/studio/pitch', '', '专业内容'],
  ['/admin/studio/pitch', '?question_id=example', '专业内容'],
  ['/admin/studio', '?tab=drafts&status=in_review', '我的稿件'],
  ['/admin/studio/drafts/example', '', '我的稿件'],
  ['/admin/studio/published', '', '发布记录'],
] as const;

for (const [pathname, search, expected] of cases) {
  test(`workbench navigation has one current destination: ${pathname}${search}`, () => {
    const active = workbenchNavigation.filter(entry => isWorkbenchNavActive(pathname, search, entry.to));
    assert.equal(active.length, 1);
    assert.equal(active[0].label, expected);
  });
}

test('advanced destinations never activate a main workbench tab', () => {
  for (const [pathname, search] of [
    ['/admin/studio', '?tab=tasks'], ['/admin/studio', '?tab=sources'],
    ['/admin/studio', '?tab=review'], ['/admin/studio/planning', ''],
    ['/admin/settings', ''], ['/admin/studio/pitchfork', ''],
  ]) assert.equal(workbenchNavigation.some(entry => isWorkbenchNavActive(pathname, search, entry.to)), false);
});

test('query tabs and unrelated route prefixes cannot both be active', () => {
  assert.equal(isWorkbenchNavActive('/admin/studio', '?tab=sources', '/admin/studio?tab=tasks'), false);
  assert.equal(isWorkbenchNavActive('/admin/studio', '?tab=review', '/admin/studio?tab=review'), true);
  assert.equal(isWorkbenchNavActive('/admin/sources/example', '', '/admin/sources'), true);
  assert.equal(isWorkbenchNavActive('/admin/sources-extra', '', '/admin/sources'), false);
});
