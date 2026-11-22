// E2E 用: 拡張を読み込んだ Chromium の起動と、storage の読み書き
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {isRecordKey, loadRecords} from '../../chrome-extension/record-storage.js';
import {TimeRecord} from '../../chrome-extension/utils.js';

const extensionDir = fileURLToPath(new URL('../../chrome-extension', import.meta.url));

/**
 * 拡張を読み込んだ Chromium を起動する。テストが失敗しても、ファイルのテストが終わったら閉じる
 * @param {import('playwright').BrowserContextOptions} [options]
 * @returns {Promise<{
 * 	ctx: import('playwright').BrowserContext;
 * 	base: string;
 * 	errors: string[];
 * }>} errors は全ページの例外とコンソールのエラー
 */
export const launchExtension = async (options = {}) => {
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'time-tracker-e2e-'));
	// headless shell (channel なし) では拡張の service worker が起動しない
	const ctx = await chromium.launchPersistentContext(userDataDir, {
		...options,
		headless: true,
		channel: 'chromium',
		args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
	});
	after(async () => {
		await ctx.close();
		fs.rmSync(userDataDir, {recursive: true, force: true});
	});
	const errors = [];
	ctx.on('weberror', e => errors.push(e.error().message));
	ctx.on('console', m => m.type() === 'error' && errors.push(m.text()));
	let [sw] = ctx.serviceWorkers();
	if (!sw) sw = await ctx.waitForEvent('serviceworker');
	const base = `chrome-extension://${new URL(sw.url()).host}`;
	// インストール時に拡張が main.html のタブを開く (background.js の onInstalled)。
	// 遅れて開くので、テスト中に開くと clock.install などが失敗し、storage の読み書きも混ざる。開くのを待って閉じておく
	const installedUrl = `${base}/main.html`;
	const installedPage = ctx.pages().find(p => p.url() === installedUrl)
		?? await ctx.waitForEvent('page', {predicate: p => p.url() === installedUrl});
	await installedPage.close();
	return {ctx, base, errors};
};

/**
 * storage を空にしてから items を入れる
 * @param {import('playwright').Page} page 拡張のページ
 * @param {Object<string, any>} items
 */
export const resetStorage = (page, items) => page.evaluate(items => chrome.storage.local.clear().then(() => chrome.storage.local.set(items)), items);

/**
 * 保存した記録 1 件を、項目名のある形にする（配列なら TimeRecord.load で読み、ToDo を参照していれば ToDo の分類・タイトル・メモで埋める）
 * @param {any} record
 * @param {Map<number, any>} todoById
 */
export const recordObjectOf = (record, todoById) => {
	if (!Array.isArray(record)) return record;
	const {start, end, type, title, memo} = TimeRecord.load(record, todoById);
	return {start, ...(end === undefined ? {} : {end}), type, ...(title == null ? {} : {title}), ...(memo ? {memo} : {})};
};

/**
 * storage の内容の記録のキー (record・record.YYYY-MM) を、項目名のある形にする
 * @param {Object<string, any>} items
 */
export const withRecordObjects = items => {
	const todoById = new Map((items.todo ?? []).map(todo => [todo.id, todo]));
	return Object.fromEntries(Object.entries(items).map(([key, value]) => [
		key,
		isRecordKey(key) && Array.isArray(value) ? value.map(r => recordObjectOf(r, todoById)) : value,
	]));
};

/**
 * storage の内容から記録を取り出す（月ごとのキーをまとめ、項目名のある形にする）
 * @param {Object<string, any>} items
 */
export const recordsOf = items => loadRecords(withRecordObjects(items)).records;

/**
 * @param {import('playwright').Page} page 拡張のページ
 */
export const readStorage = page => page.evaluate(() => chrome.storage.local.get(null));

/**
 * @param {import('playwright').Page} page 拡張のページ
 */
export const readRecords = async page => recordsOf(await readStorage(page));

/**
 * 日付入力欄の値の形 (YYYY-MM-DD、ローカル時刻)
 * @param {number | Date} date
 */
export const isoDate = date => new Date(date).toLocaleDateString('sv-SE');

/**
 * main.js の部品を 1 つずつ動かすページを開く（ファイルの先頭で 1 回呼ぶ）
 * main.html が読み込んだ main.js・utils.js を import し直す（同じ URL なので同じモジュールが返り、もう一度は実行されない）
 * ページには次を置く
 * - window.main / window.utils: main.js / utils.js のモジュール
 * - window.render(element): 部品を #component-under-test に描画し終えてから戻る。テストが終わるたびに unmount する
 * - window.renderHook(hook, ...args): フックを呼ぶだけの部品を描画し、最新の戻り値を window.state.hook に置く
 * - window.spy(name): 呼ばれた引数を window.calls[name] に残す関数
 * - window.state: テストの中で使う値の置き場（テストが終わるたびに空にする）
 * - window.cleanups: テストが終わるときに呼ぶ関数（storage.onChanged のリスナーを外すなど）
 * window.confirm・window.alert は、テストで置き換えても、終わるたびに元に戻す
 * 時計は now (その月の 15 日 12:00) で止めてあり、page.clock.runFor で進めた分だけ時間がたつ。ページのエラーは、起きたテストで失敗させる
 * @param {Object<string, any>} [items] storage に入れておく内容
 */
export const openComponentPage = async (items = {}) => {
	const {ctx, base, errors} = await launchExtension();
	const page = await ctx.newPage();
	// 日付の境目で結果が変わらないように、時刻を決めておく
	const today = new Date();
	const now = new Date(today.getFullYear(), today.getMonth(), 15, 12).getTime();
	// pauseAt は先の時刻にしか止められない。ページを開く前にすぐ止め、遅いマシンでも過ぎないように 1 分前から始める
	// (まだページを開いていないので、1 分進めても動くタイマーはない)
	await page.clock.install({time: now - 60e3});
	await page.clock.pauseAt(now);
	await page.goto(`${base}/main.html`);
	await resetStorage(page, items);
	await page.evaluate(async base => {
		window.main = await import(`${base}/main.js`);
		window.utils = await import(`${base}/utils.js`);
		window.mounted = [];
		window.cleanups = [];
		window.calls = {};
		window.state = {};
		window.original = {confirm: window.confirm, alert: window.alert};
		window.spy = name => (...args) => (window.calls[name] ??= []).push(args);
		window.render = element => {
			const container = document.createElement('div');
			container.id = 'component-under-test';
			document.body.append(container);
			const root = ReactDOM.createRoot(container);
			// 描画が終わってから戻る（テストがすぐ要素を探せるように）
			ReactDOM.flushSync(() => root.render(element));
			window.mounted.push(() => {
				root.unmount();
				container.remove();
			});
		};
		window.unmountAll = () => window.mounted.splice(0).forEach(unmount => unmount());
		window.renderHook = (hook, ...args) => window.render(React.createElement(() => {
			window.state.hook = hook(...args);
			return null;
		}));
		// 時計を止めているので setTimeout は使えない。タスクを 1 つ待つ
		window.nextTask = () => new Promise(resolve => {
			const channel = new MessageChannel();
			channel.port1.onmessage = resolve;
			channel.port2.postMessage(null);
		});
	}, base);
	afterEach(async () => {
		await page.evaluate(() => {
			window.unmountAll();
			window.cleanups.splice(0).forEach(cleanup => cleanup());
			Object.assign(window, window.original);
			window.calls = {};
			window.state = {};
		});
		assert.deepEqual(errors.splice(0), []);
	});
	return {
		page,
		errors,
		now,
		container: page.locator('#component-under-test'),
		/** @param {string} name */
		calls: name => page.evaluate(name => window.calls[name] ?? [], name),
		unmountAll: () => page.evaluate(() => window.unmountAll()),
		nextTask: () => page.evaluate(() => window.nextTask()),
		/**
		 * fn が true を返すまで待つ。時計を止めているので、requestAnimationFrame ではなく一定の間隔で見る
		 * @template T
		 * @param {(arg: T) => any} fn ページで呼ぶ関数
		 * @param {T} [arg]
		 */
		waitFor: (fn, arg) => page.waitForFunction(fn, arg, {polling: 100}),
	};
};
