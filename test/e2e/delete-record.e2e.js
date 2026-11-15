// 記録の削除 (feature/delete-record) の確認
//   - 時刻編集ダイアログの「削除」で、確認をキャンセルすると消えない・OK すると消える
//   - 前の記録の時刻は変わらない
//   - 入力途中の時刻が不正 (開始が空) でも削除できる
//   - その月の記録がなくなると、月のキーが消える
//   - 「削除して前の記録を延ばす」「削除して次の記録を早める」で前後の記録の時刻が変わる（同じ日の前後があるときだけ出る）
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchExtension, resetStorage} from './extension.js';
import {recordKeyOf as monthKey} from '../../chrome-extension/record-storage.js';

test('記録を削除できる', async () => {
	const {ctx, base, errors} = await launchExtension();

	const now = Date.now();
	const today0 = new Date(); today0.setHours(0, 0, 0, 0);
	const t0 = Math.max(today0.getTime(), now - 3 * 3600e3);
	const a = {start: t0, end: t0 + 600e3, type: 'A作業', title: 'A'};
	const b = {start: t0 + 900e3, end: t0 + 1200e3, type: 'B作業', title: 'B'};
	const c = {start: t0 + 1200e3, type: 'C作業', title: 'C'};
	// 先々月に1件だけ（消すと月のキーごとなくなる）
	const old = new Date(); old.setDate(1); old.setMonth(old.getMonth() - 2); old.setHours(10, 0, 0, 0);
	const o = {start: old.getTime(), end: old.getTime() + 600e3, type: 'O作業', title: 'O'};

	const page = await ctx.newPage();
	await page.goto(`${base}/main.html`);
	await resetStorage(page, {
		type: [{name: 'A作業'}, {name: 'B作業'}, {name: 'C作業'}, {name: 'O作業'}],
		todo: [],
		'setting.detail-visible': true,
		[monthKey(o.start)]: [o],
		[monthKey(a.start)]: [a, b, c],
	});
	await page.reload();
	await page.getByText('履歴総数: 4').waitFor();
	const get = () => page.evaluate(() => chrome.storage.local.get(null));
	const dialog = page.locator('dialog[open]');
	// 今日の記録の行の「時刻編集」を押す (title で探す)
	const openEdit = async title => {
		const row = page.locator('li', {has: page.locator(`input[value="${title}"]`)}).first();
		// 計測中の記録は経過時間が毎秒変わってボタンの位置がずれるので、stable を待たない dispatchEvent で押す
		await row.getByRole('button', {name: '時刻編集'}).dispatchEvent('click');
		await dialog.waitFor();
	};

	// 1. キャンセルすると消えない
	await openEdit('B');
	page.once('dialog', d => { assert.equal(d.message(), 'この記録を削除しますか？'); d.dismiss(); });
	await dialog.getByRole('button', {name: '削除', exact: true}).click();
	await page.waitForTimeout(300);
	assert.equal(await dialog.count(), 1, 'キャンセルしたらダイアログは開いたまま');
	assert.equal((await get())[monthKey(a.start)].length, 3);
	await dialog.getByRole('button', {name: '確定', exact: true}).click();
	await page.waitForTimeout(300);

	// 2. OK すると消える。前の記録 A の時刻は変わらない
	await openEdit('B');
	page.once('dialog', d => d.accept());
	await dialog.getByRole('button', {name: '削除', exact: true}).click();
	await page.getByText('履歴総数: 3').waitFor();
	assert.equal(await dialog.count(), 0, '削除したらダイアログが閉じる');
	let items = await get();
	assert.deepEqual(items[monthKey(a.start)], [a, c]);

	// 3. 計測中の記録 C を、開始を空にした (不正な入力の) まま削除できる
	await openEdit('C');
	await dialog.locator('input[type="datetime-local"]').first().fill('');
	page.once('dialog', d => d.accept());
	await dialog.getByRole('button', {name: '削除', exact: true}).click();
	await page.getByText('履歴総数: 2').waitFor();
	items = await get();
	assert.deepEqual(items[monthKey(a.start)], [a]);

	// 4. 先々月の唯一の記録を消すと、月のキーが消える（集計の期間を先々月からにして、詳細の一覧から開く）
	await page.locator('h2:text("集計結果") + .sticky input[type=date]').first().fill(old.toLocaleDateString('sv-SE'));
	await page.waitForTimeout(500);
	await openEdit('O');
	page.once('dialog', d => d.accept());
	await dialog.getByRole('button', {name: '削除', exact: true}).click();
	await page.getByText('履歴総数: 1').waitFor();
	items = await get();
	assert.equal(items[monthKey(o.start)], undefined, '空になった月のキーは消える');

	// 5. 再読み込みしても戻らない
	await page.reload();
	await page.getByText('履歴総数: 1').waitFor();

	// 6. 前を延ばす・次を早める
	const p = {start: t0, end: t0 + 600e3, type: 'A作業', title: 'P'};
	const m1 = {start: t0 + 900e3, end: t0 + 1200e3, type: 'B作業', title: 'M1'};
	const m2 = {start: t0 + 1500e3, end: t0 + 1800e3, type: 'B作業', title: 'M2'};
	const n = {start: t0 + 2000e3, type: 'C作業', title: 'N'};
	await resetStorage(page, {
		type: [{name: 'A作業'}, {name: 'B作業'}, {name: 'C作業'}],
		todo: [],
		[monthKey(t0)]: [p, m1, m2, n],
	});
	await page.reload();
	await page.getByText('履歴総数: 4').waitFor();
	// 最初の記録には前がないので「前を延ばす」は出ない。最後の記録には次がないので「次を早める」は出ない
	await openEdit('P');
	assert.equal(await dialog.getByRole('button', {name: '削除して前の記録を延ばす'}).count(), 0);
	assert.equal(await dialog.getByRole('button', {name: '削除して次の記録を早める'}).count(), 1);
	await dialog.getByRole('button', {name: '確定', exact: true}).click();
	await page.waitForTimeout(300);
	await openEdit('N');
	assert.equal(await dialog.getByRole('button', {name: '削除して前の記録を延ばす'}).count(), 1);
	assert.equal(await dialog.getByRole('button', {name: '削除して次の記録を早める'}).count(), 0);
	await dialog.getByRole('button', {name: '確定', exact: true}).click();
	await page.waitForTimeout(300);

	// M1 を消して前 (P) を延ばす: P の終了 = M1 の終了
	await openEdit('M1');
	page.once('dialog', d => { assert.match(d.message(), /前の記録の終了/); d.accept(); });
	await dialog.getByRole('button', {name: '削除して前の記録を延ばす'}).click();
	await page.getByText('履歴総数: 3').waitFor();
	items = await get();
	assert.deepEqual(items[monthKey(t0)], [{...p, end: m1.end}, m2, n]);

	// M2 を消して次 (N) を早める: N の開始 = M2 の開始（N は計測中のまま）
	await openEdit('M2');
	page.once('dialog', d => d.accept());
	await dialog.getByRole('button', {name: '削除して次の記録を早める'}).click();
	await page.getByText('履歴総数: 2').waitFor();
	items = await get();
	assert.deepEqual(items[monthKey(t0)], [{...p, end: m1.end}, {...n, start: m2.start}]);

	// 計測中の N を消して前 (P) を延ばす: P が計測中になる
	await openEdit('N');
	page.once('dialog', d => d.accept());
	await dialog.getByRole('button', {name: '削除して前の記録を延ばす'}).click();
	await page.getByText('履歴総数: 1').waitFor();
	items = await get();
	assert.deepEqual(items[monthKey(t0)], [{start: p.start, type: p.type, title: p.title}]);
	assert.ok(await page.getByRole('button', {name: '終了'}).count() > 0, '前の記録が計測中になる');

	assert.deepEqual(errors, []);
});
