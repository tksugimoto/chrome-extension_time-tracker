// バックアップファイルの作成と読み込み。chrome API に依存しない処理だけを置く（Node のテストからも読み込む）

export const BACKUP_FORMAT = 'time-tracker-backup';
export const BACKUP_VERSION = 1;

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

/**
 * 一覧（配列）で保存しているキーと、その要素が読み込めない場合に理由を返す関数
 * @type {Object<string, {label: string, findProblem: function(any): (string | undefined)}>}
 */
export const Lists = {
	record: {
		label: '記録',
		findProblem: record => {
			if (!isPlainObject(record)) return 'オブジェクトではありません';
			if (!isFiniteNumber(record.start)) return '開始時刻 (start) が数値ではありません';
			if (record.end != null && !isFiniteNumber(record.end)) return '終了時刻 (end) が数値ではありません';
			if (!isString(record.type)) return '分類 (type) が文字列ではありません';
		},
	},
	todo: {
		label: 'ToDo',
		findProblem: todo => {
			if (!isPlainObject(todo)) return 'オブジェクトではありません';
			if (!isString(todo.type)) return '分類 (type) が文字列ではありません';
			if (!isString(todo.title)) return 'タイトル (title) が文字列ではありません';
		},
	},
	type: {
		label: '分類',
		findProblem: type => {
			if (!isPlainObject(type)) return 'オブジェクトではありません';
			if (!isString(type.name)) return '名前 (name) が文字列ではありません';
		},
	},
	'todo-group': {
		label: 'ToDo グループ',
		findProblem: group => {
			if (!isString(group)) return '文字列ではありません';
		},
	},
};

export const LIST_KEYS = Object.keys(Lists);

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
	for (const [key, {label, findProblem}] of Object.entries(Lists)) {
		if (!Object.hasOwn(data, key)) continue;
		if (!Array.isArray(data[key])) throw new Error(`${label} (${key}) が配列ではありません。`);
		data[key].forEach((item, index) => {
			const problem = findProblem(item);
			if (problem) throw new Error(`${label}の ${index + 1} 件目が不正です: ${problem}`);
		});
	}
	return backup;
};

/**
 * 確認表示用に、一覧ごとの件数を数える
 * @param {Object<string, any>} data
 * @returns {Object<string, number>}
 */
export const summarize = data => {
	return Object.fromEntries(LIST_KEYS.map(key => [key, data[key]?.length ?? 0]));
};

/**
 * 復元後に残すべきでない（バックアップに含まれない）キー
 * @param {string[]} currentKeys
 * @param {Object<string, any>} data
 */
export const keysToRemove = (currentKeys, data) => {
	return currentKeys.filter(key => !Object.hasOwn(data, key));
};
