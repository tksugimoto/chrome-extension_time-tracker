// 「現在」の終了・一つ前を再開ボタンと、そのアクセスキー (Q / R) の確認
//   - アクセスキーが設定されている（Playwright のキー入力ではアクセスキーが発火しないため、属性で確かめてクリックで操作する）
//   - 終了で計測中の記録を終了する。停止中は終了ボタンが押せない
//   - 停止中は最後の記録を、計測中は一つ前の記録を再開する（分類・タイトル・メモを引き継ぐ）
//   - 分類のアクセスキーに Q・R は使えない
//   - 終了・再開のアクセスキーは分類の編集モードで変えられ、なしにもできる（リロード後も残る）
//   - 既定のキーが分類で使われていれば、終了・再開はキーなしになる
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchExtension, readRecords, resetStorage} from './extension.js';
import {recordKeyOf as monthKey} from '../../chrome-extension/record-storage.js';

test('終了・一つ前を再開をアクセスキーで操作できる', async () => {
	const {ctx, base, errors} = await launchExtension();

	const now = Date.now();
	const today0 = new Date(); today0.setHours(0, 0, 0, 0);
	const t0 = Math.max(today0.getTime(), now - 3 * 3600e3);
	const a = {start: t0, end: t0 + 600e3, type: 'A作業', title: 'A', memo: 'Aメモ'};
	const b = {start: t0 + 600e3, type: 'B作業', title: 'B'};

	const page = await ctx.newPage();
	await page.goto(`${base}/main.html`);
	await resetStorage(page, {
		type: [{name: 'A作業'}, {name: 'B作業'}],
		todo: [],
		[monthKey(a.start)]: [a, b],
	});
	await page.reload();
	const stop = page.getByRole('button', {name: '終了 (Q)'});
	const resume = page.getByRole('button', {name: '一つ前を再開 (R)'});
	await stop.waitFor();
	assert.equal(await stop.getAttribute('accesskey'), 'Q');
	assert.equal(await resume.getAttribute('accesskey'), 'R');
	const records = async () => {
		await page.waitForTimeout(1500); // 保存を待つ
		return readRecords(page);
	};
	const plain = ({type, title, memo, end}) => ({type, title, memo, running: !end});

	// 計測中の記録は経過時間が毎秒変わってボタンの位置がずれるので、stable を待たない dispatchEvent で押す
	// 計測中 (B) に再開 → 一つ前 (A) を再開
	await resume.dispatchEvent('click');
	let list = await records();
	assert.deepEqual(list.map(plain), [
		{type: 'A作業', title: 'A', memo: 'Aメモ', running: false},
		{type: 'B作業', title: 'B', memo: undefined, running: false},
		{type: 'A作業', title: 'A', memo: 'Aメモ', running: true},
	]);

	// 終了。停止中は終了ボタンが押せない
	await stop.dispatchEvent('click');
	list = await records();
	assert.equal(list.length, 3);
	assert.ok(list[2].end, '終了している');
	assert.equal(await stop.isDisabled(), true);

	// 停止中に再開 → 最後の記録 (A) を再開
	await resume.dispatchEvent('click');
	list = await records();
	assert.deepEqual(list.slice(3).map(plain), [{type: 'A作業', title: 'A', memo: 'Aメモ', running: true}]);
	assert.equal(await stop.isDisabled(), false);

	// 分類のアクセスキーに Q・R は使えない（入力すると不正になる）
	await page.getByRole('button', {name: '編集モード'}).first().click();
	const keyInput = page.getByPlaceholder('アクセスキーなし').first();
	for (const key of ['q', 'Q', 'r', 'R']) {
		await keyInput.fill(key);
		assert.equal(await keyInput.evaluate(e => e.validity.patternMismatch), true, key);
	}

	// 終了のキーを X に変え、再開のキーをなしにする
	const keyInputs = page.getByPlaceholder('アクセスキーなし');
	const stopKeyInput = keyInputs.nth(2);
	const resumeKeyInput = keyInputs.nth(3);
	assert.equal(await stopKeyInput.inputValue(), 'Q');
	assert.equal(await resumeKeyInput.inputValue(), 'R');
	// キーが入っている欄でも、他で使っているキーへの上書きはできない（自分のキーは入れ直せる）
	await stopKeyInput.fill('R');
	assert.equal(await stopKeyInput.evaluate(e => e.validity.patternMismatch), true, '再開の R');
	// 不正なまま欄から離れると、保存されている値 (Q) に戻る
	await stopKeyInput.blur();
	assert.equal(await stopKeyInput.inputValue(), 'Q');
	await stopKeyInput.fill('q');
	assert.equal(await stopKeyInput.evaluate(e => e.validity.patternMismatch), false, '自分の q');
	await stopKeyInput.fill('X');
	await resumeKeyInput.fill('');
	await page.waitForTimeout(300);
	// X は終了で使っているので、分類には使えない
	await keyInput.fill('x');
	assert.equal(await keyInput.evaluate(e => e.validity.patternMismatch), true, 'x');
	await keyInput.fill('');

	await page.reload();
	const stopX = page.getByRole('button', {name: '終了 (X)'});
	await stopX.waitFor();
	assert.equal(await stopX.getAttribute('accesskey'), 'X');
	const resumeNoKey = page.getByRole('button', {name: '一つ前を再開', exact: true});
	assert.equal(await resumeNoKey.getAttribute('accesskey'), null);

	assert.deepEqual(errors, []);
});

test('既定のキー (Q・R) が分類で使われていれば、終了・再開はキーなしになる', async () => {
	const {ctx, base, errors} = await launchExtension();
	const page = await ctx.newPage();
	await page.goto(`${base}/main.html`);
	await resetStorage(page, {
		type: [{name: 'A作業', accessKey: 'q'}, {name: 'B作業'}],
		todo: [],
	});
	await page.reload();
	const stop = page.getByRole('button', {name: '終了', exact: true});
	await stop.waitFor();
	assert.equal(await stop.getAttribute('accesskey'), null);
	assert.equal(await page.getByRole('button', {name: '一つ前を再開 (R)'}).getAttribute('accesskey'), 'R');
	assert.equal(await page.getByRole('button', {name: '開始 (q)'}).getAttribute('accesskey'), 'q');

	// 自分で設定したキーはそのまま使う
	await page.evaluate(() => chrome.storage.local.set({'setting.stop-access-key': 'X'}));
	await page.reload();
	await page.getByRole('button', {name: '終了 (X)'}).waitFor();

	assert.deepEqual(errors, []);
});
