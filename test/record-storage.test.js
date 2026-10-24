import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
	isRecordKey,
	recordKeyOf,
	groupRecordsByKey,
	loadRecords,
	planRecordSave,
	markUnsaved,
} from '../chrome-extension/record-storage.js';

// 月の境目はローカル時刻で決まるため、ローカル時刻で作る
const at = (year, month, date, hours = 0) => new Date(year, month - 1, date, hours).getTime();
const r = (start, title) => ({start, type: '開発', title});

describe('isRecordKey', () => {
	it('以前のキーと月ごとのキーを記録のキーとみなす', () => {
		assert.equal(isRecordKey('record'), true);
		assert.equal(isRecordKey('record.2026-10'), true);
		assert.equal(isRecordKey('todo'), false);
		assert.equal(isRecordKey('records'), false);
	});
});

describe('recordKeyOf', () => {
	it('開始日のローカル時刻の年月にする', () => {
		assert.equal(recordKeyOf(at(2026, 1, 1)), 'record.2026-01');
		assert.equal(recordKeyOf(at(2026, 10, 31, 23)), 'record.2026-10');
		assert.equal(recordKeyOf(at(2026, 11, 1)), 'record.2026-11');
	});
});

describe('groupRecordsByKey', () => {
	it('月ごとに分け、月の中の順番は保つ', () => {
		const a = r(at(2026, 9, 30, 9), 'a');
		const b = r(at(2026, 10, 1, 9), 'b');
		const c = r(at(2026, 9, 1, 9), 'c');
		assert.deepEqual([...groupRecordsByKey([a, b, c])], [
			['record.2026-09', [a, c]],
			['record.2026-10', [b]],
		]);
	});
});

describe('loadRecords', () => {
	const sep = r(at(2026, 9, 30), 'sep');
	const oct = r(at(2026, 10, 1), 'oct');

	it('月ごとのキーを月の順につなげる', () => {
		const items = {'record.2026-10': [oct], todo: [], 'record.2026-09': [sep]};
		const {records, savedJson} = loadRecords(items);
		assert.deepEqual(records, [sep, oct]);
		assert.deepEqual([...savedJson.keys()].sort(), ['record.2026-09', 'record.2026-10']);
		assert.deepEqual(planRecordSave(records, savedJson), {items: {}, removeKeys: [], savedJson}, '移行するものはない');
	});

	it('以前のキーだけなら、それを使う', () => {
		const {records} = loadRecords({record: [sep, oct]});
		assert.deepEqual(records, [sep, oct]);
	});

	it('月ごとのキーがあれば、消し損ねた以前のキーは使わない（重複させない）', () => {
		const {records, savedJson} = loadRecords({record: [sep, oct], 'record.2026-09': [sep], 'record.2026-10': [oct]});
		assert.deepEqual(records, [sep, oct]);
		assert.deepEqual(planRecordSave(records, savedJson).removeKeys, ['record'], '以前のキーは消す');
	});

	it('変換した後の JSON を保存済みの内容とする（プロパティの順番が変わっても書き直さない）', () => {
		const stored = {start: at(2026, 10, 1), end: at(2026, 10, 1, 1), type: '開発'};
		const transform = ({start, type, end}) => ({start, type, end});
		const {records, savedJson} = loadRecords({'record.2026-10': [stored]}, transform);
		assert.deepEqual(planRecordSave(records, savedJson).items, {});
	});

	it('配列でない record.* のキーは無視する', () => {
		assert.deepEqual(loadRecords({'record.x': {}, 'record.y': null, 'record.2026-10': [oct]}).records, [oct]);
	});

	it('記録がなければ空', () => {
		assert.deepEqual(loadRecords({todo: []}).records, []);
	});
});

describe('planRecordSave', () => {
	it('初回はすべての月を書き込む', () => {
		const sep = r(at(2026, 9, 30), 'sep');
		const oct = r(at(2026, 10, 1), 'oct');
		const {items, removeKeys} = planRecordSave([sep, oct], new Map());
		assert.deepEqual(items, {'record.2026-09': [sep], 'record.2026-10': [oct]});
		assert.deepEqual(removeKeys, []);
	});

	it('書き換えた記録のある月だけを書き込む', () => {
		const sep = r(at(2026, 9, 30), 'sep');
		const oct = r(at(2026, 10, 1), 'oct');
		const {savedJson} = planRecordSave([sep, oct], new Map());
		oct.title = 'changed';
		const next = planRecordSave([sep, oct], savedJson);
		assert.deepEqual(next.items, {'record.2026-10': [oct]});
		assert.deepEqual(next.removeKeys, []);
		assert.equal(next.savedJson.get('record.2026-10'), JSON.stringify([oct]));
	});

	it('変わっていなければ何も書き込まない', () => {
		const records = [r(at(2026, 10, 1), 'oct')];
		const {savedJson} = planRecordSave(records, new Map());
		assert.deepEqual(planRecordSave(records, savedJson).items, {});
	});

	it('記録がなくなった月と以前のキーは消す', () => {
		const sep = r(at(2026, 9, 30), 'sep');
		const oct = r(at(2026, 10, 1), 'oct');
		const {savedJson} = loadRecords({record: [sep, oct], 'record.2026-09': [sep], 'record.2026-10': [oct]});
		// 開始日を別の月に変えた
		sep.start = at(2026, 10, 2);
		const {items, removeKeys} = planRecordSave([sep, oct], savedJson);
		assert.deepEqual(items, {'record.2026-10': [sep, oct]});
		assert.deepEqual(removeKeys.sort(), ['record', 'record.2026-09']);
	});

	it('以前のキーからの移行では、全件を月ごとに書き込んで以前のキーを消す', () => {
		const sep = r(at(2026, 9, 30), 'sep');
		const oct = r(at(2026, 10, 1), 'oct');
		const {records, savedJson} = loadRecords({record: [sep, oct]});
		const {items, removeKeys} = planRecordSave(records, savedJson);
		assert.deepEqual(items, {'record.2026-09': [sep], 'record.2026-10': [oct]});
		assert.deepEqual(removeKeys, ['record']);
	});
});

describe('markUnsaved', () => {
	it('書き込めなかった月は書き直し、消せなかったキーは消し直す', () => {
		const sep = r(at(2026, 9, 30), 'sep');
		const oct = r(at(2026, 10, 1), 'oct');
		const {records, savedJson} = loadRecords({record: [sep, oct]});
		const plan = planRecordSave(records, savedJson);
		markUnsaved(plan.savedJson, plan);
		const retry = planRecordSave(records, plan.savedJson);
		assert.deepEqual(retry.items, plan.items);
		assert.deepEqual(retry.removeKeys, ['record']);
	});

	it('後の保存で書き込んだ月は、保存済みのまま', () => {
		const sep = r(at(2026, 9, 30), 'sep');
		const oct = r(at(2026, 10, 1), 'oct');
		const first = planRecordSave([sep, oct], new Map());
		const failed = planRecordSave([sep, {...oct, title: 'changed'}], first.savedJson);
		markUnsaved(failed.savedJson, failed);
		assert.deepEqual([...failed.savedJson.keys()], ['record.2026-09']);
	});
});
