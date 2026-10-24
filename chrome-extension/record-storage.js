// 記録を開始月ごとのキー (record.YYYY-MM) に分けて保存する。chrome API に依存しない処理だけを置く（Node のテストからも読み込む）
// 1つのキーに全件を保存すると、1文字入力するたびに全件を書き直すことになるため、変わった月だけ書き込む

/** 月ごとに分ける前に、全件を1つの配列で保存していたキー */
export const LEGACY_RECORD_KEY = 'record';
export const RECORD_KEY_PREFIX = 'record.';

/**
 * @param {string} key
 */
export const isRecordKey = key => key === LEGACY_RECORD_KEY || key.startsWith(RECORD_KEY_PREFIX);

const pad = n => String(n).padStart(2, '0');

/**
 * 記録を保存するキー（開始日のローカル時刻の年月）
 * @param {number} start
 */
export const recordKeyOf = start => {
	const date = new Date(start);
	return `${RECORD_KEY_PREFIX}${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

/**
 * 記録を月ごとのキーに分ける
 * @template {{start: number}} T
 * @param {T[]} records
 * @returns {Map<string, T[]>}
 */
export const groupRecordsByKey = records => {
	const grouped = new Map();
	for (const record of records) {
		const key = recordKeyOf(record.start);
		const list = grouped.get(key);
		if (list) list.push(record);
		else grouped.set(key, [record]);
	}
	return grouped;
};

/**
 * storage の内容から記録を取り出す
 * 月ごとのキーがあれば、以前のキーは移行の後に消し損ねたものなので使わない（両方使うと記録が重複する）
 * @template T
 * @param {Object<string, any>} items
 * @param {function(any): T=} transform 読み込んだ記録を変換する（保存済みの内容は変換した後の JSON で持つ）
 * @returns {{
 * 	records: T[];
 * 	savedJson: Map<string, string>;
 * 	needsMigration: boolean;
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
		needsMigration: keys.includes(LEGACY_RECORD_KEY),
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

/**
 * 以前のキー (record) の記録を月ごとのキーに分けた storage の内容を返す（以前の形式のバックアップの復元用）
 * @param {Object<string, any>} items
 */
export const splitLegacyRecords = items => {
	if (!Object.hasOwn(items, LEGACY_RECORD_KEY)) return items;
	const others = Object.entries(items).filter(([key]) => !isRecordKey(key));
	// 月ごとのキーもあれば、loadRecords と同じく以前のキーは使わない
	return Object.fromEntries([...others, ...groupRecordsByKey(loadRecords(items).records)]);
};
