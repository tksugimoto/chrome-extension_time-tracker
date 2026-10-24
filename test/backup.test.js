import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {resolveObjectURL} from 'node:buffer';
import {
	BACKUP_VERSION,
	createBackup,
	createBackupFileName,
	setBackupDownloadLink,
	parseBackup,
	summarize,
	keysToRemove,
	restoreBackup,
} from '../chrome-extension/backup.js';
import {splitLegacyRecords} from '../chrome-extension/record-storage.js';

const sampleData = () => ({
	record: [
		{start: 1761184800000, end: 1761188400000, type: '開発', title: 'レビュー'},
		{start: 1761188400000, type: '会議'},
	],
	todo: [{type: '開発', title: 'レビュー'}],
	type: [{name: '開発'}, {name: '会議'}],
	'todo-group': ['今日'],
	'setting.detail-visible': true,
});

const toText = (backup) => JSON.stringify(backup);

const validBackup = (data = sampleData()) => createBackup(data, {
	extensionVersion: '0.1.0',
	now: new Date('2026-10-23T01:02:03.000Z'),
});

describe('createBackup', () => {
	it('メタ情報とデータを持つ', () => {
		const data = sampleData();
		assert.deepEqual(validBackup(data), {
			format: 'time-tracker-backup',
			version: 2,
			extensionVersion: '0.1.0',
			exportedAt: '2026-10-23T01:02:03.000Z',
			data,
		});
	});
});

describe('createBackupFileName', () => {
	it('ローカル時刻を0埋めしてファイル名にする', () => {
		assert.equal(
			createBackupFileName(new Date(2026, 0, 2, 3, 4, 5)),
			'time-tracker-backup-20260102-030405.json',
		);
	});
});

describe('setBackupDownloadLink', () => {
	const now = new Date(2026, 9, 23, 19, 8, 7);
	const readLink = link => resolveObjectURL(link.href).text().then(JSON.parse);

	it('リンクに JSON の Blob とファイル名を設定し、parseBackup で読み戻せる', async () => {
		const link = {href: ''};
		const data = sampleData();
		setBackupDownloadLink(link, data, {extensionVersion: '0.1.0', now});
		assert.equal(link.download, 'time-tracker-backup-20261023-190807.json');
		assert.equal(link.textContent, link.download);
		assert.equal(resolveObjectURL(link.href).type, 'application/json');
		const text = await resolveObjectURL(link.href).text();
		assert.deepEqual(parseBackup(text), createBackup(data, {extensionVersion: '0.1.0', now}));
	});

	it('作り直すと前の Blob URL を解放する', async () => {
		const link = {href: ''};
		setBackupDownloadLink(link, {record: []}, {extensionVersion: '0.1.0', now});
		const oldHref = link.href;
		setBackupDownloadLink(link, {todo: []}, {extensionVersion: '0.1.0', now});
		assert.notEqual(link.href, oldHref);
		assert.equal(resolveObjectURL(oldHref), undefined);
		assert.deepEqual((await readLink(link)).data, {todo: []});
	});
});

describe('parseBackup', () => {
	it('createBackup で作ったものを往復できる', () => {
		const backup = validBackup();
		assert.deepEqual(parseBackup(toText(backup)), backup);
	});

	it('空のデータ（初期状態）も読み込める', () => {
		const backup = validBackup({});
		assert.deepEqual(parseBackup(toText(backup)), backup);
	});

	it('記録の end が null でも読み込める', () => {
		const backup = validBackup({record: [{start: 1, end: null, type: 'a'}]});
		assert.deepEqual(parseBackup(toText(backup)), backup);
	});

	it('任意項目が揃った記録・ToDo も読み込める', () => {
		const backup = validBackup({
			record: [{start: 1, end: 2, type: 'a', title: 't', memo: 'm'}],
			todo: [
				{type: 'a', title: 't', memo: 'm', group: 'g', deadline: 1761145200000, estimation: '1.5'},
				{type: 'a', title: 't', estimation: 2},
				{type: 'a', title: 't', memo: null, group: null, deadline: null, estimation: null},
			],
		});
		assert.deepEqual(parseBackup(toText(backup)), backup);
	});

	it('未知のキーもそのまま残す', () => {
		const backup = validBackup({'future-key': {a: 1}});
		assert.deepEqual(parseBackup(toText(backup)).data, {'future-key': {a: 1}});
	});

	const invalidCases = [
		['JSON でない', 'not json', /JSON として読み込めませんでした/],
		['空文字', '', /JSON として読み込めませんでした/],
		['null', 'null', /バックアップファイルではありません/],
		['配列', '[]', /バックアップファイルではありません/],
		['format がない（chrome.storage をそのまま保存したもの）', toText(sampleData()), /バックアップファイルではありません/],
		['format が違う', toText({...validBackup(), format: 'other'}), /バックアップファイルではありません/],
		['version がない', toText({...validBackup(), version: undefined}), /version: undefined\) が不正/],
		['version が文字列', toText({...validBackup(), version: '1'}), /version: "1"\) が不正/],
		['version が小数', toText({...validBackup(), version: 1.5}), /が不正/],
		['version が 0', toText({...validBackup(), version: 0}), /が不正/],
		['version が新しい', toText({...validBackup(), version: BACKUP_VERSION + 1}), /新しい形式 \(version: 3\).*拡張機能を更新/],
		['data がない', toText({...validBackup(), data: undefined}), /データ \(data\) がありません/],
		['data が配列', toText({...validBackup(), data: []}), /データ \(data\) がありません/],
		['data が null', toText({...validBackup(), data: null}), /データ \(data\) がありません/],
		['record が配列でない', toText(validBackup({record: {}})), /記録 \(record\) が配列ではありません/],
		['record が null', toText(validBackup({record: null})), /記録 \(record\) が配列ではありません/],
		['todo が配列でない', toText(validBackup({todo: 'x'})), /ToDo \(todo\) が配列ではありません/],
		['type が配列でない', toText(validBackup({type: 1})), /分類 \(type\) が配列ではありません/],
		['todo-group が配列でない', toText(validBackup({'todo-group': {}})), /ToDo グループ \(todo-group\) が配列ではありません/],
		['記録がオブジェクトでない', toText(validBackup({record: [null]})), /記録 \(record\) の 1 件目が不正です: オブジェクトではありません/],
		['記録の start がない', toText(validBackup({record: [{type: 'a'}]})), /記録 \(record\) の 1 件目.*開始時刻/],
		['記録の start が文字列', toText(validBackup({record: [{start: '1', type: 'a'}]})), /開始時刻/],
		['記録の end が文字列', toText(validBackup({record: [{start: 1, end: '2', type: 'a'}]})), /終了時刻/],
		['記録の type がない', toText(validBackup({record: [{start: 1}]})), /分類/],
		['2件目の記録が不正', toText(validBackup({record: [{start: 1, type: 'a'}, {start: 2}]})), /記録 \(record\) の 2 件目が不正です/],
		['ToDo がオブジェクトでない', toText(validBackup({todo: ['x']})), /ToDo \(todo\) の 1 件目が不正です: オブジェクトではありません/],
		['ToDo の type がない', toText(validBackup({todo: [{title: 'a'}]})), /ToDo \(todo\) の 1 件目.*分類/],
		['ToDo の title がない', toText(validBackup({todo: [{type: 'a', title: 'b'}, {type: 'a'}]})), /ToDo \(todo\) の 2 件目.*タイトル/],
		['分類が文字列（{name} でない）', toText(validBackup({type: ['開発']})), /分類 \(type\) の 1 件目が不正です: オブジェクトではありません/],
		['分類の name が数値', toText(validBackup({type: [{name: 1}]})), /分類 \(type\) の 1 件目.*名前/],
		['記録の title が数値', toText(validBackup({record: [{start: 1, type: 'a', title: 1}]})), /記録 \(record\) の 1 件目.*タイトル \(title\)/],
		['記録の memo が配列', toText(validBackup({record: [{start: 1, type: 'a', memo: []}]})), /記録 \(record\) の 1 件目.*メモ \(memo\)/],
		['ToDo の memo が数値', toText(validBackup({todo: [{type: 'a', title: 'b', memo: 1}]})), /ToDo \(todo\) の 1 件目.*メモ \(memo\)/],
		['ToDo の group が数値', toText(validBackup({todo: [{type: 'a', title: 'b', group: 1}]})), /ToDo \(todo\) の 1 件目.*グループ \(group\)/],
		['ToDo の deadline が文字列', toText(validBackup({todo: [{type: 'a', title: 'b', deadline: '2026-10-23'}]})), /ToDo \(todo\) の 1 件目.*期限 \(deadline\)/],
		['ToDo の estimation が真偽値', toText(validBackup({todo: [{type: 'a', title: 'b', estimation: true}]})), /ToDo \(todo\) の 1 件目.*見積もり \(estimation\)/],
		['ToDo グループがオブジェクト', toText(validBackup({'todo-group': [{name: 'x'}]})), /ToDo グループ \(todo-group\) の 1 件目が不正です: 文字列ではありません/],
	];
	for (const [name, text, message] of invalidCases) {
		it(`読み込めない: ${name}`, () => {
			assert.throws(() => parseBackup(text), message);
		});
	}

	it('JSON の構文エラーを cause に持つ', () => {
		assert.throws(() => parseBackup('{'), error => error.cause instanceof SyntaxError);
	});
});

describe('summarize', () => {
	it('各一覧の件数を数える', () => {
		assert.deepEqual(summarize(sampleData()), {record: '2 件', todo: '1 件', type: '2 件', 'todo-group': '1 件'});
	});

	it('保存されていない一覧は、既定値を使うものは「初期値」、それ以外は 0 件', () => {
		assert.deepEqual(summarize({}), {record: '0 件', todo: '0 件', type: '初期値', 'todo-group': '初期値'});
	});

	it('空の配列が保存されていれば 0 件', () => {
		assert.deepEqual(summarize({type: [], 'todo-group': []}), {record: '0 件', todo: '0 件', type: '0 件', 'todo-group': '0 件'});
	});
});

describe('keysToRemove', () => {
	it('バックアップにないキーだけを返す', () => {
		assert.deepEqual(
			keysToRemove(['record', 'todo', 'setting.a', 'setting.b'], {record: [], 'setting.a': false}),
			['todo', 'setting.b'],
		);
	});

	it('値が undefined や false でも、キーがあれば残す', () => {
		assert.deepEqual(keysToRemove(['a', 'b'], {a: undefined, b: false}), []);
	});

	it('プロトタイプのプロパティ名に惑わされない', () => {
		assert.deepEqual(keysToRemove(['constructor', 'toString'], {}), ['constructor', 'toString']);
	});
});

describe('restoreBackup', () => {
	/**
	 * 呼び出し順を記録する偽の storage
	 * @param {Object<string, any>} initialItems
	 * @param {{failSet?: boolean, failRemove?: boolean}=} options
	 */
	const createFakeStorage = (initialItems, {failSet = false, failRemove = false} = {}) => {
		const items = structuredClone(initialItems);
		const calls = [];
		return {
			items,
			calls,
			get: keys => {
				calls.push(['get', keys]);
				return Promise.resolve(structuredClone(items));
			},
			set: newItems => {
				calls.push(['set', Object.keys(newItems)]);
				if (failSet) return Promise.reject(new Error('set failed'));
				Object.assign(items, structuredClone(newItems));
				return Promise.resolve();
			},
			remove: keys => {
				calls.push(['remove', keys]);
				if (failRemove) return Promise.reject(new Error('remove failed'));
				for (const key of keys) delete items[key];
				return Promise.resolve();
			},
		};
	};
	const current = () => ({
		record: [{start: 1, type: '旧'}],
		type: [{name: '旧'}],
		'setting.only-current': true,
	});

	it('全データを読み、保存してから書き込み、バックアップにないキーを消す', async () => {
		const storage = createFakeStorage(current());
		const saved = [];
		const data = sampleData();
		await restoreBackup(data, {
			storage,
			saveCurrentData: items => {
				saved.push(items);
				storage.calls.push(['saveCurrentData']);
			},
		});
		assert.deepEqual(storage.calls, [
			['get', null],
			['saveCurrentData'],
			['set', Object.keys(splitLegacyRecords(data))],
			['remove', ['setting.only-current']],
		]);
		assert.deepEqual(saved, [current()]);
		assert.deepEqual(storage.items, splitLegacyRecords(data));
	});

	it('書き込みに失敗したら、キーを消さずに reject する', async () => {
		const storage = createFakeStorage(current(), {failSet: true});
		await assert.rejects(restoreBackup(sampleData(), {storage, saveCurrentData: () => {}}), /set failed/);
		assert.deepEqual(storage.calls.map(([name]) => name), ['get', 'set']);
		assert.deepEqual(storage.items, current());
	});

	it('キーの削除に失敗したら reject する（バックアップの内容は書き込み済み）', async () => {
		const storage = createFakeStorage(current(), {failRemove: true});
		await assert.rejects(restoreBackup(sampleData(), {storage, saveCurrentData: () => {}}), /remove failed/);
		assert.deepEqual(storage.items, {...splitLegacyRecords(sampleData()), 'setting.only-current': true});
	});

	it('現在のデータの保存に失敗したら、書き換えない', async () => {
		const storage = createFakeStorage(current());
		await assert.rejects(restoreBackup(sampleData(), {
			storage,
			saveCurrentData: () => {
				throw new Error('download failed');
			},
		}), /download failed/);
		assert.deepEqual(storage.calls.map(([name]) => name), ['get']);
		assert.deepEqual(storage.items, current());
	});

	it('空のバックアップなら全キーを消す', async () => {
		const storage = createFakeStorage(current());
		await restoreBackup({}, {storage, saveCurrentData: () => {}});
		assert.deepEqual(storage.items, {});
	});
});
