import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {launchExtension, recordsOf, resetStorage} from './extension.js';
import {isRecordKey} from '../../chrome-extension/record-storage.js';
import {createBackup} from '../../chrome-extension/backup.js';

test('バックアップから復元できる', async () => {
	const {ctx, base, errors} = await launchExtension({acceptDownloads: true});

	// 記録は月ごとのキーをまとめて比べる。ToDo の ID は記録ページが振るので除いて比べる
	const normalize = items => {
		const rest = Object.fromEntries(Object.entries(items).filter(([key]) => !isRecordKey(key)));
		if (rest.todo) rest.todo = rest.todo.map(todo => Object.fromEntries(Object.entries(todo).filter(([key]) => key !== 'id')));
		return Object.keys(items).some(isRecordKey) ? {record: recordsOf(items), ...rest} : rest;
	};
	const storedItems = p => p.evaluate(() => chrome.storage.local.get(null)).then(normalize);

	// 初期データ A
	const page = await ctx.newPage();
	await page.goto(`${base}/export.html`);
	const A = {
		record: [{start: Date.now() - 3600e3, end: Date.now() - 1800e3, type: '開発', title: 'A の記録'}],
		type: [{name: '開発'}],
		'setting.only-in-A': true,
	};
	await resetStorage(page, A);

	// 記録ページを開いておく
	const main = await ctx.newPage();
	await main.goto(`${base}/main.html?from=test#x`);
	const pageText = p => p.evaluate(() => document.body.innerText + [...document.querySelectorAll('input,textarea')].map(e => e.value).join('|'));
	await main.waitForTimeout(1000);
	assert.ok((await pageText(main)).includes('A の記録'));

	// 不正ファイル
	const imp = await ctx.newPage();
	await imp.goto(`${base}/import.html`);
	await imp.setInputFiles('#file', {name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}')});
	await imp.waitForFunction(() => document.getElementById('status').textContent.includes('読み込めませんでした'));
	assert.equal(await imp.isHidden('#preview'), true);

	// 正しいバックアップ B
	const now = Date.now();
	const B = {
		record: [
			{start: now - 7200e3, end: now - 3600e3, type: '会議', title: 'B の記録1'},
			{start: now - 3600e3, end: now - 1800e3, type: '会議', title: 'B の記録2'},
		],
		type: [{name: '会議'}],
		todo: [{type: '会議', title: 'B のToDo'}],
		'setting.detail-visible': true,
	};
	const backupB = createBackup(B, {extensionVersion: '0.1.0', now: new Date()});
	await imp.setInputFiles('#file', {name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backupB))});
	await imp.waitForSelector('#preview:not([hidden])');
	const rows = await imp.$$eval('#counts tr', trs => trs.map(tr => tr.innerText.replace(/\s+/g, ' ')));
	assert.deepEqual(rows, ['記録 1 件 2 件', 'ToDo 0 件 1 件', '分類 1 件 1 件', 'ToDo グループ 初期値 初期値']);

	// confirm をキャンセル → 何も変わらない
	imp.once('dialog', d => d.dismiss());
	await imp.click('#restore');
	await imp.waitForTimeout(300);
	assert.deepEqual(await storedItems(imp), A);

	// 復元
	imp.once('dialog', d => d.accept());
	const mainReload = main.waitForEvent('load', {timeout: 5000});
	const dl = imp.waitForEvent('download');
	await imp.click('#restore');
	const download = await dl;
	const before = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
	assert.equal(before.format, 'time-tracker-backup');
	assert.deepEqual(normalize(before.data), A);
	await imp.waitForFunction(() => document.getElementById('status').textContent.startsWith('復元しました'));
	assert.deepEqual(await storedItems(imp), B);
	await mainReload;
	await main.waitForTimeout(1000);
	const c = await pageText(main);
	assert.ok(c.includes('B の記録2'));
	assert.ok(!c.includes('A の記録'));
	// 同じファイルを選び直せる
	await imp.setInputFiles('#file', {name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backupB))});
	await imp.waitForSelector('#preview:not([hidden])');
	// 分類の形が違うファイルは拒否
	await imp.setInputFiles('#file', {name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createBackup({type: ['x']}, {extensionVersion: '0.1.0', now: new Date()})))});
	await imp.waitForFunction(() => document.getElementById('status').textContent.includes('読み込めませんでした'));
	assert.equal(await imp.isHidden('#preview'), true);
	// 記録ページが保存しても B のまま
	await main.waitForTimeout(1500);
	assert.deepEqual((await storedItems(imp)).record, B.record);

	// export → import の往復
	const exp = await ctx.newPage();
	const dl2 = exp.waitForEvent('download');
	await exp.goto(`${base}/export.html?auto`);
	const exported = await dl2;
	const exportedText = fs.readFileSync(await exported.path(), 'utf8');
	await imp.evaluate(() => chrome.storage.local.set({record: []}));
	await imp.reload();
	await imp.setInputFiles('#file', {name: 'e.json', mimeType: 'application/json', buffer: Buffer.from(exportedText)});
	await imp.waitForSelector('#preview:not([hidden])');
	imp.once('dialog', d => d.accept());
	const dl3 = imp.waitForEvent('download');
	await imp.click('#restore');
	await dl3;
	await imp.waitForFunction(() => document.getElementById('status').textContent.startsWith('復元しました'));
	const after = await storedItems(imp);
	assert.deepEqual(after.record, B.record);
	assert.ok(Object.keys(await imp.evaluate(() => chrome.storage.local.get(null))).some(key => key.startsWith('record.')), '月ごとのキーで復元されていない');

	// 読み込めないファイルは、理由をコンソールにも出す
	assert.deepEqual(errors.map(e => e.split('\n')[0]), [
		'Error: Time tracker のバックアップファイルではありません。',
		'Error: 分類 (type) の 1 件目が不正です: オブジェクトではありません',
	]);
});
