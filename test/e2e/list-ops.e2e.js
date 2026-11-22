// 分類・ToDo・ToDo グループの削除と、グループの上下移動で一覧が変わり、保存・表示されることを確かめる
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchExtension, resetStorage} from './extension.js';

test('分類・ToDo・ToDo グループの削除と並び替え', async () => {
	const {ctx, base, errors} = await launchExtension();
	const page = await ctx.newPage();
	page.on('dialog', d => d.accept());
	await page.goto(`${base}/main.html`);
	await resetStorage(page, {
		type: [{name: '開発'}, {name: '会議'}, {name: '休憩'}],
		todo: [
			{type: '開発', title: 'a1', group: 'A'},
			{type: '開発', title: 'b1', group: 'B'},
			{type: '会議', title: 'a2', group: 'A'},
		],
		'todo-group': ['A', 'B', 'C'],
		'setting.use-todo-group': true,
	});
	await page.reload();
	await page.waitForTimeout(800);
	const storage = () => page.evaluate(() => chrome.storage.local.get(['type', 'todo', 'todo-group']));

	// 分類の削除
	await page.getByRole('button', {name: '編集モード'}).nth(0).click();
	await page.locator('ul').first().locator('li').nth(1).getByRole('button', {name: '削除'}).click();
	await page.waitForTimeout(300);
	assert.deepEqual((await storage()).type.map(t => t.name), ['開発', '休憩']);
	let types = await page.locator('ul').first().locator('li').allInnerTexts();
	assert.equal(types.length, 2);
	assert.ok(types[1].includes('休憩'), types.join('|'));

	// ToDo の削除・グループの削除・移動（ToDo 側の編集モード）
	await page.getByRole('button', {name: '編集モード'}).nth(1).click();
	const h3 = name => page.locator('h3', {hasText: new RegExp(`^${name}`)});
	await h3('A').locator('xpath=following-sibling::ul[1]').locator('li', {hasText: '開始'}).first().getByRole('button', {name: '削除'}).click();
	await page.waitForTimeout(300);
	let s = await storage();
	assert.deepEqual(s.todo.filter(t => !t.deleted).map(t => t.title), ['b1', 'a2'], '削除した ToDo は deleted: true にして残す');

	await h3('C').getByRole('button', {name: '削除'}).click();
	await page.waitForTimeout(300);
	assert.deepEqual((await storage())['todo-group'], ['A', 'B']);

	await h3('B').getByRole('button', {name: '上へ移動'}).click();
	await page.waitForTimeout(300);
	assert.deepEqual((await storage())['todo-group'], ['B', 'A']);
	await h3('B').getByRole('button', {name: '下へ移動'}).click();
	await page.waitForTimeout(300);
	assert.deepEqual((await storage())['todo-group'], ['A', 'B']);
	await h3('A').getByRole('button', {name: '下へ移動'}).click();
	await page.waitForTimeout(300);
	assert.deepEqual((await storage())['todo-group'], ['B', 'A']);
	let headings = (await page.locator('h3').allInnerTexts()).map(t => t.split('\n')[0].replace(/削除.*/, ''));
	assert.ok(headings[0].startsWith('B') && headings[1].startsWith('A'), headings.join('|'));

	// 再読み込みしても同じ
	await page.reload();
	await page.waitForTimeout(800);
	s = await storage();
	assert.deepEqual(s.type.map(t => t.name), ['開発', '休憩']);
	assert.deepEqual(s.todo.filter(t => !t.deleted).map(t => t.title), ['b1', 'a2']);
	assert.deepEqual(s['todo-group'], ['B', 'A']);
	const text = await page.evaluate(() => document.body.innerText);
	assert.ok(!text.includes('a1') && text.indexOf('b1') < text.indexOf('a2'), text);

	assert.deepEqual(errors, []);
});
