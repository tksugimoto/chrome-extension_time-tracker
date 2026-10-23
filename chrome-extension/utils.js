// @ts-check

export const startOfDate = (date = new Date()) => {
	date.setHours(0);
	date.setMinutes(0);
	date.setSeconds(0);
	date.setMilliseconds(0);
	return date;
};

export class TimeRecord {
	constructor(args) {
		this.start = Date.now();
		this.type = args.type;
		if (args.title) this.title = args.title;
		if (args.memo) this.memo = args.memo;
	}
	static load(args) {
		const record = new TimeRecord(args); // new this(args) を使うと TimeRecord.load を変数代入して使用した場合に this が不正
		record.start = args.start;
		record.end = args.end;
		return record;
	}
	finish() {
		if (this.end) return;
		this.end = Date.now();
	}
	/** 開始日の 24:00 */
	get endOfStartDate() {
		return startOfDate(new Date(this.start)).setHours(24);
	}
	setType(value) {
		this.type = value;
	}
	setTitle(value) {
		this.title = value;
	}
	setMemo(value) {
		this.memo = value;
	}
	/**
	 * @param {number} start
	 * @param {number=} end 未指定の場合は計測中に戻す
	 */
	setTime(start, end) {
		this.start = start;
		this.end = end;
	}
	get workTimeSeconds() {
		let end = this.end;
		if (!end) {
			if (this.isDateOf(startOfDate())) end = Date.now();
			else end = this.endOfStartDate;
		}
		// TODO: 切り捨てにしないほうが良さそう
		return Math.floor((end - this.start) / 1000);
	}
	isDateOf(targetDate) {
		return this.start >= targetDate.getTime();
	}
}

export const Formats = {
	_bytesFormat: Intl.NumberFormat('en', {
		notation: 'compact',
		style: 'unit',
		unit: 'byte',
	}),
	/**
	 * @param {number} num
	 */
	bytes(num) {
		return this._bytesFormat.format(num);
	},
	_percentFormat: Intl.NumberFormat('default', {
		style: 'percent',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}),
	/**
	 * @param {number} num
	 */
	percent(num) {
		return this._percentFormat.format(num);
	},
	/**
	 * @param {number} num
	 */
	padStart0(num) {
		return num.toString().padStart(2, '0');
	},
	/**
	 * @param {number} time
	 */
	seconds(time) {
		const seconds = time % 60;
		const minutes = Math.floor(time / 60) % 60;
		const hours = Math.floor(time / 60 / 60);
		if (hours) return `${hours}時間${this.padStart0(minutes)}分${this.padStart0(seconds)}秒`;
		if (minutes) return `${this.padStart0(minutes)}分${this.padStart0(seconds)}秒`;
		return `${this.padStart0(seconds)}秒`;
	},
	/**
	 * @param {Date} date
	 */
	ISODateString(date) {
		return this.ISODateTimeString(date.getTime()).replace(/T.*/, '');
	},
	/**
	 * input[type="datetime-local"] の値 (秒まで)
	 * @param {number} timestampMs
	 */
	ISODateTimeString(timestampMs) {
		const offsetMs = new Date(timestampMs).getTimezoneOffset() * 60000;
		return new Date(timestampMs - offsetMs).toISOString().replace(/\.\d+Z$/, '');
	},
	/**
	 * toLocaleString と同じく、不正な値は例外にせず 'Invalid Date' を返す
	 * @param {Intl.DateTimeFormat} dateTimeFormat
	 * @param {number} timestampMs
	 */
	_formatTimestamp(dateTimeFormat, timestampMs) {
		return Number.isFinite(timestampMs) ? dateTimeFormat.format(timestampMs) : 'Invalid Date';
	},
	_localeDeadlineDateFormat: new Intl.DateTimeFormat(undefined, {
		month: '2-digit',
		day: '2-digit',
	}),
	/**
	 * @param {number} timestampMs
	 */
	localeDeadlineDateString(timestampMs) {
		return this._formatTimestamp(this._localeDeadlineDateFormat, timestampMs);
	},
	_localeDateTimeFormat: new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}),
	/**
	 * @param {number} timestampMs
	 */
	localeDateTimeString(timestampMs) {
		return this._formatTimestamp(this._localeDateTimeFormat, timestampMs);
	},
	_localeDateFormat: new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'short',
	}),
	/**
	 * @param {number} timestampMs
	 */
	localeDateString(timestampMs) {
		return this._formatTimestamp(this._localeDateFormat, timestampMs);
	},
	_localeTimeFormat: new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}),
	/**
	 * @param {number} timestampMs
	 */
	localeTimeString(timestampMs) {
		return this._formatTimestamp(this._localeTimeFormat, timestampMs);
	},
};

/** @typedef {{
 * 	type: string;
 * 	title: string;
 * 	memo?: string;
 * 	group?: string;
 * 	deadline?: number;
 * 	estimation?: string;
 * }} Todo */

/** @typedef {{
 * 	todo: Todo;
 * 	total: number;
 * 	subtotalByDate: Map<string, number>;
 * }} TodoWorkTime */

/**
 * ToDoごとの集計には分類・タイトルのみを使用し、メモの違いは無視する
 * @param {{type: string; title?: string}} todoOrRecord
 */
export const todoKeyOf = ({type, title}) => JSON.stringify([type, title || '']);

/**
 * 記録の作業時間を ToDo ごとの集計に加算した配列を返す。加算した要素だけ複製し、引数は変更しない
 * @param {TodoWorkTime[]} todoWorkTimes
 * @param {Map<string, number>} todoIndexByKey todoKeyOf から todoWorkTimes の添字への対応（同じキーの ToDo が複数あれば先頭）
 * @param {TimeRecord[]} records
 */
export const addRecordsToTodoWorkTimes = (todoWorkTimes, todoIndexByKey, records) => {
	const result = [...todoWorkTimes];
	const copiedIndexes = new Set();
	for (const record of records) {
		const i = todoIndexByKey.get(todoKeyOf(record));
		if (i === undefined) continue;
		if (!copiedIndexes.has(i)) {
			copiedIndexes.add(i);
			result[i] = {...result[i], subtotalByDate: new Map(result[i].subtotalByDate)};
		}
		const matched = result[i];
		matched.total += record.workTimeSeconds;

		const date = Formats.localeDateString(record.start);
		matched.subtotalByDate.set(date, (matched.subtotalByDate.get(date) ?? 0) + record.workTimeSeconds);
	}
	return result;
};

/**
 * @param {Todo} todo
 * @param {number} todoWorkTimeTatal
 * @returns
 */
export const calculateRemainingTime = (todo, todoWorkTimeTatal) => {
	if (!todo.estimation) return 0;
	const estimationSeconds = Number(todo.estimation) * 60 * 60;
	if (todoWorkTimeTatal > estimationSeconds) return 0;
	return estimationSeconds - todoWorkTimeTatal;
};

const recExpCharacterClassMetaChars = [
	'\\',
	'-',
	']',
	// Pattern は vフラグ(unicodeSets)が有効なため追加のescapeが必要
	'(',
	')',
	'[',
	'{',
	'}',
	'/',
	'|',
];
/**
 *
 * @param {string} char
 * @returns
 */
export const escapeCharacterClassMetaChar = char => {
	if (recExpCharacterClassMetaChars.includes(char)) return `\\${char}`;
	return char;
};
