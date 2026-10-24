import {describe, it, mock, afterEach} from 'node:test';
import assert from 'node:assert/strict';

import {
	startOfDate,
	TimeRecord,
	Formats,
	todoKeyOf,
	addRecordsToTodoWorkTimes,
	calculateRemainingTime,
	escapeCharacterClassMetaChar,
	createDebouncedWriter,
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

	it('load で開始・終了時刻を復元する', () => {
		const record = TimeRecord.load({type: '作業', title: 'タイトル', start: 1000, end: 2000});
		assert.ok(record instanceof TimeRecord);
		assert.deepEqual({...record}, {type: '作業', title: 'タイトル', start: 1000, end: 2000});
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

describe('addRecordsToTodoWorkTimes', () => {
	const todo = {type: 'A', title: 't'};
	const createTodoWorkTimes = () => [{todo, total: 0, subtotalByDate: new Map()}];
	const todoIndexByKey = new Map([[todoKeyOf(todo), 0]]);

	it('一致する ToDo の合計と日付ごとの小計に加算する', () => {
		const start = localTime(2026, 9, 23, 9, 0);
		const records = [
			TimeRecord.load({...todo, start, end: start + 60000}),
			TimeRecord.load({...todo, memo: 'メモは無視', start: start + 60000, end: start + 180000}),
			TimeRecord.load({type: 'B', start, end: start + 60000}),
		];
		const [result] = addRecordsToTodoWorkTimes(createTodoWorkTimes(), todoIndexByKey, records);
		assert.equal(result.total, 180);
		assert.deepEqual([...result.subtotalByDate], [[Formats.localeDateString(start), 180]]);
	});

	it('引数の配列と要素を変更しない', () => {
		const todoWorkTimes = createTodoWorkTimes();
		const original = todoWorkTimes[0];
		const result = addRecordsToTodoWorkTimes(todoWorkTimes, todoIndexByKey, [
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

describe('createDebouncedWriter', () => {
	afterEach(() => mock.timers.reset());
	const setup = () => {
		mock.timers.enable({apis: ['setTimeout']});
		const written = [];
		const writer = createDebouncedWriter(value => written.push(value), 1000);
		return {written, writer};
	};

	it('続けて呼ぶと、最後の呼び出しから delayMs 後に最後の値を1回だけ書き込む', () => {
		const {written, writer} = setup();
		writer.writeSoon('a');
		mock.timers.tick(999);
		writer.writeSoon('ab');
		mock.timers.tick(999);
		assert.deepEqual(written, []);
		mock.timers.tick(1);
		assert.deepEqual(written, ['ab']);
		mock.timers.tick(5000);
		assert.deepEqual(written, ['ab']);
	});

	it('flush で待っている書き込みをすぐ行い、待っていなければ何もしない', () => {
		const {written, writer} = setup();
		writer.flush();
		writer.writeSoon('a');
		writer.flush();
		assert.deepEqual(written, ['a']);
		mock.timers.tick(1000);
		writer.flush();
		assert.deepEqual(written, ['a']);
	});

	it('writeNow は待っている書き込みを捨ててすぐ書き込む', () => {
		const {written, writer} = setup();
		writer.writeSoon('a');
		writer.writeNow('b');
		assert.deepEqual(written, ['b']);
		mock.timers.tick(1000);
		assert.deepEqual(written, ['b']);
	});
});
