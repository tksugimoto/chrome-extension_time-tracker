// @ts-check
/* global chrome */
/* global React, ReactDOM */
const {
	createElement,
	useState,
	useCallback,
	useEffect,
} = React;

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
	_percentFormat: Intl.NumberFormat('default', {
		style: 'percent',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}),
	percent(num) {
		return this._percentFormat.format(num);
	},
	padStart0(num) {
		return num.toString().padStart(2, '0');
	},
	seconds(time) {
		const seconds = time % 60;
		const minutes = Math.floor(time / 60) % 60;
		const hours = Math.floor(time / 60 / 60);
		if (hours) return `${hours}時間${this.padStart0(minutes)}分${this.padStart0(seconds)}秒`;
		if (minutes) return `${this.padStart0(minutes)}分${this.padStart0(seconds)}秒`;
		return `${this.padStart0(seconds)}秒`;
	},
	ISODateString(date) {
		return new Date(date.getTime() - (date.getTimezoneOffset() * 60000 )).toISOString().replace(/T.*/, '');
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

const defaultTypes = [{
	name: 'メールチェック',
}, {
	name: 'ミーティング',
}, {
	name: 'レビュー',
}, {
	name: '中断',
}];

const App = () => {
	const {
		allList: todos,
		add: addTodo,
		save: saveTodo,
	} = useStorageList('todo');
	const [newTodoType, setNewTodoType] = useState('');
	const [newTodoTitle, setNewTodoTitle] = useState('');
	const [newTodoMemo, setNewTodoMemo] = useState('');

	const {
		allList: types,
		add: addType,
		save: saveType,
	} = useStorageList('type', {
		defaultValue: defaultTypes,
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

	const [isTodoEditMode, setTodoEditMode] = useState(false);
	const [isDetailVisible, setDetailVisible] = useState(false);
	const [hideNoTitleOrMemo, setHideNoTitleOrMemo] = useState(true);

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
		}
		return acc;
	}, todos.map(todo => {
		return {
			todo,
			total: 0,
		};
	}));

	// TODO: 日付関連もう少し整理する
	const list = allList.filter(record => record.isDateOf(startOfDate()));

	const currentRecord = list[list.length - 1];

	const [targetDate, setTargetDate] = useState(startOfDate());
	// @ts-expect-error TS2339: Property 'groupBy' does not exist on type 'MapConstructor'.
	// もうすぐ型定義が追加される https://github.com/microsoft/TypeScript/pull/56805
	const grouped = Map.groupBy(allList.filter(record => !is勤務外(record.type) && record.isDateOf(targetDate)), ({type}) => type);
	const totalWorkTimeSeconds = [...grouped.values()].flatMap(records => records.map(record => record.workTimeSeconds)).reduce((a, b) => a + b, 0);

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
		createElement('ul', {}, types.map((type, i) => {
			return createElement(
				'li',
				{
					key: type.name,
					className: type.name === currentRecord?.type ? 'current' : undefined,
				},
				createElement(
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
						onClick: () => {
							finishAndAddRecord({type: type.name});
						},
					},
					'開始',
				),
				type.name,
			);
		})),
		createElement(
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
		createElement('h2', {}, 'ToDo'),
		createElement(
			Checkbox, {
				checked: isTodoEditMode,
				onChange: setTodoEditMode,
			},
			'編集モード',
		),
		createElement('ul', {}, todos.map((todo, i) => {
			const isCurrent = (todo.type === currentRecord?.type) && ((todo.title || '') === (currentRecord?.title || ''));
			const hasUrlMemo = !!todo.memo?.match(/^http[^ ]+$/);
			const className = isCurrent ? 'current' : undefined;
			return createElement(
				'li',
				{
					key: i,
					className,
				},
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
				` [${Formats.seconds(todoWorkTimes[i].total)}] `,
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
		})),
		'※ ToDoごとの経過時間の集計には分類・タイトルのみを使用し、メモ / URLの違いを無視する',
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
		`Total: ${Formats.seconds(totalWorkTimeSeconds)}`,
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
				`[${Formats.percent(workTimeSeconds / totalWorkTimeSeconds)}] ${Formats.seconds(workTimeSeconds)}`,
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
	);
};

ReactDOM
	// @ts-expect-error TS2339: Property 'createRoot' does not exist on type 'typeof import("$path_to/node_modules/@types/react-dom/index")'.
	// なぜか ReactDOM.createRoot が存在しない
	.createRoot(document.getElementById('app'))
	.render(createElement(App));
