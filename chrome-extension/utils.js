export const startOfDate = (date = new Date()) => {
	date.setHours(0);
	date.setMinutes(0);
	date.setSeconds(0);
	date.setMilliseconds(0);
	return date;
};

/**
 * date の月から monthOffset か月ずらした月の、初日と末日 (どちらも 0:00)
 * @param {Date} date
 * @param {number} monthOffset 0: 同じ月, -1: 前月
 */
export const monthRangeOf = (date, monthOffset) => {
	const year = date.getFullYear();
	const month = date.getMonth() + monthOffset;
	return {
		start: new Date(year, month, 1),
		end: new Date(year, month + 1, 0),
	};
};

/**
 * date の日から dayOffset 日ずらした日 (0:00)
 * @param {Date} date
 * @param {number} dayOffset 0: 同じ日, -1: 前日, 1: 翌日
 */
export const dayOf = (date, dayOffset) => {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset);
};

/**
 * date の日 (0:00～翌日 0:00) の範囲。日の区切りはここで決める
 * @param {Date} date
 * @returns {{start: number, end: number}} [start, end) のミリ秒
 */
export const dayRangeOf = date => ({start: dayOf(date, 0).getTime(), end: dayOf(date, 1).getTime()});

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
	/** 計測中の記録は、日付を跨いでも今まで数える */
	get workTimeSeconds() {
		return this.secondsWithin(-Infinity, Infinity);
	}
	/**
	 * 期間 [rangeStartMs, rangeEndMs) に含まれる作業時間。日付を跨いだ記録を日ごとに分けて集計するときに使う
	 * @param {number} rangeStartMs
	 * @param {number} rangeEndMs
	 */
	secondsWithin(rangeStartMs, rangeEndMs) {
		const start = Math.max(this.start, rangeStartMs);
		const end = Math.min(this.end ?? Date.now(), rangeEndMs);
		// TODO: 切り捨てにしないほうが良さそう
		return Math.max(0, Math.floor((end - start) / 1000));
	}
	/**
	 * 期間 [rangeStartMs, rangeEndMs) に開始した記録と、期間より前に開始して期間に入っても続いている記録で true
	 * @param {number} rangeStartMs
	 * @param {number} rangeEndMs
	 */
	overlaps(rangeStartMs, rangeEndMs) {
		if (this.start >= rangeStartMs) return this.start < rangeEndMs;
		return (this.end ?? Infinity) > rangeStartMs;
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
 * 	lastWorkedAt?: number; // 最後に計測した日時（計測中なら開始日時）。記録がなければ undefined
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
		// 合計は日付ごとの小計を足して、秒未満の切り捨てで小計の和とずれないようにする
		matched.total += addToSubtotalByDate(matched.subtotalByDate, record);
		matched.lastWorkedAt = Math.max(matched.lastWorkedAt ?? 0, record.end ?? record.start);
	}
	return result;
};

/**
 * 記録の作業時間を日付ごとに分ける。日付を跨いだ記録は日の区切り (dayRangeOf) で分ける
 * 期間を渡すと、期間に含まれる日だけを返す。長さ 0 の記録も、開始日に 0 秒で入れる
 * @param {TimeRecord} record
 * @param {number=} rangeStartMs
 * @param {number=} rangeEndMs
 * @returns {[date: string, seconds: number][]} date は Formats.localeDateString
 */
export const splitWorkTimeByDate = (record, rangeStartMs = -Infinity, rangeEndMs = Infinity) => {
	const end = Math.min(record.end ?? Date.now(), rangeEndMs);
	/** @type {[date: string, seconds: number][]} */
	const result = [];
	let day = dayRangeOf(new Date(Math.max(record.start, rangeStartMs)));
	do {
		result.push([Formats.localeDateString(day.start), record.secondsWithin(day.start, day.end)]);
		day = dayRangeOf(new Date(day.end));
	} while (day.start < end);
	return result;
};

/**
 * 記録の作業時間を、日付ごとの小計に加算する (引数の Map を変更する)。日付の分け方は splitWorkTimeByDate
 * @param {Map<string, number>} subtotalByDate キーは Formats.localeDateString
 * @param {TimeRecord} record
 * @returns {number} 加算した秒数
 */
export const addToSubtotalByDate = (subtotalByDate, record) => {
	let added = 0;
	for (const [date, seconds] of splitWorkTimeByDate(record)) {
		subtotalByDate.set(date, (subtotalByDate.get(date) ?? 0) + seconds);
		added += seconds;
	}
	return added;
};

/** @typedef {{
 * 	key: string;
 * 	seconds: number;
 * 	children?: WorkTimeTree[];
 * }} WorkTimeTree */

/**
 * 作業時間を keyOfs の順に入れ子で合計する。各階層は作業時間の長い順
 * 計測中の記録は時間が変わり続けるので、各記録の作業時間は呼び出し側で1回だけ求めて seconds に渡す
 * @param {{record: TimeRecord, seconds: number}[]} items
 * @param {(function(TimeRecord): string)[]} keyOfs
 * @returns {WorkTimeTree[]}
 */
export const sumWorkTimeSecondsBy = (items, [keyOf, ...childKeyOfs]) => {
	return [...Map.groupBy(items, ({record}) => keyOf(record))].map(([key, group]) => ({
		key,
		seconds: group.reduce((acc, {seconds}) => acc + seconds, 0),
		children: childKeyOfs.length ? sumWorkTimeSecondsBy(group, childKeyOfs) : undefined,
	})).sort((a, b) => b.seconds - a.seconds);
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

/**
 * 続けて変わる値の書き込みを、変わらなくなってから delayMs 後の1回にまとめる
 * writeSoon は最後の呼び出しから delayMs 後に書き込む。
 * flush は待っている書き込みがあればすぐ書き込む。
 * @template T
 * @param {function(T): void} write
 * @param {number} delayMs
 * @returns {{
 * 	writeSoon: function(T): void
 * 	flush: function(): void
 * }}
 */
export const createDebouncedWriter = (write, delayMs) => {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	/** @type {T} */
	let pendingValue;
	const cancel = () => {
		// Node.js 22.0.0 の mock.timers は clearTimeout(undefined) で例外になる
		if (timer === undefined) return;
		clearTimeout(timer);
		timer = undefined;
	};
	const flush = () => {
		if (timer === undefined) return;
		cancel();
		write(pendingValue);
	};
	return {
		writeSoon: value => {
			cancel();
			pendingValue = value;
			timer = setTimeout(flush, delayMs);
		},
		flush,
	};
};

/**
 * 2つの要素を入れ替えた新しい配列を返す
 * @template T
 * @param {T[]} array
 * @param {number} index1
 * @param {number} index2
 * @returns {T[]}
 */
export const swapped = (array, index1, index2) => {
	return array.with(index1, array[index2]).with(index2, array[index1]);
};

// TODO: types に組み込む
export const is勤務外 = type => {
	return [
		'昼休憩',
		'中断',
	].includes(type);
};

/**
 *
 * @param {{name: string}[]} types
 * @param {string} current
 * @returns
 */
export const typesToNamesWithCurrent = (types, current) => {
	const names = types.map(({name}) => name);
	return names.includes(current) ? names : [current, ...names];
};
