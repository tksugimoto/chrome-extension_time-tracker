// 時刻編集の「確定して前後の記録も合わせる」の確認
//   - 何も変えていない・変えた側に前後の記録がないときは押せない
//   - 開始を変えたときは前の記録の終了だけ、終了を変えたときは次の記録の開始だけを合わせる
//   - 開始と終了を両方変えたときは、前後の両方を合わせる
//   - 「確定」だけなら前後の記録は変わらない
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchExtension, resetStorage} from './extension.js';
import {recordKeyOf as monthKey} from '../../chrome-extension/record-storage.js';
import {Formats} from '../../chrome-extension/utils.js';

const local = Formats.ISODateTimeString;

test('時刻編集で前後の記録も合わせられる', async () => {
	const {ctx, base, errors} = await launchExtension();

	const today0 = new Date(); today0.setHours(0, 0, 0, 0);
	// 秒が 00 だと datetime-local の値から秒が省かれて fill できないため、t0 は 30 秒にそろえ、各時刻も秒が 00 にならないようにする
	const t0 = Math.floor(Math.max(today0.getTime(), Date.now() - 3 * 3600e3) / 60e3) * 60e3 + 30e3;
	const p = {start: t0, end: t0 + 600e3, type: 'A作業', title: 'P'};
	const m = {start: t0 + 900e3, end: t0 + 1200e3, type: 'B作業', title: 'M'};
	const n = {start: t0 + 1500e3, end: t0 + 1800e3, type: 'B作業', title: 'N'};

	const page = await ctx.newPage();
	await page.goto(`${base}/main.html`);
	await resetStorage(page, {
		type: [{name: 'A作業'}, {name: 'B作業'}],
		todo: [],
		[monthKey(t0)]: [p, m, n],
	});
	await page.reload();
	await page.getByText('履歴総数: 3').waitFor();
	const records = async () => (await page.evaluate(() => chrome.storage.local.get(null)))[monthKey(t0)];
	const dialog = page.locator('dialog[open]');
	const openEdit = async title => {
		const row = page.locator('li', {has: page.locator(`input[value="${title}"]`)}).first();
		await row.getByRole('button', {name: '時刻編集'}).dispatchEvent('click');
		await dialog.waitFor();
	};
	const startInput = dialog.locator('input[type="datetime-local"]').nth(0);
	const endInput = dialog.locator('input[type="datetime-local"]').nth(1);
	const adjust = dialog.getByRole('button', {name: '確定して前後の記録も合わせる'});
	const close = async () => {
		await dialog.getByRole('button', {name: '確定', exact: true}).click();
		await dialog.waitFor({state: 'detached'});
	};

	// 1. 何も変えていなければ押せない
	await openEdit('M');
	assert.equal(await adjust.isDisabled(), true);
	await close();

	// 2. 開始を早めて合わせる: 前 (P) の終了だけが M の開始になる
	await openEdit('M');
	await startInput.fill(local(t0 + 800e3));
	assert.equal(await adjust.isDisabled(), false);
	await adjust.click();
	await dialog.waitFor({state: 'detached'});
	assert.deepEqual(await records(), [{...p, end: t0 + 800e3}, {...m, start: t0 + 800e3}, n]);

	// 3. 終了を延ばして合わせる: 次 (N) の開始だけが M の終了になる
	await openEdit('M');
	await endInput.fill(local(t0 + 1300e3));
	await adjust.click();
	await dialog.waitFor({state: 'detached'});
	assert.deepEqual(await records(), [{...p, end: t0 + 800e3}, {...m, start: t0 + 800e3, end: t0 + 1300e3}, {...n, start: t0 + 1300e3}]);

	// 4. 最初の記録 (P) は前がないので、開始だけ変えても押せない。終了も変えると押せて、次 (M) の開始だけを合わせる
	await openEdit('P');
	await startInput.fill(local(t0 + 60e3));
	assert.equal(await adjust.isDisabled(), true);
	await endInput.fill(local(t0 + 700e3));
	assert.equal(await adjust.isDisabled(), false);
	await adjust.click();
	await dialog.waitFor({state: 'detached'});
	assert.deepEqual(await records(), [
		{...p, start: t0 + 60e3, end: t0 + 700e3},
		{...m, start: t0 + 700e3, end: t0 + 1300e3},
		{...n, start: t0 + 1300e3},
	]);

	// 5. 開始と終了を両方変えると、前 (P) の終了と次 (N) の開始を両方合わせる
	await openEdit('M');
	await startInput.fill(local(t0 + 720e3));
	await endInput.fill(local(t0 + 1280e3));
	await adjust.click();
	await dialog.waitFor({state: 'detached'});
	assert.deepEqual(await records(), [
		{...p, start: t0 + 60e3, end: t0 + 720e3},
		{...m, start: t0 + 720e3, end: t0 + 1280e3},
		{...n, start: t0 + 1280e3},
	]);

	// 6. 「確定」だけなら前後は変わらない
	await openEdit('M');
	await startInput.fill(local(t0 + 760e3));
	await close();
	assert.deepEqual(await records(), [
		{...p, start: t0 + 60e3, end: t0 + 720e3},
		{...m, start: t0 + 760e3, end: t0 + 1280e3},
		{...n, start: t0 + 1280e3},
	]);

	assert.deepEqual(errors, []);
});
