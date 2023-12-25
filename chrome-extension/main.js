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
 * @param {string} storageKey
 * @param {function(any): T=} transform
 * @returns {{
 * 	allList: T[]
 * 	refresh: function(): void
 * 	add: function(T): void
 * 	save: function(): void
 * }}
 */
const useStorageList = (storageKey, transform) => {
	const [allList, setList] = useState([]);
	useEffect(() => {
		loadFromStorage(storageKey, list => {
			setList((list ?? []).map(transform ?? (v => v)));
		});
	}, [storageKey, transform]);
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
 * @param {TimeRecord} param0.record
 * @returns
 */
const RecordView = ({
	types,
	record,
	save,
	finishAndAddRecord,
	isEditable = true, // FIXME: 名前の適切化
}) => {
	// TODO: 縦位置を揃えたい
	return createElement(
		React.Fragment,
		{},
		`${new Date(record.start).toLocaleTimeString()}～${record.end ? new Date(record.end).toLocaleTimeString() : ''}`,
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
				placeholder: 'title',
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
				placeholder: 'memo',
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
						finishAndAddRecord(record);
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

const Checkbox = ({
	children,
	checked,
	onChange,
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
	} = useStorageList('type');
	const [newType, setNewType] = useState('');

	const {
		allList,
		refresh,
		add,
		save,
	} = useStorageList('record', TimeRecord.load);

	const [isTodoEditMode, setTodoEditMode] = useState(false);
	const [isDetailVisible, setDetailVisible] = useState(false);

	// TODO: 日付関連もう少し整理する
	const list = allList.filter(record => record.isDateOf(startOfDate()));

	const currentRecord = list[list.length - 1];

	const [targetDate, setTargetDate] = useState(startOfDate());
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
		createElement('h2', {}, 'Type'),
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
							if (window.confirm('削除しますか？')) {
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
					placeholder: 'type',
					onChange: e => {
						setNewType(e.target.value);
					},
				},
			),
			createElement('button', {}, 'Type追加'),
		),
		createElement('h2', {}, 'Todo'),
		createElement(
			Checkbox, {
				checked: isTodoEditMode,
				onChange: setTodoEditMode,
			},
			'編集モード',
		),
		createElement('ul', {}, todos.map((todo, i) => {
			const isCurrent = (todo.type === currentRecord?.type) && (todo.title === currentRecord?.title);
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
							if (window.confirm('削除しますか？')) {
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
						placeholder: 'title',
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
						placeholder: 'memo / URL',
						onChange: e => {
							// FIXME: mutableをやめる
							todo.memo = e.target.value;
							saveTodo();
						},
					},
				) : hasUrlMemo ? '' : todo.memo,
			);
		})),
		isTodoEditMode && createElement(
			'form',
			{
				onSubmit: e => {
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
					}, type || '【Type】');
				}),
			),
			createElement(
				'input',
				{
					value: newTodoTitle,
					placeholder: 'title',
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
					placeholder: 'memo',
					onChange: e => {
						setNewTodoMemo(e.target.value);
					},
				},
			),
			createElement('button', {}, 'TODO追加'),
		),
		createElement('h2', {}, '現在'),
		currentRecord ? createElement(RecordView, {types, record: currentRecord, save}) : '未開始',
		createElement('h2', {}, '履歴'),
		createElement('ol', {}, list.map((record) => {
			return createElement(
				'li',
				{
					key: record.start,
				},
				createElement(RecordView, {types, record, save, finishAndAddRecord}),
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
			'詳細を表示する ※ title, memoが存在しないものは省略',
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
					if (!(record.title || record.memo)) return null;
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
	.createRoot(document.getElementById('app'))
	.render(createElement(App));
