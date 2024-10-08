// @ts-check
/* global chrome */
/* global React, ReactDOM */
const {
	createElement,
	useState,
	useCallback,
	useRef,
	useEffect,
	useMemo,
} = React;


/**
 *
 * @param {any[]} array
 * @param {number} index1
 * @param {number} index2
 */
const swap = (array, index1, index2) => {
	[array[index1], array[index2]] = [array[index2], array[index1]];
};

const domParser = new DOMParser();

/**
 *
 * @param {DataTransfer} clipboardData
 * @returns {Promise<{
 *   text: string,
 *   url?: string,
 * }> | null}
 */
const readClipboardData = clipboardData => {
	const items = Array.from(clipboardData.items);
	const plain = items.find(item => item.type === 'text/plain');
	if (!plain) return null;
	const html = items.find(item => item.type === 'text/html');
	return Promise.all([
		html && new Promise(r => html.getAsString(r)),
		new Promise(r => plain.getAsString(r)),
	]).then(([htmlString, plainString]) => {
		if (!htmlString) return({text: plainString});
		const doc = domParser.parseFromString(htmlString, 'text/html');
		const links = doc.querySelectorAll('a');
		if (links.length === 1) {
			const link = links[0];
			const text = link.innerText;
			const url = link.href;
			return ({text, url});
		} else {
			return({text: plainString});
		}
	});
};

const startOfDate = (date = new Date()) => {
	date.setHours(0);
	date.setMinutes(0);
	date.setSeconds(0);
	date.setMilliseconds(0);
	return date;
};

class TimeRecord {
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
	get workTimeSeconds() {
		let end = this.end;
		if (!end) {
			if (this.start > startOfDate().getTime()) end = Date.now();
			else end = startOfDate(new Date(this.start)).setHours(22);
		}
		// TODO: 切り捨てにしないほうが良さそう
		return Math.floor((end - this.start) / 1000);
	}
	isDateOf(targetDate) {
		return this.start > targetDate.getTime();
	}
}


const Formats = {
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
		return new Date(date.getTime() - (date.getTimezoneOffset() * 60000 )).toISOString().replace(/T.*/, '');
	},
	/**
	 * @param {number} timestampMs
	 */
	localeDeadlineDateString(timestampMs) {
		return new Date(timestampMs).toLocaleString(undefined, {
			month: '2-digit',
			day: '2-digit',
		});
	},
	/**
	 * @param {number} timestampMs
	 */
	localeDateTimeString(timestampMs) {
		return new Date(timestampMs).toLocaleString(undefined, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
	},
	/**
	 * @param {number} timestampMs
	 */
	localeDateString(timestampMs) {
		return new Date(timestampMs).toLocaleString(undefined, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			weekday: 'short',
		});
	},
	/**
	 * @param {number} timestampMs
	 */
	localeTimeString(timestampMs) {
		return new Date(timestampMs).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
	},
};

// TODO: types に組み込む
const is勤務外 = type => {
	return [
		'昼休憩',
		'中断',
	].includes(type);
};

const loadFromStorage = (key, callback) => {
	chrome.storage.local.get(key, items => {
		callback(items[key]);
	});
};
const saveToStorage = (key, value) => {
	// TODO: 保存成功確認？
	chrome.storage.local.set({
		[key]: value,
	});
};

/**
 *
 * @returns {Promise<{
 *	bytesInUse: number;
 *	bytesQuota: number;
 * }>}
 */
const fetchUsage = () => {
	return new Promise(resolve => {
		chrome.storage.local.getBytesInUse().then(bytesInUse => {
			resolve({
				bytesInUse,
				bytesQuota: chrome.storage.local.QUOTA_BYTES,
			});
		});
	});
};

/**
 * @template T
 * @param {string} settingKey
 * @param {T} defaultValue
 * @returns {[
* 	T,
* 	function(T): void
* ]}
*/
const useSetting = (settingKey, defaultValue) => {
	const storageKey = `setting.${settingKey}`;
	const [value, setValue] = useState(defaultValue);
	useEffect(() => {
		loadFromStorage(storageKey, savedValeu => {
			setValue(savedValeu ?? defaultValue);
		});
	}, [storageKey, defaultValue]);
	const update = useCallback(newValue => {
		saveToStorage(storageKey, newValue);
		setValue(newValue);
	}, [storageKey]);
	return [value, update];
};

/**
 * @template T
 * @param {string} storageKey
 * @param {Object} options
 * @param {function(any): T=} options.transform
 * @param {Object[]=} options.defaultValue
 * @returns {{
 * 	allList: T[]
 * 	refresh: function(): void
 * 	add: function(T): void
 * 	save: function(): void
 * }}
 */
const useStorageList = (storageKey, {
	transform,
	defaultValue,
} = {}) => {
	const [allList, setList] = useState(() => {
		// 変数に入れないと any ではなく never 型となってしまい、 setList 部分で型エラーとなる問題対策
		const empty = [];
		return empty;
	});
	useEffect(() => {
		loadFromStorage(storageKey, list => {
			setList((list ?? defaultValue ?? []).map(transform ?? (v => v)));
		});
	}, [storageKey, defaultValue, transform]);
	const refresh = useCallback(() => setList(list => [...list]), []);
	const add = useCallback(value => {
		setList(list => {
			// TODO: setStateのcallbackの中で副作用ありで良いのか確認
			const newList = [...list, value];
			saveToStorage(storageKey, newList);
			return newList;
		});
	}, [storageKey]);
	const save = useCallback(() => {
		refresh();
		saveToStorage(storageKey, allList);
	}, [allList, refresh, storageKey]);
	return {
		allList,
		refresh,
		add,
		save,
	};
};

const titleSize = 40;

/**
 *
 * @param {Object} param0
 * @param {{name: string}[]} param0.types
 * @param {TimeRecord} param0.record
 * @param {function(): void} param0.save
 * @param {function(TimeRecord): void=} param0.finishAndAddRecord
 * @param {boolean=} param0.isEditable
 * @param {boolean=} param0.hideDate
 * @returns
 */
const RecordView = ({
	types,
	record,
	save,
	finishAndAddRecord,
	isEditable = true, // FIXME: 名前の適切化
	hideDate = false,
}) => {
	// TODO: 縦位置を揃えたい
	return createElement(
		React.Fragment,
		{},
		`${Formats[hideDate ? 'localeTimeString' : 'localeDateTimeString'](record.start)}～${record.end ? Formats.localeTimeString(record.end) : ''}`,
		`(${Formats.seconds(record.workTimeSeconds)})`,
		createElement(
			'select',
			{
				value: record.type,
				onChange: e => {
					// FIXME: mutableをやめる
					record.setType(e.target.value);
					save();
				},
			},
			typesToNamesWithCurrent(types, record.type).map((type, i) => {
				return createElement('option', {
					key: i,
					value: type,
				}, type);
			}),
		),
		createElement(
			'input',
			{
				value: record.title || '',
				placeholder: 'タイトル',
				size: titleSize,
				onChange: e => {
					// FIXME: mutableをやめる
					record.setTitle(e.target.value);
					save();
				},
			},
		),
		createElement(
			'input',
			{
				value: record.memo || '',
				placeholder: 'メモ',
				onChange: e => {
					// FIXME: mutableをやめる
					record.setMemo(e.target.value);
					save();
				},
			},
		),
		isEditable && (
			record.end ? createElement(
				'button',
				{
					onClick: () => {
						finishAndAddRecord?.(record);
					},
				},
				'再開',
			) : createElement(
				'button',
				{
					onClick: () => {
						// FIXME: mutableをやめる
						record.finish();
						save();
					},
				},
				'終了',
			)
		),
	);
};

const groupNothingName = '(グループなし)';

/** @typedef {{
 * 	type: string;
 * 	title: string;
 * 	memo?: string;
 * 	group?: string;
 * 	deadline?: number;
 * }} Todo */

/** @typedef {{
 * 	todo: Todo;
 * 	total: number;
 * 	subtotalByDate: Map<string, number>;
 * }} TodoWorkTime */

/**
 * @param {{
 * 	todo: Todo;
 * 	isTodoEditMode: boolean;
 * 	usingTodoGroup: boolean;
 * 	usingTodoDeadline: boolean;
 * 	todos: Todo[],
 * 	todoGroups: string[],
 * 	saveTodo: function(): void
 * 	finishAndAddRecord: function(TimeRecord | Todo): void
 * 	types: {name: string}[];
 * 	todoWorkTimeTatal: number;
 * 	showSubtotal: function(): void;
 * }} param0
 * @returns
 */
const TodoRow = ({
	todo,
	isTodoEditMode,
	usingTodoGroup,
	usingTodoDeadline,
	todos,
	todoGroups,
	saveTodo,
	finishAndAddRecord,
	types,
	todoWorkTimeTatal,
	showSubtotal,
}) => {
	const hasUrlMemo = !!todo.memo?.match(/^http[^ ]+$/);
	const i = todos.indexOf(todo);
	return createElement(
		React.Fragment,
		{},
		isTodoEditMode && createElement(
			'button',
			{
				onClick: () => {
					const desc = todo.title || todo.memo || '-';
					const message = `「${todo.type}(${desc})」を削除しますか？`;
					if (window.confirm(message)) {
						// FIXME: mutableをやめる
						// todos.toSpliced が使える
						todos.splice(i, 1);
						saveTodo();
					}
				},
			},
			'削除',
		),
		(usingTodoGroup && isTodoEditMode) && createElement(
			'select',
			{
				value: todoGroups.includes(todo.group ?? '') ? todo.group : '',
				onChange: e => {
					// FIXME: mutableをやめる
					todo.group = e.target.value || undefined;
					saveTodo();
				},
			},
			[...todoGroups, ''].map((todoGroup, i) => {
				return createElement('option', {
					key: i,
					value: todoGroup,
				}, todoGroup || groupNothingName);
			}),
		),
		createElement(
			'button',
			{
				onClick: () => {
					finishAndAddRecord(todo);
				},
				style: {
					userSelect: 'none', // TODO listをコピーしやすくするため
				},
			},
			'開始',
		),
		usingTodoDeadline && (isTodoEditMode ? createElement(
			'input',
			{
				type: 'date',
				title: '期限',
				defaultValue: todo.deadline && Formats.ISODateString(new Date(todo.deadline)),
				className: todo.deadline && 'has-deadline',
				onChange: e => {
					if (e.target.validity.badInput) return;
					// TODO: 全localeで日付保存が問題ないか確認
					todo.deadline = e.target.value ? startOfDate(new Date(e.target.valueAsNumber)).getTime() : undefined;
					saveTodo();
				},
			},
		) : todo.deadline && createElement('span', {
			className: todo.deadline < Date.now() ? 'expired-deadline' : todo.deadline < (Date.now() + 3 * 24 * 60 * 60 * 1000) ? 'close-to-deadline' : null,
		}, `(-${Formats.localeDeadlineDateString(todo.deadline)})`)),
		' [',
		createElement('span', {
			title: 'クリックで日別内訳を表示',
			style: {
				cursor: 'pointer',
			},
			onClick: showSubtotal,
		}, Formats.seconds(todoWorkTimeTatal)),
		'] ',
		isTodoEditMode ? createElement(
			'select',
			{
				value: todo.type,
				onChange: e => {
					// FIXME: mutableをやめる
					todo.type = e.target.value;
					saveTodo();
				},
			},
			typesToNamesWithCurrent(types, todo.type).map((type, i) => {
				return createElement('option', {
					key: i,
					value: type,
				}, type);
			}),
		) : todo.type,
		isTodoEditMode ? createElement(
			'input',
			{
				value: todo.title,
				placeholder: 'タイトル',
				size: titleSize,
				onChange: e => {
					// FIXME: mutableをやめる
					todo.title = e.target.value;
					saveTodo();
				},
			},
		) : (
			hasUrlMemo ? createElement(
				'a',
				{
					href: todo.memo,
					target: '_blank',
				},
				`(${todo.title || todo.memo})`, // TODO: 区切り()がリンクになって統一感がない問題に対応≒区切りを()から変更
			) : `(${todo.title || '-'})`
		),
		isTodoEditMode ? createElement(
			'input',
			{
				value: todo.memo,
				placeholder: 'メモ / URL',
				onChange: e => {
					// FIXME: mutableをやめる
					todo.memo = e.target.value;
					saveTodo();
				},
			},
		) : hasUrlMemo ? '' : todo.memo,
	);
};

/**
 *
 * @param {import("react").PropsWithChildren<{
 * 	checked: boolean,
 * 	onChange: function(boolean): void,
 * 	disabled?: boolean
 * }>} param0
 * @returns
 */
const Checkbox = ({
	children,
	checked,
	onChange,
	disabled = false,
}) => {
	return createElement(
		'label',
		{
			style: {
				userSelect: 'none',
				cursor: 'pointer',
			},
		},
		createElement(
			'input',
			{
				type: 'checkbox',
				checked,
				onChange: e => {
					onChange(e.target.checked);
				},
				disabled,
				style: {
					verticalAlign: 'middle',
					cursor: 'pointer',
				},
			},
		),
		createElement(
			'span',
			{
				style: {
					verticalAlign: 'middle',
				},
			},
			children,
		),
	);
};

// forwardRefの型指定が難しいためhookにした
const useDialog = () => {
	/** @type {React.MutableRefObject<HTMLDialogElement | null>} */
	const dialogRef = useRef(null);
	const showModalDialog = useCallback(() => dialogRef.current?.showModal(), []);

	/**
	 * @param {import("react").PropsWithChildren<{}>} param0
	 */
	const Dialog = ({
		children,
	}) => createElement(
		'dialog', {
			ref: dialogRef,
			onClick: e => {
				if (e.target === dialogRef.current) {
					// backdrop クリック時は閉じる
					dialogRef.current.close();
				}
			},
		},
		createElement(
			'div',
			{
				style: {
					minWidth: 500,
					minHeight: 500,
				},
			},
			createElement(
				'div',
				{
					style: {
						display: 'flex',
						justifyContent: 'flex-end',
					},
				},
				createElement('button', {
						onClick: e => {
							e.preventDefault();
							dialogRef.current?.close();
						},
					}, '閉じる'),
				),
			children,
		),
	);
	return {
		Dialog: useCallback(Dialog, []),
		showModalDialog,
	};
};

/**
 * ※ setTodoEditMode を外でも使用しているため、 state をこのコンポーネント内に閉じ込めるのは断念
 * @param {import("react").PropsWithChildren<{
* 	checked: boolean,
* 	onChange: function(boolean): void,
* }>} param0
* @returns
*/
const EditModeTab = ({
	children,
	checked,
	onChange,
}) => {
	const contentsBorderRadius = '0.5em';
	return createElement(
		React.Fragment,
		{},
		createElement(
			'div', {
				style: {
					paddingLeft: contentsBorderRadius, // 角の丸みの上にタブが乗らないようにずらす
				},
			},
			createElement('button', {
				onClick: () => onChange(false),
				className: ['tab', !checked && 'selected'].filter(Boolean).join(' '),
			}, '表示モード'),
			createElement('button', {
				onClick: () => onChange(true),
				className: ['tab', checked && 'selected'].filter(Boolean).join(' '),
			}, '編集モード'),
		),
		createElement(
			'div', {
				style: {
					border: 'solid 1px grey',
					borderRadius: contentsBorderRadius,
					padding: '5px',
				},
			},
			children,
		),
	);
};

/**
 *
 * @param {{name: string}[]} types
 * @param {string} current
 * @returns
 */
const typesToNamesWithCurrent = (types, current) => {
	const names = types.map(({name}) => name);
	return names.includes(current) ? names : [current, ...names];
};

const defaultTodoGroups = [
	'対応待ち',
	'template',
];

const defaultTypes = [{
	name: 'メールチェック',
}, {
	name: 'ミーティング',
}, {
	name: 'レビュー',
}, {
	name: '中断',
}];

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
const escapeCharacterClassMetaChar = char => {
	if (recExpCharacterClassMetaChars.includes(char)) return `\\${char}`;
	return char;
};

const App = () => {
	const {
		allList: todos,
		add: addTodo,
		save: saveTodo,
	} = useStorageList('todo');
	const [newTodoType, setNewTodoType] = useState('');
	/** @type{ReturnType<typeof useRef<HTMLInputElement>>} */
	const newTodoTitleRef = useRef();
	const [newTodoTitle, setNewTodoTitle] = useState('');
	const [newTodoMemo, setNewTodoMemo] = useState('');
	const [newTodoGroup, setNewTodoGroup] = useState('');

	const {
		allList: types,
		add: addType,
		save: saveType,
	} = useStorageList('type', {
		defaultValue: defaultTypes,
	});
	const {
		allList: todoGroups,
		add: addTodoGroup,
		save: saveTodoGroup,
	} = useStorageList('todo-group', {
		defaultValue: defaultTodoGroups,
	});
	const [newType, setNewType] = useState('');

	const {
		allList,
		refresh,
		add,
		save,
	} = useStorageList('record', {
		transform: TimeRecord.load,
	});

	const [isTypeEditMode, setTypeEditMode] = useState(false);
	const [isTodoEditMode, setTodoEditMode] = useState(false);
	const [isInputToDoFromClipboardEnabled, setInputToDoFromClipboardEnabled] = useSetting('clipboard-to-todo', false);
	const [usingTodoGroup, setTodoGroup] = useSetting('use-todo-group', false);
	const [usingTodoDeadline, setTodoDeadline] = useSetting('use-todo-deadline', false);
	const [isDetailVisible, setDetailVisible] = useSetting('detail-visible', false);
	const [hideNoTitleOrMemo, setHideNoTitleOrMemo] = useSetting('no-title_or_memo', true);

	useEffect(() => {
		if (!isInputToDoFromClipboardEnabled) return;
		// クリップボードの中身をToDo登録
		const listener = event => {
			// 入力欄にフォーカスがあり貼り付けた場合は対象外とする
			// ※ 個別の入力欄に貼り付けた際の入力は直感的な動作にできないため妥協
			if (event.target?.['tagName'] === 'INPUT') return; // TODO: 入力欄判定の改善
			if (!event.clipboardData) return;
			readClipboardData(event.clipboardData)?.then(({text, url}) => {
				setTodoEditMode(true);
				if (url) {
					setNewTodoTitle(text);
					setNewTodoMemo(url);
				} else {
					setNewTodoTitle(text);
				}
				// input要素が描画されてからじゃないとrefに値(要素)が存在しないため、少し待つ
				setTimeout(() => {
					newTodoTitleRef.current?.focus();
				}, 100);
			});
		};
		window.addEventListener('paste', listener);
		return () => window.removeEventListener('paste', listener);
	}, [isInputToDoFromClipboardEnabled]);

	/** @type{ReturnType<
	 *  typeof useState<
	 *   Awaited<
	 *    ReturnType<
	 *     typeof fetchUsage
	 *    >
	 *   >
	 *  >
	 * >} */
	const [usage, setUsage] = useState();
	useEffect(() => {
		fetchUsage().then(setUsage);
	}, []);

	const usedAccessKeys = useMemo(() => {
		return types.map(type => type.accessKey).filter(Boolean).flatMap(c => {
			// アクセスキーは大文字小文字を区別しない
			const L = c.toLowerCase();
			const U = c.toUpperCase();
			if (L === U) return [L];
			return [L, U];
		});
	}, [types]);

	/** @type{TodoWorkTime[]} */
	const todoWorkTimes = allList.reduce((acc, record) => {
		// todoのkeyが2つ(type,title)なのでMapは使えずloopで該当のindexを探すしかない
		const matched = acc.find(({todo}) => {
			return (
				todo.type === record.type
			) && (
				// memoの違いは無視する
				(todo.title || '') === (record.title || '')
			);
		});
		if (matched) {
			matched.total += record.workTimeSeconds;

			const key = Formats.localeDateString(record.start);
			let subtotal = matched.subtotalByDate.get(key) ?? 0;
			subtotal += record.workTimeSeconds;
			matched.subtotalByDate.set(key, subtotal);
		}
		return acc;
	}, todos.map(todo => {
		return {
			todo,
			total: 0,
			/** @type{Map<string, number>} */
			subtotalByDate: new Map(),
		};
	}));


	/** @type{ReturnType<typeof useState<typeof todoWorkTimes[number]>>} */
	const [todoWorkTime, setTodoWorkTime] = useState();
	const {
		Dialog: SubtotalDialog,
		showModalDialog: showSubtotalModalDialog,
	} = useDialog();

	// TODO: 日付関連もう少し整理する
	const list = allList.filter(record => record.isDateOf(startOfDate()));

	const currentRecord = list[list.length - 1];

	const [targetDate, setTargetDate] = useState(startOfDate());
	// @ts-expect-error TS2339: Property 'groupBy' does not exist on type 'MapConstructor'.
	// もうすぐ型定義が追加される https://github.com/microsoft/TypeScript/pull/56805
	const grouped = Map.groupBy(allList.filter(record => record.isDateOf(targetDate)), ({type}) => type);
	const totalWorkTimeSeconds = [...grouped.values()].flatMap(records => records.map(record => is勤務外(record.type) ? 0 : record.workTimeSeconds)).reduce((a, b) => a + b, 0);

	useEffect(() => {
		// TODO: リフレッシュの改善（全体は無駄）
		const id = window.setInterval(() => {
			refresh();
		}, 1000);
		return () => window.clearInterval(id);
	}, [refresh]);

	const finishAndAddRecord = (args) => {
		// FIXME: mutableをやめる
		currentRecord?.finish();
		add(new TimeRecord(args));
	};

	return createElement(
		React.Fragment,
		{},
		createElement('h1', {}, 'Time Tracker'),
		createElement('h2', {}, '分類'),
		createElement(
			EditModeTab, {
				checked: isTypeEditMode,
				onChange: setTypeEditMode,
			},
			createElement('ul', {}, types.map((type, i) => {
				return createElement(
					'li',
					{
						key: type.name,
						className: type.name === currentRecord?.type ? 'current' : undefined,
					},
					isTypeEditMode && createElement(
						'button',
						{
							onClick: () => {
								if (window.confirm(`「${type.name}」を削除しますか？`)) {
									// FIXME: mutableをやめる
									// types.toSpliced が使える
									types.splice(i, 1);
									saveType();
								}
							},
						},
						'削除',
					),
					createElement(
						'button',
						{
							accessKey: type.accessKey,
							onClick: () => {
								finishAndAddRecord({type: type.name});
							},
						},
						'開始' + (!isTypeEditMode && type.accessKey ? ` (${type.accessKey})` : ''),
					),
					isTypeEditMode && createElement(
						'input',
						{
							title: 'アクセスキー: ' + (type.accessKey ?? 'なし'),
							placeholder: 'アクセスキーなし',
							pattern: type.accessKey ? null : `[^${usedAccessKeys.map(escapeCharacterClassMetaChar).join('')}]`,
							defaultValue: type.accessKey,
							maxLength: 1,
							size: 2,
							onBlur: e => {
								if (e.target.validity.patternMismatch) {
									// 別の入力欄を編集して不正じゃなくなった場合に`:invalid`ではなくなり正常に登録されたと誤解するため入力を削除する
									e.target.value = '';
								}
							},
							onChange: e => {
								if (e.target.validity.patternMismatch) return;
								// FIXME: mutableをやめる
								type.accessKey = e.target.value || undefined;
								saveType();
							},
						},
					),
					type.name,
				);
			})),
			isTypeEditMode && createElement(
				'form',
				{
					onSubmit: e => {
						// TODO: 重複チェック
						addType({
							name: newType,
						});
						setNewType('');
						e.preventDefault();
					},
				},
				createElement(
					'input',
					{
						required: true,
						value: newType,
						placeholder: '分類',
						onChange: e => {
							setNewType(e.target.value);
						},
					},
				),
				createElement('button', {}, '分類追加'),
			),
		),
		createElement('h2', {}, 'ToDo'),
		createElement(
			EditModeTab, {
				checked: isTodoEditMode,
				onChange: setTodoEditMode,
			},
			createElement(
				Checkbox, {
					checked: isInputToDoFromClipboardEnabled,
					onChange: setInputToDoFromClipboardEnabled,
				},
				'クリップボードを貼り付けでToDoを入力する',
			),
			createElement(
				Checkbox, {
					checked: usingTodoGroup,
					onChange: setTodoGroup,
				},
				'グループで管理する',
			),
			createElement(
				Checkbox, {
					checked: usingTodoDeadline,
					onChange: setTodoDeadline,
				},
				'期限を管理する',
			),
			(() => {
				const createList = (list) => {
					if (list.length === 0) return createElement('ul', {}, createElement('li', {}, 'ToDoなし'));
					return createElement('ul', {}, list.map((todo) => {
						const i = todos.indexOf(todo);
						const todoWorkTimeTatal = todoWorkTimes[i].total;
						const isCurrent = (todo.type === currentRecord?.type) && ((todo.title || '') === (currentRecord?.title || ''));
						const className = isCurrent ? 'current' : undefined;
						return createElement(
							'li',
							{
								key: i,
								className,
							},
							createElement(
								TodoRow,
								{
									todo,
									isTodoEditMode,
									usingTodoGroup,
									usingTodoDeadline,
									todos,
									todoGroups,
									saveTodo,
									finishAndAddRecord,
									types,
									todoWorkTimeTatal,
									showSubtotal: () => {
										setTodoWorkTime(todoWorkTimes[i]);
										showSubtotalModalDialog();
									},
								},
							),
						);
					}));
				};
				if (usingTodoGroup) {
					const groupNothingValue = undefined;
					// @ts-expect-error TS2339: Property 'groupBy' does not exist on type 'MapConstructor'.
					// もうすぐ型定義が追加される https://github.com/microsoft/TypeScript/pull/56805
					const groupdMap = Map.groupBy(todos, (({group}) => todoGroups.includes(group) ? group : groupNothingValue));
					return createElement(
						React.Fragment,
						{},
						[...todoGroups, groupNothingValue].map((group, groupIndex) => {
							return createElement(
								React.Fragment,
								{
									key: groupIndex,
								},
								createElement(
									'h3',
									{},
									group === groupNothingValue ? groupNothingName : group,
									(isTodoEditMode && group !== groupNothingValue) && createElement(React.Fragment, {},
										createElement('button', {
											onClick: () => {
												if (window.confirm(`グループ「${group}」を削除しますか？`)) {
													// FIXME: mutableをやめる
													// types.toSpliced が使える
													const i = todoGroups.indexOf(group);
													todoGroups.splice(i, 1);
													saveTodoGroup();
												}
											},
										}, '削除'),
										createElement('button', {
											disabled: groupIndex === 0,
											onClick: () => {
												// FIXME: mutableをやめる
												swap(todoGroups, groupIndex, groupIndex - 1);
												saveTodoGroup();
											},
										}, '上へ移動'),
										createElement('button', {
											disabled: groupIndex === todoGroups.length - 1,
											onClick: () => {
												// FIXME: mutableをやめる
												swap(todoGroups, groupIndex, groupIndex + 1);
												saveTodoGroup();
											},
										}, '下へ移動'),
									),
								),
								createList(groupdMap.get(group) ?? []),
							);
						}),
					);
				}
				return createList(todos);
			})(),
			'※ ToDoごとの経過時間の集計には分類・タイトルのみを使用し、メモ / URLの違いを無視する',
			(isTodoEditMode && usingTodoGroup) && createElement(
				'form',
				{
					onSubmit: e => {
						if (!todoGroups.includes(newTodoGroup)) {
							addTodoGroup(newTodoGroup);
						}
						e.preventDefault();
					},
				},
				createElement(
					'input',
					{
						required: true,
						value: newTodoGroup,
						placeholder: 'グループ',
						onChange: e => {
							setNewTodoGroup(e.target.value);
						},
					},
				),
				createElement('button', {}, 'グループ追加'),
			),
			isTodoEditMode && createElement(
				'form',
				{
					onSubmit: e => {
						// TODO: 重複チェック(type,titleで一意)
						addTodo({
							type: newTodoType,
							title: newTodoTitle,
							memo: newTodoMemo,
						});
						setNewTodoTitle('');
						setNewTodoMemo('');
						e.preventDefault();
					},
				},
				createElement(
					'select',
					{
						required: true,
						value: newTodoType,
						onChange: e => {
							setNewTodoType(e.target.value);
						},
					},
					typesToNamesWithCurrent(types, '').map((type, i) => {
						return createElement('option', {
							key: i,
							value: type,
						}, type || '【分類】');
					}),
				),
				createElement(
					'input',
					{
						ref: newTodoTitleRef,
						value: newTodoTitle,
						placeholder: 'タイトル',
						size: titleSize,
						onChange: e => {
							setNewTodoTitle(e.target.value);
						},
					},
				),
				createElement(
					'input',
					{
						value: newTodoMemo,
						placeholder: 'メモ / URL',
						onChange: e => {
							setNewTodoMemo(e.target.value);
						},
					},
				),
				createElement('button', {}, 'ToDo追加'),
			),
		),
		createElement('h2', {}, '現在'),
		currentRecord ? createElement(RecordView, {types, record: currentRecord, save, hideDate: true}) : '未開始',
		createElement('h2', {}, '履歴'),
		createElement('ol', {}, list.map((record) => {
			return createElement(
				'li',
				{
					key: record.start,
				},
				createElement(RecordView, {types, record, save, finishAndAddRecord, hideDate: true}),
			);
		})),
		createElement('h2', {}, '集計結果'),
		createElement(
			'input',
			{
				type: 'date',
				defaultValue: Formats.ISODateString(targetDate),
				onChange: e => {
					if (e.target.validity.badInput) return;
					setTargetDate(startOfDate(new Date(e.target.valueAsNumber)));
				},
			},
		),
		`(${targetDate.toLocaleString(undefined, {weekday: 'short'})})`,
		'～',
		// TODO: 範囲指定可能にする
		createElement('br'),
		`勤務時間Total: ${Formats.seconds(totalWorkTimeSeconds)}`,
		createElement('br'),
		createElement(
			Checkbox, {
				checked: isDetailVisible,
				onChange: setDetailVisible,
			},
			'詳細を表示する',
		),
		createElement(
			Checkbox, {
				checked: hideNoTitleOrMemo,
				onChange: setHideNoTitleOrMemo,
				disabled: !isDetailVisible,
			},
			'タイトル・メモが存在しないものは省略',
		),
		createElement('ul', {}, [...grouped.entries()].map(([type, records]) => {
			const workTimeSeconds = records.map(record => record.workTimeSeconds).reduce((a, b) => a + b, 0);
			return {
				type,
				records,
				workTimeSeconds,
			};
		}).sort((a, b) => {
			// 降順
			return b.workTimeSeconds - a.workTimeSeconds;
		}).map(({type, records, workTimeSeconds}) => {
			return createElement(
				'li',
				{
					key: type,
				},
				type,
				createElement('br'),
				// TODO: 日付別に集計結果を表示する
				`[${is勤務外(type) ? '勤務外のため割合計算対象外' : Formats.percent(workTimeSeconds / totalWorkTimeSeconds)}] ${Formats.seconds(workTimeSeconds)}`,
				isDetailVisible && createElement('ol', {}, records.map(record => {
					if (hideNoTitleOrMemo && !(record.title || record.memo)) return null;
					return createElement(
						'li',
						{
							key: record.start,
						},
						createElement(RecordView, {types, record, save, finishAndAddRecord, isEditable: false}),
					);
				})),
			);
		})),
		createElement('h2', {}, 'Stats'),
		createElement('ul', {},
			...[
				`履歴総数: ${allList.length}`,
				`ToDo総数: ${todos.length}`,
				`記録開始日: ${allList[0] ? Formats.localeDateString(allList[0].start) : '取得中'}`,
				`記録日数: ${allList.map(record => Formats.localeDateString(record.start)).reduce((acc, date) => {
					return date === acc.date ? acc : {date, count: acc.count + 1};
				}, {date: 'null', count: 0}).count}`,
				'ストレージ: ' + (usage ? `${Formats.percent(usage.bytesInUse / usage.bytesQuota)} (${Formats.bytes(usage.bytesInUse)} / ${Formats.bytes(usage.bytesQuota)})` : '計算中'),
			].map(text => createElement('li', {}, text)),
		),
		createElement(
			SubtotalDialog,
			{},
			createElement('h3', {}, `${todoWorkTime?.todo.type}(${todoWorkTime?.todo.title})`),
			todoWorkTime?.total && createElement('p', {}, `合計: ${Formats.seconds(todoWorkTime.total)}`),
			createElement(
				'ol',
				{},
				Array.from(todoWorkTime?.subtotalByDate?.entries() ?? []).map(([date, subtotal]) => {
					return createElement('li', {key: date}, `${date}: ${Formats.seconds(subtotal)}`);
				}),
			),
		),
	);
};

ReactDOM
	// @ts-expect-error TS2339: Property 'createRoot' does not exist on type 'typeof import("$path_to/node_modules/@types/react-dom/index")'.
	// なぜか ReactDOM.createRoot が存在しない
	.createRoot(document.getElementById('app'))
	.render(createElement(App));
