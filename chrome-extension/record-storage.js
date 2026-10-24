// 記録を開始月ごとのキー (record.YYYY-MM) に分けて保存する。chrome API に依存しない処理だけを置く（Node のテストからも読み込む）
// 1つのキーに全件を保存すると、1文字入力するたびに全件を書き直すことになるため、変わった月だけ書き込む
import {Formats} from './utils.js';

/** 月ごとに分ける前に、全件を1つの配列で保存していたキー */
const LEGACY_RECORD_KEY = 'record';
const RECORD_KEY_PREFIX = 'record.';

/**
 * @param {string} key
 */
export const isRecordKey = key => key === LEGACY_RECORD_KEY || key.startsWith(RECORD_KEY_PREFIX);

/**
 * 記録を保存するキー（開始日のローカル時刻の年月）
 * @param {number} start
 */
export const recordKeyOf = start => {
	const date = new Date(start);
	return `${RECORD_KEY_PREFIX}${date.getFullYear()}-${Formats.padStart0(date.getMonth() + 1)}`;
};

/**
 * 記録を月ごとのキーに分ける
 * @template {{start: number}} T
 * @param {T[]} records
 * @returns {Map<string, T[]>}
 */
export const groupRecordsByKey = records => Map.groupBy(records, ({start}) => recordKeyOf(start));

/**
 * storage の内容から記録を取り出す
 * 月ごとのキーがあれば、以前のキーは移行の後に消し損ねたものなので使わない（両方使うと記録が重複する）
 * @template T
 * @param {Object<string, any>} items
 * @param {function(any): T=} transform 読み込んだ記録を変換する（保存済みの内容は変換した後の JSON で持つ）
 * @returns {{
 * 	records: T[];
 * 	savedJson: Map<string, string>;
 * }} savedJson は planRecordSave に渡す、保存済みの内容
 */
export const loadRecords = (items, transform = record => record) => {
	const keys = Object.keys(items).filter(isRecordKey);
	const monthKeys = keys.filter(key => key !== LEGACY_RECORD_KEY).sort();
	const lists = new Map((monthKeys.length ? monthKeys : keys).map(key => [key, items[key].map(transform)]));
	return {
		records: [...lists.values()].flat(),
		// 変換するとプロパティの順番が変わることがあるため、変換した後の JSON で比べる（使わない以前のキーは消すためだけに持つ）
		savedJson: new Map(keys.map(key => [key, lists.has(key) ? JSON.stringify(lists.get(key)) : ''])),
	};
};

/**
 * 前回保存した内容と比べて、書き込む月と消すキーを求める
 * 記録は書き換えられる (mutable) ため、変わったかどうかは JSON で比べる
 * @template {{start: number}} T
 * @param {T[]} records
 * @param {Map<string, string>} savedJson キーごとの前回保存した JSON
 * @returns {{
 * 	items: Object<string, T[]>;
 * 	removeKeys: string[];
 * 	savedJson: Map<string, string>;
 * }} items を書き込んでから removeKeys を消す。savedJson は次回に渡す
 */
export const planRecordSave = (records, savedJson) => {
	/** @type {Object<string, T[]>} */
	const items = {};
	const nextSavedJson = new Map();
	for (const [key, list] of groupRecordsByKey(records)) {
		const json = JSON.stringify(list);
		nextSavedJson.set(key, json);
		if (savedJson.get(key) !== json) items[key] = list;
	}
	const removeKeys = [...savedJson.keys()].filter(key => !nextSavedJson.has(key));
	return {items, removeKeys, savedJson: nextSavedJson};
};
