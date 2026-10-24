import {describe, it, mock, afterEach} from 'node:test';
import assert from 'node:assert/strict';

import {
	startOfDate,
	TimeRecord,
	Formats,
	todoKeyOf,
	parseRecordData,
	MISSING_TODO_TYPE,
	nextTodoId,
	assignTodoIds,
	createTodoIndex,
	linkRecordsToTodos,
	addRecordsToTodoWorkTimes,
	calculateRemainingTime,
	escapeCharacterClassMetaChar,
} from '../chrome-extension/utils.js';

// 実行環境のタイムゾーンに依存しないよう、日時はローカル時刻で組み立てる
const localTime = (...args) => new Date(...args).getTime();

describe('startOfDate', () => {
	it('同じ日の 0:00 にする', () => {
		assert.equal(startOfDate(new Date(2026, 9, 23, 12, 34, 56, 789)).getTime(), localTime(2026, 9, 23));
	});
});

describe('TimeRecord', () => {
	afterEach(() => {
		mock.timers.reset();
	});

	const todo = {id: 7, type: '開発', title: 'レビュー', memo: 'https://example.com/7'};
	const todoById = new Map([[todo.id, todo]]);
	/** @param {TimeRecord} record */
	const fieldsOf = ({start, end, todo, type, title, memo}) => ({start, end, todo, type, title, memo});

	it('load で以前の形式（項目名のあるオブジェクト）を読み込む', () => {
		const record = TimeRecord.load({type: '作業', title: 'タイトル', memo: 'メモ', start: 1000, end: 2000});
		assert.ok(record instanceof TimeRecord);
		assert.deepEqual(fieldsOf(record), {start: 1000, end: 2000, todo: undefined, type: '作業', title: 'タイトル', memo: 'メモ'});
	});

	it('ToDo を参照する記録は、項目名を省いた配列で ID と経過時間を保存する', () => {
		const record = TimeRecord.load({start: 1000, end: 61000, type: '開発', title: 'レビュー', memo: todo.memo});
		record.linkTodo(todo);
		assert.deepEqual(JSON.parse(JSON.stringify(record)), [1000, 60000, 7]);
		assert.deepEqual(fieldsOf(TimeRecord.load([1000, 60000, 7], todoById)), {
			start: 1000, end: 61000, todo, type: '開発', title: 'レビュー', memo: 'https://example.com/7',
		});
	});

	it('ToDo を参照しない記録は分類・タイトル・メモを保存し、計測中の経過時間と途中の未設定項目は null にする', () => {
		const record = TimeRecord.load({start: 1000, type: '作業', memo: 'メモ'});
		const saved = JSON.parse(JSON.stringify(record));
		assert.deepEqual(saved, [1000, null, '作業', null, 'メモ']);
		assert.deepEqual(fieldsOf(TimeRecord.load(saved)), fieldsOf(record));
		assert.deepEqual(JSON.parse(JSON.stringify(TimeRecord.load({start: 1000, end: 1000, type: '作業'}))), [1000, 0, '作業']);
	});

	it('ToDo を参照する記録のメモは、記録で入力したものを ToDo のメモより優先する（空欄も含む）', () => {
		const record = new TimeRecord(todo);
		assert.equal(record.memo, todo.memo);
		record.setMemo('');
		assert.equal(record.memo, '');
		assert.equal(todo.memo, 'https://example.com/7');
	});

	it('ToDo を参照する記録は ToDo の分類・タイトルの変更を引き継ぐ', () => {
		const renamed = {...todo};
		const record = new TimeRecord(renamed);
		renamed.title = '新しいタイトル';
		assert.equal(record.title, '新しいタイトル');
	});

	it('記録でタイトルを変えると ToDo の参照をやめ、ToDo は変えない', () => {
		const record = new TimeRecord(todo);
		record.setTitle('別の作業');
		assert.deepEqual(fieldsOf(record), {
			start: record.start, end: undefined, todo: undefined, type: '開発', title: '別の作業', memo: 'https://example.com/7',
		});
		assert.equal(todo.title, 'レビュー');
	});

	it('linkTodo で参照し直すと、ToDo と同じメモは記録から消す', () => {
		const record = TimeRecord.load({start: 1000, type: '開発', title: 'レビュー', memo: todo.memo});
		record.linkTodo(todo);
		assert.deepEqual(JSON.parse(JSON.stringify(record)), [1000, null, 7]);
		const other = TimeRecord.load({start: 1000, type: '開発', title: 'レビュー', memo: '個別のメモ'});
		other.linkTodo(todo);
		assert.deepEqual(JSON.parse(JSON.stringify(other)), [1000, null, 7, '個別のメモ']);
	});

	it('linkTodo で参照しても、メモのない記録に ToDo のメモを表示しない', () => {
		const record = TimeRecord.load({start: 1000, type: '開発', title: 'レビュー'});
		record.linkTodo(todo);
		assert.equal(record.memo, '');
		const noMemoTodo = {id: 8, type: '開発', title: '設計'};
		const other = TimeRecord.load({start: 1000, type: '開発', title: '設計'});
		other.linkTodo(noMemoTodo);
		assert.deepEqual(JSON.parse(JSON.stringify(other)), [1000, null, 8]);
	});

	it('再開した記録は元の記録と同じ ToDo を参照する', () => {
		const original = TimeRecord.load([1000, 60000, 7, 'メモ'], todoById);
		const resumed = new TimeRecord(original);
		assert.equal(resumed.todo, todo);
		assert.equal(resumed.memo, 'メモ');
		assert.equal(resumed.end, undefined);
	});

	it('参照先の ToDo が見つからなくても、ID を失わずに保存し直す', () => {
		const record = TimeRecord.load([1000, 60000, 99]);
		assert.equal(record.type, MISSING_TODO_TYPE);
		assert.deepEqual(JSON.parse(JSON.stringify(record)), [1000, 60000, 99]);
	});

	it('finish は終了済みの記録の終了時刻を変えない', () => {
		const record = TimeRecord.load({type: '作業', start: 1000, end: 2000});
		record.finish();
		assert.equal(record.end, 2000);
	});

	it('終了済みの記録の作業時間は開始から終了まで (秒未満は切り捨て)', () => {
		const record = TimeRecord.load({type: '作業', start: 0, end: 90999});
		assert.equal(record.workTimeSeconds, 90);
	});

	it('今日の計測中の記録の作業時間は現在時刻まで', () => {
		mock.timers.enable({apis: ['Date'], now: localTime(2026, 9, 23, 10, 0)});
		const record = TimeRecord.load({type: '作業', start: localTime(2026, 9, 23, 9, 0)});
		assert.equal(record.workTimeSeconds, 60 * 60);
	});

	it('前日以前の計測中の記録の作業時間は開始日の 24:00 まで', () => {
		mock.timers.enable({apis: ['Date'], now: localTime(2026, 9, 23, 10, 0)});
		const record = TimeRecord.load({type: '作業', start: localTime(2026, 9, 22, 23, 0)});
		assert.equal(record.endOfStartDate, localTime(2026, 9, 23));
		assert.equal(record.workTimeSeconds, 60 * 60);
	});

	it('isDateOf は指定日以降に開始した記録で true', () => {
		const record = TimeRecord.load({type: '作業', start: localTime(2026, 9, 23)});
		assert.equal(record.isDateOf(new Date(2026, 9, 23)), true);
		assert.equal(record.isDateOf(new Date(2026, 9, 24)), false);
	});
});

describe('Formats', () => {
	it('seconds は時・分・秒を必要な単位だけで表す', () => {
		assert.equal(Formats.seconds(5), '05秒');
		assert.equal(Formats.seconds(65), '01分05秒');
		assert.equal(Formats.seconds(3600 + 65), '1時間01分05秒');
		assert.equal(Formats.seconds(25 * 3600), '25時間00分00秒');
	});

	it('ISODateTimeString は datetime-local の値 (ローカル時刻・秒まで)', () => {
		assert.equal(Formats.ISODateTimeString(localTime(2026, 0, 2, 3, 4, 5, 678)), '2026-01-02T03:04:05');
	});

	it('ISODateString はローカルの日付', () => {
		assert.equal(Formats.ISODateString(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
	});

	it('locale*String は不正な値で例外にせず Invalid Date を返す', () => {
		assert.equal(Formats.localeDateString(NaN), 'Invalid Date');
		assert.equal(Formats.localeDateTimeString(NaN), 'Invalid Date');
		assert.equal(Formats.localeTimeString(NaN), 'Invalid Date');
		assert.equal(Formats.localeDeadlineDateString(NaN), 'Invalid Date');
	});
});

describe('todoKeyOf', () => {
	it('分類とタイトルが同じならメモが違っても同じキー', () => {
		assert.equal(todoKeyOf({type: 'A', title: 't', memo: 'x'}), todoKeyOf({type: 'A', title: 't', memo: 'y'}));
	});

	it('タイトルなしと空文字のタイトルは同じキー', () => {
		assert.equal(todoKeyOf({type: 'A'}), todoKeyOf({type: 'A', title: ''}));
	});

	it('区切り文字を含んでも別の組み合わせと衝突しない', () => {
		assert.notEqual(todoKeyOf({type: 'A","B', title: ''}), todoKeyOf({type: 'A', title: 'B'}));
	});
});

describe('parseRecordData', () => {
	it('配列の経過時間から終了時刻を求める', () => {
		assert.deepEqual(parseRecordData([1000, 500, 3, 'm']), {start: 1000, end: 1500, todoId: 3, memo: 'm'});
		assert.deepEqual(parseRecordData([1000, null, 'a', 't']), {start: 1000, end: undefined, type: 'a', title: 't', memo: undefined});
	});

	it('以前の形式の end: null は計測中', () => {
		assert.equal(parseRecordData({start: 1, end: null, type: 'a'}).end, undefined);
	});
});

describe('ToDo の ID', () => {
	it('nextTodoId は最大の ID の次（ID がなければ 1）', () => {
		assert.equal(nextTodoId([]), 1);
		assert.equal(nextTodoId([{id: 3}, {id: 10, deleted: true}, {}]), 11);
	});

	it('assignTodoIds は ID のない ToDo にだけ、既存の ID と重ならない ID を振る', () => {
		const todos = [{type: 'a', title: '1'}, {id: 5, type: 'a', title: '2'}, {type: 'a', title: '3'}];
		assert.deepEqual(assignTodoIds(todos).map(({id}) => id), [6, 5, 7]);
		assert.equal(todos[0].id, undefined);
	});

	it('assignTodoIds は ID が null の ToDo にも ID を振る', () => {
		assert.deepEqual(assignTodoIds([{id: null, type: 'a', title: ''}]), [{id: 1, type: 'a', title: ''}]);
	});

	it('assignTodoIds は全件に ID があれば同じ配列を返す', () => {
		const todos = [{id: 1, type: 'a', title: ''}];
		assert.equal(assignTodoIds(todos), todos);
	});
});

describe('createTodoIndex', () => {
	const todoA = {id: 1, type: 'A', title: 't'};
	const todoA2 = {id: 2, type: 'A', title: 't'};
	const deleted = {id: 3, type: 'B', title: 't', deleted: true};
	const {indexOf} = createTodoIndex([todoA, todoA2]);

	it('ToDo を参照する記録は、分類・タイトルが重複していてもその ToDo に集計する', () => {
		assert.equal(indexOf(new TimeRecord(todoA2)), 1);
	});

	it('ToDo を参照しない記録は、分類・タイトルが一致する先頭の ToDo に集計する', () => {
		assert.equal(indexOf(TimeRecord.load({start: 1, type: 'A', title: 't'})), 0);
		assert.equal(indexOf(TimeRecord.load({start: 1, type: 'A', title: 'x'})), undefined);
	});

	it('削除した ToDo を参照する記録は、分類・タイトルが一致する ToDo があっても集計しない', () => {
		assert.equal(indexOf(new TimeRecord({...deleted, type: 'A'})), undefined);
	});
});

describe('linkRecordsToTodos', () => {
	it('ToDo を参照していない記録を、分類・タイトルが一致する先頭の ToDo の参照にする', () => {
		const todo = {id: 1, type: 'A', title: 't'};
		const other = {id: 2, type: 'A', title: 'u'};
		const records = [
			TimeRecord.load({start: 1, type: 'A', title: 't'}),
			TimeRecord.load({start: 2, type: 'A', title: 'x'}),
			new TimeRecord(other),
		];
		linkRecordsToTodos(records, [todo, {id: 3, type: 'A', title: 't'}, {...other, id: 4}]);
		assert.deepEqual(records.map(record => record.todo), [todo, undefined, other]);
	});

	it('タイトルが空の記録は、分類だけの ToDo があっても参照させない（分類のボタンから開始した記録と区別できない）', () => {
		const typeOnly = {id: 1, type: '中断', title: ''};
		const record = TimeRecord.load({start: 1, type: '中断'});
		linkRecordsToTodos([record], [typeOnly]);
		assert.equal(record.todo, undefined);
		assert.equal(createTodoIndex([typeOnly]).indexOf(record), 0, '集計は分類・タイトルで続ける');
	});
});

describe('addRecordsToTodoWorkTimes', () => {
	const todo = {id: 1, type: 'A', title: 't'};
	const createTodoWorkTimes = () => [{todo, total: 0, subtotalByDate: new Map()}];
	const {indexOf} = createTodoIndex([todo]);

	it('一致する ToDo の合計と日付ごとの小計に加算する', () => {
		const start = localTime(2026, 9, 23, 9, 0);
		const records = [
			TimeRecord.load({...todo, start, end: start + 60000}),
			TimeRecord.load({...todo, memo: 'メモは無視', start: start + 60000, end: start + 180000}),
			TimeRecord.load([start + 180000, 60000, 1], new Map([[1, todo]])),
			TimeRecord.load({type: 'B', start, end: start + 60000}),
		];
		const [result] = addRecordsToTodoWorkTimes(createTodoWorkTimes(), indexOf, records);
		assert.equal(result.total, 240);
		assert.deepEqual([...result.subtotalByDate], [[Formats.localeDateString(start), 240]]);
	});

	it('引数の配列と要素を変更しない', () => {
		const todoWorkTimes = createTodoWorkTimes();
		const original = todoWorkTimes[0];
		const result = addRecordsToTodoWorkTimes(todoWorkTimes, indexOf, [
			TimeRecord.load({...todo, start: 0, end: 60000}),
		]);
		assert.notEqual(result, todoWorkTimes);
		assert.equal(todoWorkTimes[0], original);
		assert.equal(original.total, 0);
		assert.equal(original.subtotalByDate.size, 0);
	});
});

describe('calculateRemainingTime', () => {
	it('見積もり (時間) から作業時間 (秒) を引いた残り秒数', () => {
		assert.equal(calculateRemainingTime({type: 'A', title: '', estimation: '1.5'}, 1800), 3600);
	});

	it('見積もりを超えたら 0', () => {
		assert.equal(calculateRemainingTime({type: 'A', title: '', estimation: '1'}, 3601), 0);
	});

	it('見積もりがなければ 0', () => {
		assert.equal(calculateRemainingTime({type: 'A', title: ''}, 100), 0);
	});
});

describe('escapeCharacterClassMetaChar', () => {
	it('v フラグの pattern 属性で否定文字クラスに使える', () => {
		const chars = ['a', '\\', '-', ']', '(', ')', '[', '{', '}', '/', '|'];
		// input の pattern 属性は v フラグ付きで ^(?:…)$ として評価される
		const regExp = new RegExp(`^(?:[^${chars.map(escapeCharacterClassMetaChar).join('')}])$`, 'v');
		for (const char of chars) {
			assert.equal(regExp.test(char), false, char);
		}
		assert.equal(regExp.test('b'), true);
	});
});
