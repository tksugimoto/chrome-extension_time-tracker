// main.js の保存まわりのフック (useSetting・useList・useStorageList・useRecordList) を、拡張のページで 1 つずつ確かめる
import {describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {openComponentPage, readStorage, resetStorage} from './extension.js';
import {recordKeyOf} from '../../chrome-extension/record-storage.js';

const {page, now, calls, waitFor, unmountAll} = await openComponentPage();
const storage = () => readStorage(page);

describe('useSetting', () => {
	test('保存した値がなければ既定値、あれば保存した値になる', async () => {
		await resetStorage(page, {'setting.saved': 'saved value'});
		await page.evaluate(() => window.renderHook(window.main.useSetting, 'saved', 'default'));
		await waitFor(() => window.state.hook?.[0] === 'saved value');
		await unmountAll();
		await page.evaluate(() => window.renderHook(window.main.useSetting, 'missing', 'default'));
		await waitFor(() => window.state.hook?.[0] === 'default');
	});

	test('変えると setting.<名前> に保存し、表示も変わる', async () => {
		await resetStorage(page, {});
		await page.evaluate(() => window.renderHook(window.main.useSetting, 'flag', false));
		await waitFor(() => window.state.hook?.[0] === false);
		await page.evaluate(() => window.state.hook[1](true));
		await waitFor(() => window.state.hook[0] === true);
		await waitFor(() => chrome.storage.local.get('setting.flag').then(items => items['setting.flag'] === true));
	});
});

describe('useList', () => {
	// load は 'a', 'b' を読み込み、write は書き込む一覧を window.calls.write に残す
	const mount = () => page.evaluate(() => window.renderHook(window.main.useList, setList => setList(['a', 'b']), window.spy('write')));
	const allList = () => page.evaluate(() => window.state.hook.allList);
	const writes = async () => (await calls('write')).map(([list]) => list);

	test('読み込んだ一覧を返す', async () => {
		await mount();
		await waitFor(() => window.state.hook.allList.length === 2);
		assert.deepEqual(await allList(), ['a', 'b']);
		assert.deepEqual(await writes(), []);
	});

	test('add は末尾に足して書き込み、remove は同じものを除いて書き込む', async () => {
		await mount();
		await waitFor(() => window.state.hook.allList.length === 2);
		await page.evaluate(() => window.state.hook.add('c'));
		await waitFor(() => window.state.hook.allList.length === 3);
		assert.deepEqual(await allList(), ['a', 'b', 'c']);
		await page.evaluate(() => window.state.hook.remove('a'));
		await waitFor(() => window.state.hook.allList.length === 2);
		assert.deepEqual(await allList(), ['b', 'c']);
		assert.deepEqual(await writes(), [['a', 'b', 'c'], ['b', 'c']]);
	});

	test('saveList は最新の一覧から作った一覧を書き込み、その一覧で描画し直す', async () => {
		await mount();
		await waitFor(() => window.state.hook.allList.length === 2);
		await page.evaluate(() => {
			// 描画を待たずに続けて呼んでも、saveList には add した後の一覧が渡る
			window.state.hook.add('c');
			window.state.hook.saveList(list => list.toReversed());
		});
		await waitFor(() => window.state.hook.allList[0] === 'c');
		assert.deepEqual(await allList(), ['c', 'b', 'a']);
		assert.deepEqual(await writes(), [['a', 'b', 'c'], ['c', 'b', 'a']]);
	});

	test('save は最新の一覧を書き込み、作り直した一覧で描画し直す', async () => {
		await mount();
		await waitFor(() => window.state.hook.allList.length === 2);
		await page.evaluate(() => {
			window.state.before = window.state.hook.allList;
			// 描画を待たずに続けて呼んでも、save は add した後の一覧を書き込む
			window.state.hook.add('c');
			window.state.hook.save();
		});
		await waitFor(() => window.state.hook.allList.length === 3);
		assert.deepEqual(await writes(), [['a', 'b', 'c'], ['a', 'b', 'c']]);
		assert.equal(await page.evaluate(() => window.state.hook.allList !== window.state.before), true);
	});
});

describe('useStorageList', () => {
	test('キーの一覧を読み込む。ないときは defaultValue。normalize が同じ配列を返せば書き込まない', async () => {
		await resetStorage(page, {type: [{name: '開発'}]});
		await page.evaluate(() => window.renderHook(window.main.useStorageList, 'type', {normalize: list => list}));
		await waitFor(() => window.state.hook.isLoaded);
		assert.deepEqual(await page.evaluate(() => window.state.hook.allList), [{name: '開発'}]);
		await unmountAll();
		await page.evaluate(() => window.renderHook(window.main.useStorageList, 'todo-group', {defaultValue: ['対応待ち']}));
		await waitFor(() => window.state.hook.allList.length === 1);
		assert.deepEqual(await page.evaluate(() => window.state.hook.allList), ['対応待ち']);
		assert.deepEqual(await storage(), {type: [{name: '開発'}]}, '読み込んだだけで書き込んでいる');
	});

	test('normalize が別の配列を返したら、その一覧を書き込む', async () => {
		await resetStorage(page, {todo: [{type: '開発', title: 'a'}]});
		await page.evaluate(() => window.renderHook(window.main.useStorageList, 'todo', {normalize: list => list.map(v => ({...v, id: 1}))}));
		await waitFor(() => window.state.hook.isLoaded);
		assert.deepEqual(await page.evaluate(() => window.state.hook.allList), [{type: '開発', title: 'a', id: 1}]);
		await waitFor(() => chrome.storage.local.get('todo').then(items => items.todo[0].id === 1));
	});

	test('add・remove はそのキーに書き込む', async () => {
		await resetStorage(page, {'todo-group': ['A']});
		await page.evaluate(() => window.renderHook(window.main.useStorageList, 'todo-group'));
		await waitFor(() => window.state.hook.allList.length === 1);
		await page.evaluate(() => window.state.hook.add('B'));
		await waitFor(() => chrome.storage.local.get('todo-group').then(items => items['todo-group'].length === 2));
		await page.evaluate(() => window.state.hook.remove('A'));
		await waitFor(() => chrome.storage.local.get('todo-group').then(items => items['todo-group'].length === 1));
		assert.deepEqual(await storage(), {'todo-group': ['B']});
	});
});

describe('useRecordList', () => {
	const today = new Date(now);
	const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1, 9).getTime();
	const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1, 9).getTime();
	const recordOf = (start, title) => ({start, end: start + 3600e3, type: '開発', title});
	/** 保存する形式 (ToDo を参照しない記録の配列) */
	const savedOf = (start, title) => [start, 3600e3, '開発', title];
	const mount = async (count, todos = []) => {
		// ToDo を読み込んでから読み込む
		await page.evaluate(todos => window.renderHook(window.main.useRecordList, todos, true), todos);
		await waitFor(count => window.state.hook.allList.length === count, count);
	};

	test('月ごとのキーから TimeRecord として読み込む', async () => {
		await resetStorage(page, {
			[recordKeyOf(lastMonth)]: [recordOf(lastMonth, '先月')],
			[recordKeyOf(thisMonth)]: [recordOf(thisMonth, '今月')],
		});
		await mount(2);
		assert.deepEqual(await page.evaluate(() => window.state.hook.allList.map(r => [r instanceof window.utils.TimeRecord, r.title])), [
			[true, '先月'],
			[true, '今月'],
		]);
	});

	test('以前の形式 (record に全件) なら、読み込んだときに月ごとのキーに移し、項目名を省いた配列にする', async () => {
		await resetStorage(page, {record: [recordOf(lastMonth, '先月'), recordOf(thisMonth, '今月')]});
		await mount(2);
		await waitFor(() => chrome.storage.local.get(null).then(items => !('record' in items)));
		assert.deepEqual(await storage(), {
			[recordKeyOf(lastMonth)]: [savedOf(lastMonth, '先月')],
			[recordKeyOf(thisMonth)]: [savedOf(thisMonth, '今月')],
		});
	});

	test('分類・タイトルが一致する ToDo があれば、その ToDo を ID で参照する', async () => {
		await resetStorage(page, {[recordKeyOf(thisMonth)]: [recordOf(thisMonth, '今月')]});
		await mount(1, [{id: 3, type: '開発', title: '今月'}]);
		await waitFor(key => chrome.storage.local.get(key).then(items => Array.isArray(items[key][0])), recordKeyOf(thisMonth));
		assert.deepEqual(await storage(), {[recordKeyOf(thisMonth)]: [[thisMonth, 3600e3, 3]]});
	});

	test('記録を書き換えて save すると、その記録の月のキーだけを書き込む', async () => {
		await resetStorage(page, {
			[recordKeyOf(lastMonth)]: [recordOf(lastMonth, '先月')],
			[recordKeyOf(thisMonth)]: [recordOf(thisMonth, '今月')],
		});
		await mount(2);
		await page.evaluate(() => {
			window.state.changedKeys = [];
			const listener = changes => window.state.changedKeys.push(...Object.keys(changes));
			chrome.storage.onChanged.addListener(listener);
			window.cleanups.push(() => chrome.storage.onChanged.removeListener(listener));
			window.state.hook.allList[1].setTitle('今月 (変更)');
			window.state.hook.save();
		});
		await waitFor(() => window.state.changedKeys.length > 0);
		assert.deepEqual(await page.evaluate(() => window.state.changedKeys), [recordKeyOf(thisMonth)]);
		assert.equal((await storage())[recordKeyOf(thisMonth)][0][3], '今月 (変更)');
	});

	test('add・remove で、その月のキーを書き換える。空になった月のキーは消す', async () => {
		await resetStorage(page, {[recordKeyOf(lastMonth)]: [recordOf(lastMonth, '先月')]});
		await mount(1);
		await page.evaluate(record => window.state.hook.add(window.utils.TimeRecord.load(record)), recordOf(thisMonth, '今月'));
		await waitFor(key => chrome.storage.local.get(key).then(items => items[key]?.length === 1), recordKeyOf(thisMonth));
		await page.evaluate(() => window.state.hook.remove(window.state.hook.allList[0]));
		await waitFor(key => chrome.storage.local.get(key).then(items => !(key in items)), recordKeyOf(lastMonth));
		assert.deepEqual(await storage(), {[recordKeyOf(thisMonth)]: [savedOf(thisMonth, '今月')]});
	});
});
