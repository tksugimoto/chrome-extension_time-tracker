import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchExtension, readRecords, resetStorage} from './extension.js';

test('記録の開始・終了・編集と、分類・ToDo の追加ができる', async () => {
	const {ctx, base, errors} = await launchExtension();
	const page = await ctx.newPage();
	page.on('dialog', d => d.accept());
	await page.goto(`${base}/main.html`);
	const now = new Date();
	const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
	const y = today0.getTime() - 24 * 3600e3;
	await resetStorage(page, {
		type: [{name: '開発'}, {name: 'ミーティング'}, {name: '昼休憩'}],
		todo: [{type: '開発', title: 'レビュー', memo: 'https://example.com/pr/1', deadline: today0.getTime(), estimation: '2'}],
		'todo-group': ['対応待ち'],
		'setting.use-todo-deadline': true,
		'setting.use-todo-estimation': true,
		record: [
			{start: y + 9 * 3600e3, end: y + 10 * 3600e3, type: '開発', title: 'レビュー'},
			{start: y + 22 * 3600e3, type: 'ミーティング'}, // 前日の終了し忘れ
		],
	});
	await page.reload();
	await page.waitForTimeout(800);
	const text = () => page.evaluate(() => document.body.innerText);
	const getRecords = () => readRecords(page);
	let t = await text();
	assert.ok(t.includes('Stats') && t.includes('履歴総数: 2'), t);
	const storedRecords = await getRecords();
	assert.equal(typeof storedRecords[1].end, 'number', '前日の未終了の記録が終了されていない');
	assert.equal(storedRecords[1].end, today0.getTime(), '前日 24:00 で終了されていない');
	assert.match(t, /\(-/, '期限の表示がない');

	// 分類「開発」を開始 → 現在に出る
	// 計測中の記録と ToDo の経過時間が毎秒変わってボタンの位置がずれ、click() は stable を待ち続けるので dispatchEvent で押す
	const startButtons = page.getByRole('button', {name: /^開始/});
	await startButtons.first().dispatchEvent('click');
	await page.waitForTimeout(1200);
	t = await text();
	let rec = await getRecords();
	assert.equal(rec.length, 3);
	assert.equal(rec[2].type, '開発');
	assert.equal(rec[2].end, undefined);
	// ToDo を開始 → 前のは自動で終了
	await startButtons.nth(3).dispatchEvent('click');
	await page.waitForTimeout(1200);
	rec = await getRecords();
	assert.equal(rec.length, 4);
	assert.equal(typeof rec[2].end, 'number');
	assert.equal(rec[3].title, 'レビュー');
	// 終了
	await page.getByRole('button', {name: '終了'}).first().dispatchEvent('click');
	await page.waitForTimeout(500);
	rec = await getRecords();
	assert.equal(typeof rec[3].end, 'number');
	// 時刻編集ダイアログ
	await page.getByRole('button', {name: '時刻編集'}).first().dispatchEvent('click');
	await page.waitForTimeout(300);
	assert.ok(await page.locator('dialog[open]').count() === 1, 'ダイアログが開かない');
	await page.locator('dialog[open]').getByRole('button', {name: '確定', exact: true}).click();
	await page.waitForTimeout(300);
	// 分類の追加（編集モード）
	await page.getByText('編集モード').first().click();
	await page.waitForTimeout(300);
	const before = (await page.evaluate(() => chrome.storage.local.get('type'))).type.length;
	const addTypeForm = page.locator('form', {has: page.getByRole('button', {name: '分類追加'})});
	await addTypeForm.locator('input').first().fill('新しい分類');
	await addTypeForm.getByRole('button', {name: '分類追加'}).click();
	await page.waitForTimeout(300);
	const types = (await page.evaluate(() => chrome.storage.local.get('type'))).type;
	assert.equal(types.length, before + 1);
	await page.getByText('表示モード').first().click();
	// ToDo の追加
	await page.getByText('編集モード').nth(1).click();
	await page.waitForTimeout(300);
	const addTodoForm = page.locator('form', {has: page.getByRole('button', {name: 'ToDo追加'})});
	{
		const selects = addTodoForm.locator('select');
		await selects.first().selectOption({index: 1});
		await addTodoForm.locator('input').first().fill('新しいToDo');
		await addTodoForm.getByRole('button', {name: 'ToDo追加'}).click();
		await page.waitForTimeout(300);
		const todos = (await page.evaluate(() => chrome.storage.local.get('todo'))).todo;
		assert.equal(todos.length, 2, JSON.stringify(todos));
		assert.equal(todos[1].title, '新しいToDo');
	}
	// 集計を表示
	const agg = page.getByText('集計結果');
	await agg.first().click();
	await page.waitForTimeout(300);
	t = await text();
	assert.ok(t.includes('勤務時間Total'));
	// 再読み込みしても残っている
	await page.reload();
	await page.waitForTimeout(800);
	t = await text();
	assert.ok(t.includes('履歴総数: 4'), t.match(/履歴総数[^\n]*/)?.[0]);
	// エクスポートページ
	const exp = await ctx.newPage();
	await exp.goto(`${base}/export.html`);
	await exp.waitForSelector('#download:not([hidden])');
	assert.deepEqual(errors, []);
});
