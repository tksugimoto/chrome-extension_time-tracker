// @ts-check

export const startOfDate = (date = new Date()) => {
	date.setHours(0);
	date.setMinutes(0);
	date.setSeconds(0);
	date.setMilliseconds(0);
	return date;
};

/** 参照先の ToDo が見つからない記録に表示する分類 */
export const MISSING_TODO_TYPE = '(不明なToDo)';

/**
 * 保存した記録を、項目名のあるオブジェクトにする
 * 保存形式（キー名を省いた配列。末尾の未設定の項目は省き、途中の未設定の項目は null）:
 * - ToDo を参照する記録: [開始, 経過 (ミリ秒。計測中は null), ToDo の ID, メモ]
 * - ToDo を参照しない記録: [開始, 経過, 分類, タイトル, メモ]
 * 以前の形式（{start, end, type, title, memo} のオブジェクト）も読み込める
 * @param {any} data
 * @returns {{
 * 	start: any;
 * 	end?: any;
 * 	todoId?: any;
 * 	type?: any;
 * 	title?: any;
 * 	memo?: any;
 * }}
 */
export const parseRecordData = data => {
	if (!Array.isArray(data)) {
		const {start, end, type, title, memo} = data;
		return {start, end: end ?? undefined, type, title, memo};
	}
	const [start, elapsed, ref, ...rest] = data.map(value => value ?? undefined);
	const end = typeof start === 'number' && typeof elapsed === 'number' ? start + elapsed : elapsed;
	if (typeof ref === 'number') {
		const [memo] = rest;
		return {start, end, todoId: ref, memo};
	}
	const [title, memo] = rest;
	return {start, end, type: ref, title, memo};
};

/**
 * 記録。ToDo から開始した記録は ToDo を参照し、分類・タイトル（メモは記録で入力していなければメモも）は ToDo のものを使う
 * ToDo の分類・タイトルを変えても、参照している記録は引き継がれる
 */
export class TimeRecord {
	/** @type {Todo | undefined} */
	todo;
	/** @type {string | undefined} */
	#type;
	/** @type {string | undefined} */
	#title;
	/** @type {string | undefined} */
	#memo;
	/**
	 * @param {TimeRecord | Todo | {type: string}} args 記録なら同じ内容で（再開）、ToDo ならその ToDo を参照して開始する
	 */
	constructor(args) {
		this.start = Date.now();
		/** @type {number | undefined} */
		this.end = undefined;
		if (args instanceof TimeRecord) {
			this.todo = args.todo;
			this.#type = args.#type;
			this.#title = args.#title;
			this.#memo = args.#memo;
		} else if ('id' in args) {
			this.todo = args;
		} else {
			this.#type = args.type;
		}
	}
	/**
	 * @param {any} data 保存した記録 (parseRecordData を参照)
	 * @param {Map<number, Todo>=} todoById
	 */
	static load(data, todoById = new Map()) {
		const {start, end, todoId, type, title, memo} = parseRecordData(data);
		const record = new TimeRecord({type}); // new this(args) を使うと TimeRecord.load を変数代入して使用した場合に this が不正
		record.start = start;
		record.end = end;
		record.#title = title;
		record.#memo = memo;
		if (todoId !== undefined) {
			// 参照先が見つからなくても、ID は保存し直したときに失わないよう残す
			record.todo = todoById.get(todoId) ?? {id: todoId, type: MISSING_TODO_TYPE, title: '', deleted: true};
		}
		return record;
	}
	toJSON() {
		const elapsed = this.end === undefined ? undefined : this.end - this.start;
		const values = this.todo
			? [this.start, elapsed, this.todo.id, this.#memo]
			: [this.start, elapsed, this.#type, this.#title, this.#memo];
		while (values.length && values.at(-1) === undefined) values.pop();
		return values.map(value => value ?? null);
	}
	get type() {
		return this.todo ? this.todo.type : this.#type;
	}
	get title() {
		return this.todo ? this.todo.title : this.#title;
	}
	get memo() {
		return this.#memo ?? this.todo?.memo;
	}
	finish() {
		if (this.end) return;
		this.end = Date.now();
	}
	/** 開始日の 24:00 */
	get endOfStartDate() {
		return startOfDate(new Date(this.start)).setHours(24);
	}
	/**
	 * 分類・タイトルを変えると ToDo の参照をやめる（ToDo 自体は変えない）。続けて linkTodo で一致する ToDo を参照し直す
	 * @param {string} value
	 */
	setType(value) {
		this.#unlinkTodo();
		this.#type = value;
	}
	/**
	 * @param {string} value
	 */
	setTitle(value) {
		this.#unlinkTodo();
		this.#title = value;
	}
	/**
	 * 記録のメモ。ToDo を参照していても ToDo のメモは変えない
	 * @param {string} value
	 */
	setMemo(value) {
		this.#memo = value;
	}
	#unlinkTodo() {
		const {todo} = this;
		if (!todo) return;
		this.#type = todo.type;
		this.#title = todo.title;
		this.#memo ??= todo.memo;
		this.todo = undefined;
	}
	/**
	 * @param {Todo} todo
	 */
	linkTodo(todo) {
		this.#memo ??= this.todo?.memo;
		this.todo = todo;
		this.#type = this.#title = undefined;
		if (this.#memo === todo.memo) this.#memo = undefined;
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
 * 	id: number;
 * 	type: string;
 * 	title: string;
 * 	memo?: string;
 * 	group?: string;
 * 	deadline?: number;
 * 	estimation?: string;
 * 	deleted?: boolean;
 * }} Todo deleted: 削除した ToDo。参照している記録のために残し、一覧には表示しない */

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
 * 一覧に表示する（削除していない）ToDo か
 * @param {Todo} todo
 */
export const isActiveTodo = todo => !todo.deleted;

/**
 * 次に追加する ToDo の ID（削除した ToDo も残しているので、ID は使い回さない）
 * @param {{id?: number}[]} todos
 */
export const nextTodoId = todos => todos.reduce((max, {id}) => Math.max(max, id ?? 0), 0) + 1;

/**
 * ID のない ToDo（ID で参照する前に保存したもの）に ID を振る。振らなくてよければ引数をそのまま返す
 * @param {Omit<Todo, 'id'> & {id?: number}[]} todos
 * @returns {Todo[]}
 */
export const assignTodoIds = todos => {
	if (todos.every(({id}) => id !== undefined)) return /** @type {Todo[]} */ (todos);
	let id = nextTodoId(todos);
	return todos.map(todo => todo.id === undefined ? {id: id++, ...todo} : todo);
};

/**
 * 記録が集計される ToDo を求めるための索引
 * ToDo を参照している記録はその ToDo（削除済みなら集計しない）、参照していない記録は分類・タイトルが一致する ToDo
 * @param {Todo[]} todos 一覧に表示する（削除していない）ToDo
 */
export const createTodoIndex = todos => {
	/** @type {Map<string, number>} todoKeyOf から添字への対応（同じキーの ToDo が複数あれば先頭） */
	const indexByKey = new Map();
	/** @type {Map<Todo, number>} */
	const indexByTodo = new Map();
	todos.forEach((todo, i) => {
		indexByTodo.set(todo, i);
		const key = todoKeyOf(todo);
		if (!indexByKey.has(key)) indexByKey.set(key, i);
	});
	return {
		/**
		 * 分類・タイトルが一致する ToDo（複数あれば先頭）
		 * @param {{type: string; title?: string}} todoOrRecord
		 * @returns {Todo | undefined}
		 */
		findByKey: todoOrRecord => todos[indexByKey.get(todoKeyOf(todoOrRecord)) ?? -1],
		/**
		 * @param {Todo} todo
		 */
		indexOfTodo: todo => indexByTodo.get(todo),
		/**
		 * @param {TimeRecord} record
		 * @returns {number | undefined}
		 */
		indexOf: record => record.todo ? indexByTodo.get(record.todo) : indexByKey.get(todoKeyOf(record)),
	};
};

/**
 * ToDo を参照していない記録のうち、分類・タイトルが一致する ToDo があるものを、その ToDo の参照にする
 * （ID で参照する前の記録や、記録の後に追加した ToDo の記録を、ToDo の分類・タイトルを変えても引き継げるようにする）
 * @param {TimeRecord[]} records
 * @param {Todo[]} todos 一覧に表示する（削除していない）ToDo
 */
export const linkRecordsToTodos = (records, todos) => {
	const {findByKey} = createTodoIndex(todos);
	for (const record of records) {
		if (record.todo) continue;
		const todo = findByKey(record);
		if (todo) record.linkTodo(todo);
	}
};

/**
 * 記録の作業時間を ToDo ごとの集計に加算した配列を返す。加算した要素だけ複製し、引数は変更しない
 * @param {TodoWorkTime[]} todoWorkTimes
 * @param {function(TimeRecord): (number | undefined)} todoIndexOf 記録を集計する todoWorkTimes の添字 (createTodoIndex の indexOf)
 * @param {TimeRecord[]} records
 */
export const addRecordsToTodoWorkTimes = (todoWorkTimes, todoIndexOf, records) => {
	const result = [...todoWorkTimes];
	const copiedIndexes = new Set();
	for (const record of records) {
		const i = todoIndexOf(record);
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
