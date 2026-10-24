// バックアップファイルの作成と読み込み。chrome API に依存しない処理だけを置く（Node のテストからも読み込む）
import {isRecordKey, loadRecords, splitLegacyRecords} from './record-storage.js';
import {parseRecordData} from './utils.js';

export const BACKUP_FORMAT = 'time-tracker-backup';
/**
 * 2: 記録を開始月ごとのキー (record.YYYY-MM) に分けた。1 (record に全件) も読み込める
 * 3: ToDo に ID を振り、記録は項目名を省いた配列で ToDo を ID で参照する。1・2 も読み込める（記録ページを開いたときに今の形式にする）
 */
export const BACKUP_VERSION = 3;

/**
 * インポートするときに、ファイルの種類と形式の版を見分けられるようにメタ情報を付ける
 * @param {Object<string, any>} items chrome.storage.local の全データ
 * @param {Object} param1
 * @param {string} param1.extensionVersion
 * @param {Date} param1.now
 */
export const createBackup = (items, {extensionVersion, now}) => ({
	format: BACKUP_FORMAT,
	version: BACKUP_VERSION,
	extensionVersion,
	exportedAt: now.toISOString(),
	data: items,
});

const pad = n => String(n).padStart(2, '0');

/** ローカル時刻で time-tracker-backup-YYYYMMDD-HHMMSS.json */
export const createBackupFileName = (date = new Date()) => {
	const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
	const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return `time-tracker-backup-${ymd}-${hms}.json`;
};

/**
 * ダウンロード用のリンクにバックアップを設定する
 * @param {HTMLAnchorElement} link
 * @param {Object<string, any>} items chrome.storage.local の全データ
 * @param {Object} param2
 * @param {string} param2.extensionVersion
 * @param {Date=} param2.now
 */
export const setBackupDownloadLink = (link, items, {extensionVersion, now = new Date()}) => {
	const backup = createBackup(items, {extensionVersion, now});
	const blob = new Blob([JSON.stringify(backup, null, '\t')], {
		type: 'application/json',
	});
	// 作り直すたびに全データ分の Blob が残らないようにする
	if (link.href.startsWith('blob:')) URL.revokeObjectURL(link.href);
	link.href = URL.createObjectURL(blob);
	link.download = link.textContent = createBackupFileName(now);
};

const isPlainObject = value => {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

const isString = value => typeof value === 'string';

/** 任意項目: 未設定 (undefined / null) か、条件を満たす */
const isOptional = (value, isValid) => value == null || isValid(value);

/**
 * 一覧（配列）で保存しているキー（記録は月ごとのキーに分けて保存している）と、その要素が読み込めない場合に理由を返す関数
 * hasDefault: 保存されていないとき、main.js が既定の一覧を使う
 * @type {Object<string, {label: string, hasDefault?: boolean, findProblem: function(any): (string | undefined)}>}
 */
export const Lists = {
	record: {
		label: '記録',
		findProblem: data => {
			// 配列（今の形式）か、項目名のあるオブジェクト（以前の形式）
			if (!isPlainObject(data) && !Array.isArray(data)) return 'オブジェクトでも配列でもありません';
			const record = parseRecordData(data);
			if (!isFiniteNumber(record.start)) return '開始時刻 (start) が数値ではありません';
			if (!isOptional(record.end, isFiniteNumber)) return '終了時刻 (end) が数値ではありません';
			if (record.todoId !== undefined) {
				if (!Number.isInteger(record.todoId)) return 'ToDo の ID が整数ではありません';
			} else if (!isString(record.type)) return '分類 (type) が文字列ではありません';
			if (!isOptional(record.title, isString)) return 'タイトル (title) が文字列ではありません';
			if (!isOptional(record.memo, isString)) return 'メモ (memo) が文字列ではありません';
		},
	},
	todo: {
		label: 'ToDo',
		findProblem: todo => {
			if (!isPlainObject(todo)) return 'オブジェクトではありません';
			// ID で参照する前 (version 2 以前) の ToDo には ID がない
			if (!isOptional(todo.id, Number.isInteger)) return 'ID (id) が整数ではありません';
			if (!isString(todo.type)) return '分類 (type) が文字列ではありません';
			if (!isString(todo.title)) return 'タイトル (title) が文字列ではありません';
			if (!isOptional(todo.memo, isString)) return 'メモ (memo) が文字列ではありません';
			if (!isOptional(todo.group, isString)) return 'グループ (group) が文字列ではありません';
			if (!isOptional(todo.deadline, isFiniteNumber)) return '期限 (deadline) が数値ではありません';
			// 入力欄の値（文字列）のまま保存している
			if (!isOptional(todo.estimation, v => isString(v) || isFiniteNumber(v))) return '見積もり (estimation) が文字列でも数値でもありません';
			if (!isOptional(todo.deleted, v => typeof v === 'boolean')) return '削除済み (deleted) が真偽値ではありません';
		},
	},
	type: {
		label: '分類',
		hasDefault: true,
		findProblem: type => {
			if (!isPlainObject(type)) return 'オブジェクトではありません';
			if (!isString(type.name)) return '名前 (name) が文字列ではありません';
		},
	},
	'todo-group': {
		label: 'ToDo グループ',
		hasDefault: true,
		findProblem: group => {
			if (!isString(group)) return '文字列ではありません';
		},
	},
};

/**
 * storage のキーが一覧なら、Lists のキーを返す
 * @param {string} key
 * @returns {string | undefined}
 */
const listKeyOf = key => {
	if (isRecordKey(key)) return 'record';
	if (Object.hasOwn(Lists, key)) return key;
};

/**
 * バックアップファイルの中身を検証して返す。読み込めない場合は理由を message に持つ Error を投げる
 * @param {string} text
 * @returns {ReturnType<typeof createBackup>}
 */
export const parseBackup = text => {
	let backup;
	try {
		backup = JSON.parse(text);
	} catch (error) {
		throw new Error('JSON として読み込めませんでした。', {cause: error});
	}
	if (!isPlainObject(backup) || backup.format !== BACKUP_FORMAT) {
		throw new Error('Time tracker のバックアップファイルではありません。');
	}
	if (!Number.isInteger(backup.version) || backup.version < 1) {
		throw new Error(`バックアップ形式の版 (version: ${JSON.stringify(backup.version)}) が不正です。`);
	}
	if (backup.version > BACKUP_VERSION) {
		throw new Error(`新しい形式 (version: ${backup.version}) のバックアップのため読み込めません。拡張機能を更新してください。`);
	}
	const {data} = backup;
	if (!isPlainObject(data)) {
		throw new Error('バックアップにデータ (data) がありません。');
	}
	for (const [key, list] of Object.entries(data)) {
		const listKey = listKeyOf(key);
		if (!listKey) continue;
		const {label, findProblem} = Lists[listKey];
		if (!Array.isArray(list)) throw new Error(`${label} (${key}) が配列ではありません。`);
		list.forEach((item, index) => {
			const problem = findProblem(item);
			if (problem) throw new Error(`${label} (${key}) の ${index + 1} 件目が不正です: ${problem}`);
		});
	}
	// 参照先の ToDo が見つからない記録は記録ページで「不明なToDo」と表示できるが、ID の重複は別の ToDo に集計されてしまう
	const todoIds = new Set();
	for (const {id} of data.todo ?? []) {
		if (id === undefined) continue;
		if (todoIds.has(id)) throw new Error(`ToDo の ID (${id}) が重複しています。`);
		todoIds.add(id);
	}
	return backup;
};

/**
 * 確認表示用に、一覧ごとの件数を数える
 * @param {Object<string, any>} data
 * @returns {Object<string, string>}
 */
export const summarize = data => {
	return Object.fromEntries(Object.entries(Lists).map(([key, {hasDefault}]) => {
		// 記録は月ごとのキーの合計（main.js と同じく読み込む）。ToDo は削除済み（一覧に表示しないもの）を数えない
		const list = key === 'record' ? loadRecords(data).records
			: key === 'todo' ? data.todo?.filter(todo => !todo.deleted)
			: data[key];
		if (!list) return [key, hasDefault ? '初期値' : '0 件'];
		return [key, `${list.length} 件`];
	}));
};

/**
 * 復元後に残すべきでない（バックアップに含まれない）キー
 * @param {string[]} currentKeys
 * @param {Object<string, any>} data
 */
export const keysToRemove = (currentKeys, data) => {
	return currentKeys.filter(key => !Object.hasOwn(data, key));
};

/**
 * バックアップの内容で storage を置き換える
 * @param {Object<string, any>} backupData バックアップの data
 * @param {Object} param1
 * @param {Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>} param1.storage
 * @param {function(Object<string, any>): void} param1.saveCurrentData 書き換える前の全データを受け取り、念のため保存する
 * @returns {Promise<void>}
 */
export const restoreBackup = (backupData, {storage, saveCurrentData}) => {
	// 以前の形式 (version 1) のバックアップも、今の形式で書き込む
	const data = splitLegacyRecords(backupData);
	return storage.get(null).then(currentItems => {
		saveCurrentData(currentItems);
		// 先に書き込んでから不要なキーを消す（clear してから書き込むと、書き込みに失敗したときに全データを失う）
		return storage.set(data)
			.then(() => storage.remove(keysToRemove(Object.keys(currentItems), data)));
	});
};
