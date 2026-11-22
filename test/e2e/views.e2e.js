// main.js の記録・ToDo の表示部品 (RecordView・MemoRecordView・EditTimeForm・TodoRow) を、拡張のページで 1 つずつ確かめる
import {describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {openComponentPage} from './extension.js';

const {page, now, container, calls, waitFor, unmountAll, nextTask} = await openComponentPage();
const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
const at = (dayOffset, hour) => today0.getTime() + dayOffset * 864e5 + hour * 3600e3;
/** 確認ダイアログ (window.confirm) の答えを決める。聞かれた文は window.calls.confirm に残す（置き換えた confirm はテストが終わると戻る） */
const answerConfirm = answer => page.evaluate(answer => {
	const spy = window.spy('confirm');
	window.confirm = message => {
		spy(message);
		return answer;
	};
}, answer);
/** datetime-local の入力欄の値 (秒まで) */
const isoDateTime = ms => page.evaluate(ms => window.utils.Formats.ISODateTimeString(ms), ms);
/** datetime-local の値の時刻 (秒が 0 なら値から秒が省かれるので、時刻で比べる) */
const msOf = value => new Date(value).getTime();

describe('RecordView', () => {
	/**
	 * window.state.record の RecordView を描画する
	 * @param {Object} record TimeRecord.load に渡す内容
	 * @param {Object} [props] RecordView に渡すほかの props (関数は名前を書くと spy にする)
	 */
	const mount = (record, props = {}) => page.evaluate(({record, props}) => {
		window.state.record = window.utils.TimeRecord.load(record);
		const spies = Object.fromEntries(['editTime', 'finishAndAddRecord'].filter(name => props[name]).map(name => [name, window.spy(name)]));
		window.render(React.createElement(window.main.RecordView, {
			types: [{name: '開発'}, {name: 'MTG'}],
			record: window.state.record,
			save: window.spy('save'),
			// 一致する ToDo がない
			findTodo: () => undefined,
			...props,
			...spies,
		}));
	}, {record, props});
	// 項目は private なフィールドにあり getter で読むので、展開せず 1 つずつ読む
	const record = () => page.evaluate(() => {
		const {start, end, type, title, memo} = window.state.record;
		return {start, end, type, title, memo};
	});
	const saveCount = async () => (await calls('save')).length;
	const ended = {start: at(0, 9), end: at(0, 10) + 30e3, type: '開発', title: 'レビュー', memo: 'メモ'};

	test('開始～終了 (時間)、分類、タイトル、メモを出す', async () => {
		await mount(ended);
		const expected = await page.evaluate(({start, end}) => {
			const {Formats} = window.utils;
			return [
				`${Formats.localeDateTimeString(start)}～${Formats.localeTimeString(end)}(1時間00分30秒)`,
				`${Formats.localeTimeString(start)}～${Formats.localeTimeString(end)}(1時間00分30秒)`,
			];
		}, ended);
		assert.ok((await container.textContent()).startsWith(expected[0]), await container.textContent());
		assert.equal(await container.locator('select').inputValue(), '開発');
		assert.deepEqual(await container.locator('option').allTextContents(), ['開発', 'MTG']);
		assert.equal(await container.getByPlaceholder('タイトル').inputValue(), 'レビュー');
		assert.equal(await container.getByPlaceholder('メモ').inputValue(), 'メモ');
		await unmountAll();
		await mount(ended, {hideDate: true});
		assert.ok((await container.textContent()).startsWith(expected[1]), await container.textContent());
	});

	test('一覧にない分類の記録は、その分類を先頭に足して選ばせる', async () => {
		await mount({...ended, type: '削除した分類'});
		assert.deepEqual(await container.locator('option').allTextContents(), ['削除した分類', '開発', 'MTG']);
		assert.equal(await container.locator('select').inputValue(), '削除した分類');
	});

	test('分類・タイトル・メモを変えると、記録を書き換えて save を呼ぶ', async () => {
		await mount(ended);
		await container.locator('select').selectOption('MTG');
		assert.equal((await record()).type, 'MTG');
		assert.equal(await saveCount(), 1);
		const title = container.getByPlaceholder('タイトル');
		await title.fill('新しいタイトル');
		await title.blur();
		assert.equal((await record()).title, '新しいタイトル');
		const memo = container.getByPlaceholder('メモ');
		await memo.fill('新しいメモ');
		await memo.blur();
		assert.equal((await record()).memo, '新しいメモ');
		assert.equal(await saveCount(), 3);
	});

	test('分類・タイトルを変えて一致する ToDo があれば、その ToDo を参照する', async () => {
		// findTodo は関数なので mount に渡せない。ここで描画する
		await page.evaluate(record => {
			const todo = {id: 1, type: '開発', title: 'ToDo のタイトル'};
			window.state.todo = todo;
			window.state.record = window.utils.TimeRecord.load(record);
			window.render(React.createElement(window.main.RecordView, {
				types: [{name: '開発'}],
				record: window.state.record,
				save: window.spy('save'),
				findTodo: record => (record.type === todo.type && record.title === todo.title ? todo : undefined),
			}));
		}, {start: at(0, 9), end: at(0, 10), type: '開発', title: ''});
		const title = container.getByPlaceholder('タイトル');
		await title.fill('ToDo のタイトル');
		await title.blur();
		assert.equal(await page.evaluate(() => window.state.record.todo === window.state.todo), true);
		assert.equal(await saveCount(), 1);
	});

	test('計測中なら「終了」で終わらせ、終わっていれば「再開」で finishAndAddRecord を呼ぶ', async () => {
		await mount({start: at(0, 9), type: '開発'}, {finishAndAddRecord: true});
		assert.equal(await container.getByRole('button', {name: '再開'}).count(), 0);
		await container.getByRole('button', {name: '終了'}).click();
		assert.equal((await record()).end, await page.evaluate(() => Date.now()));
		assert.equal(await saveCount(), 1);
		await unmountAll();

		await mount(ended, {finishAndAddRecord: true});
		assert.equal(await container.getByRole('button', {name: '終了'}).count(), 0);
		await container.getByRole('button', {name: '再開'}).click();
		assert.equal(await page.evaluate(() => window.calls.finishAndAddRecord.length === 1 && window.calls.finishAndAddRecord[0][0] === window.state.record), true);
	});

	test('editTime があれば「時刻編集」で呼ぶ。isEditable が false なら終了・再開を出さない', async () => {
		await mount(ended, {editTime: true, isEditable: false});
		assert.deepEqual(await container.getByRole('button').allTextContents(), ['時刻編集']);
		await container.getByRole('button', {name: '時刻編集'}).click();
		assert.equal(await page.evaluate(() => window.calls.editTime[0][0] === window.state.record), true);
	});
});

describe('MemoRecordView', () => {
	/**
	 * 描画し直せる MemoRecordView を描画する。window.state.rerender(revision) で同じ記録のまま描画し直す
	 */
	const mount = record => page.evaluate(record => {
		window.state.record = window.utils.TimeRecord.load(record);
		const save = () => {};
		const types = [{name: '開発'}];
		window.render(React.createElement(() => {
			const [revision, setRevision] = React.useState(0);
			const [, setCount] = React.useState(0);
			window.state.rerender = newRevision => {
				setRevision(newRevision ?? revision);
				setCount(count => count + 1);
			};
			return React.createElement(window.main.MemoRecordView, {types, record: window.state.record, save, revision});
		}));
	}, record);
	const title = container.getByPlaceholder('タイトル');
	const changeTitleAndRerender = revision => page.evaluate(revision => {
		// 記録は書き換えられる (mutable) ので、同じ記録のまま中身だけ変える
		window.state.record.setTitle('変えたタイトル');
		window.state.rerender(revision);
	}, revision);
	const waitForTitle = value => waitFor(value => document.querySelector('#component-under-test input[placeholder="タイトル"]').value === value, value);

	test('終わった記録は、props が同じなら描画し直さず、revision が変われば描画し直す', async () => {
		await mount({start: at(0, 9), end: at(0, 10), type: '開発', title: '元のタイトル'});
		await changeTitleAndRerender(undefined);
		// 描画し直す機会を待ってから、変わっていないことを確かめる
		await nextTask();
		assert.equal(await title.inputValue(), '元のタイトル');
		await changeTitleAndRerender(1);
		await waitForTitle('変えたタイトル');
	});

	test('計測中の記録は、props が同じでも描画し直す', async () => {
		await mount({start: at(0, 9), type: '開発', title: '元のタイトル'});
		await changeTitleAndRerender(undefined);
		await waitForTitle('変えたタイトル');
	});
});

describe('EditTimeForm', () => {
	/**
	 * window.state.record (と前後の記録) の EditTimeForm を描画する
	 * @param {{record: Object, prev?: Object, next?: Object}} records TimeRecord.load に渡す内容
	 */
	const mount = records => page.evaluate(records => {
		const [record, prev, next] = ['record', 'prev', 'next'].map(key => records[key] && window.utils.TimeRecord.load(records[key]));
		Object.assign(window.state, {record, prev, next});
		window.render(React.createElement(window.main.EditTimeForm, {record, prev, next, save: window.spy('save'), remove: window.spy('remove')}));
	}, records);
	const startInput = container.getByLabel('開始');
	const endInput = container.getByLabel('終了');
	const state = () => page.evaluate(() => Object.fromEntries(['record', 'prev', 'next'].map(key => [key, window.state[key] && {start: window.state[key].start, end: window.state[key].end}])));
	const prev = {start: at(0, 8), end: at(0, 9), type: '開発'};
	const record = {start: at(0, 9) + 30e3, end: at(0, 10), type: 'MTG', title: '定例'};
	const next = {start: at(0, 11), end: at(0, 12), type: '開発'};

	test('今の時刻を出し、前後の記録と開始日の中に入力を制限する', async () => {
		await mount({record, prev, next});
		assert.equal(await container.locator('h3').textContent(), 'MTG(定例)');
		assert.equal(msOf(await startInput.inputValue()), record.start);
		assert.equal(msOf(await endInput.inputValue()), record.end);
		assert.equal(msOf(await startInput.getAttribute('min')), prev.end);
		assert.equal(msOf(await endInput.getAttribute('max')), next.start);
		assert.equal(await endInput.getAttribute('required'), '');
	});

	test('前後の記録がなければ、開始日の 0:00 から今まで (開始は 24:00 の 1 秒前まで) に制限し、今日の最後の記録は計測中に戻せる', async () => {
		await mount({record});
		assert.equal(msOf(await startInput.getAttribute('min')), at(0, 0));
		// 入力欄の時刻は秒までなので、秒未満は切り捨てて比べる
		const toSeconds = ms => Math.floor(ms / 1000) * 1000;
		assert.equal(msOf(await endInput.getAttribute('max')), toSeconds(Math.min(now, at(1, 0))));
		assert.equal(msOf(await startInput.getAttribute('max')), toSeconds(Math.min(now, at(1, 0) - 1000)));
		assert.equal(await endInput.getAttribute('required'), null);
		assert.match(await container.textContent(), /空欄にすると計測中に戻る/);
	});

	test('確定すると、変えた時刻だけを書き換えて save を呼ぶ (変えていない開始は秒も元のまま)', async () => {
		await mount({record, prev, next});
		const newEnd = (await isoDateTime(at(0, 10) + 30 * 60e3)).slice(0, 16);
		await endInput.fill(newEnd);
		await container.getByRole('button', {name: '確定'}).click();
		assert.deepEqual((await state()).record, {start: record.start, end: at(0, 10) + 30 * 60e3});
		assert.equal((await calls('save')).length, 1);
		assert.deepEqual(await calls('remove'), []);
	});

	test('「削除」は確認して OK なら remove を呼び、キャンセルなら呼ばない', async () => {
		await mount({record});
		assert.deepEqual(await container.getByRole('button').allTextContents(), ['確定', '削除']);
		await answerConfirm(false);
		await container.getByRole('button', {name: '削除'}).click();
		assert.deepEqual(await calls('remove'), []);
		await answerConfirm(true);
		await container.getByRole('button', {name: '削除'}).click();
		assert.equal(await page.evaluate(() => window.calls.remove.length === 1 && window.calls.remove[0][0] === window.state.record), true);
		assert.deepEqual(await calls('confirm'), [['この記録を削除しますか？'], ['この記録を削除しますか？']]);
		assert.deepEqual(await calls('save'), []);
	});

	test('同じ日の前後があれば、削除して前を延ばす・次を早めることもできる', async () => {
		await mount({record, prev, next});
		assert.deepEqual(await container.getByRole('button').allTextContents(), ['確定', '削除', '削除して前の記録を延ばす', '削除して次の記録を早める']);
		await answerConfirm(true);
		await container.getByRole('button', {name: '削除して前の記録を延ばす'}).click();
		assert.deepEqual((await state()).prev, {start: prev.start, end: record.end});
		await container.getByRole('button', {name: '削除して次の記録を早める'}).click();
		assert.deepEqual((await state()).next, {start: record.start, end: next.end});
		assert.equal((await calls('remove')).length, 2);
	});

	test('前日の記録が前にあっても、前を延ばす削除は出さない', async () => {
		await mount({record, prev: {start: at(-1, 22), end: at(-1, 23), type: '開発'}});
		assert.deepEqual(await container.getByRole('button').allTextContents(), ['確定', '削除']);
	});
});

describe('TodoRow', () => {
	/**
	 * window.state.todos[0] の TodoRow を描画する
	 * @param {Object} todo
	 * @param {Object} [props] TodoRow に渡すほかの props
	 */
	const mount = (todo, props = {}) => page.evaluate(({todo, props}) => {
		window.state.todos = [todo, {type: '開発', title: 'ほかの ToDo'}];
		window.render(React.createElement(window.main.TodoRow, {
			todo: window.state.todos[0],
			isTodoEditMode: false,
			usingTodoGroup: false,
			usingTodoDeadline: false,
			usingTodoEstimation: false,
			todos: window.state.todos,
			todoGroups: ['A', 'B'],
			saveTodo: window.spy('saveTodo'),
			finishAndAddRecord: window.spy('finishAndAddRecord'),
			types: [{name: '開発'}, {name: 'MTG'}],
			todoWorkTimeTatal: 1800,
			isDuplicate: false,
			showSubtotal: window.spy('showSubtotal'),
			...props,
		}));
	}, {todo, props});
	const todo = () => page.evaluate(() => window.state.todos[0]);
	const saveCount = async () => (await calls('saveTodo')).length;
	const text = () => container.textContent();

	test('表示モード: 分類 (タイトル) メモと合計時間を出し、「開始」で finishAndAddRecord を呼ぶ', async () => {
		await mount({type: '開発', title: 'レビュー', memo: 'メモ'});
		assert.equal(await text(), '開始 [30分00秒] 開発(レビュー)メモ');
		await container.getByRole('button', {name: '開始'}).click();
		assert.equal(await page.evaluate(() => window.calls.finishAndAddRecord[0][0] === window.state.todos[0]), true);
		await container.getByText('30分00秒').click();
		assert.equal((await calls('showSubtotal')).length, 1);
	});

	test('表示モード: メモが URL ならタイトルをリンクにする。重複していれば知らせる', async () => {
		await mount({type: '開発', title: 'Issue', memo: 'https://example.com/issues/1'}, {isDuplicate: true});
		const link = container.getByRole('link');
		assert.equal(await link.textContent(), '(Issue)');
		assert.equal(await link.getAttribute('href'), 'https://example.com/issues/1');
		assert.equal(await link.getAttribute('target'), '_blank');
		assert.match(await text(), /※分類・タイトルが重複/);
	});

	test('表示モード: 期限と見積もりを出す。期限切れ (今日を含む) と 3 日以内は目立たせる', async () => {
		const deadlines = [at(0, 0), at(2, 0), at(10, 0)];
		const classes = [];
		for (const deadline of deadlines) {
			await mount({type: '開発', title: 'レビュー', deadline, estimation: '2'}, {usingTodoDeadline: true, usingTodoEstimation: true});
			classes.push(await container.locator('span').first().getAttribute('class'));
			if (deadline === deadlines[0]) assert.match(await text(), /\[30分00秒 \/ 2時間00分00秒 \(25(\.0+)?%\)\]/);
			await unmountAll();
		}
		assert.deepEqual(classes, ['expired-deadline', 'close-to-deadline', null]);
	});

	test('編集モード: 確認して OK なら削除して saveTodo を呼ぶ', async () => {
		await mount({type: '開発', title: 'レビュー'}, {isTodoEditMode: true});
		await answerConfirm(false);
		await container.getByRole('button', {name: '削除'}).click();
		assert.equal(await page.evaluate(() => window.state.todos.length), 2);
		await answerConfirm(true);
		await container.getByRole('button', {name: '削除'}).click();
		// 削除した ToDo は、記録から参照できるように deleted: true にして残す
		assert.deepEqual(await page.evaluate(() => window.state.todos.filter(todo => !todo.deleted).map(todo => todo.title)), ['ほかの ToDo']);
		assert.deepEqual(await calls('confirm'), [['「開発(レビュー)」を削除しますか？'], ['「開発(レビュー)」を削除しますか？']]);
		assert.equal(await saveCount(), 1);
	});

	test('編集モード: グループ・分類・タイトル・メモ・見積もり・期限を変えて saveTodo を呼ぶ', async () => {
		await mount({type: '開発', title: 'レビュー', group: 'A'}, {isTodoEditMode: true, usingTodoGroup: true, usingTodoDeadline: true, usingTodoEstimation: true});
		const [groupSelect, typeSelect] = [container.locator('select').nth(0), container.locator('select').nth(1)];
		assert.deepEqual(await groupSelect.locator('option').allTextContents(), ['A', 'B', '(グループなし)']);
		await groupSelect.selectOption('');
		assert.equal((await todo()).group, undefined);
		await typeSelect.selectOption('MTG');
		assert.equal((await todo()).type, 'MTG');
		const commit = async (placeholder, value) => {
			const input = container.getByPlaceholder(placeholder, {exact: true});
			await input.fill(value);
			await input.blur();
		};
		await commit('タイトル', '新しいタイトル');
		await commit('メモ / URL', 'https://example.com/');
		await commit('見積もり', '1.5');
		assert.deepEqual(await todo(), {type: 'MTG', title: '新しいタイトル', memo: 'https://example.com/', estimation: '1.5', group: undefined});
		// 数でない・負の見積もりは消す
		await commit('見積もり', '-1');
		assert.equal((await todo()).estimation, undefined);
		// 期限は日付の 0:00 で持つ
		await container.getByTitle('期限').fill(await page.evaluate(ms => window.utils.Formats.ISODateString(new Date(ms)), at(3, 0)));
		assert.equal((await todo()).deadline, at(3, 0));
		assert.equal(await saveCount(), 7);
	});
});
