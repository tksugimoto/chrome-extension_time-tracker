// @ts-check
/* global chrome */
/* global React, ReactDOM */
import {
	startOfDate,
	TimeRecord,
	Formats,
	todoKeyOf,
	addRecordsToTodoWorkTimes,
	calculateRemainingTime,
	escapeCharacterClassMetaChar,
	createDebouncedWriter,
} from './utils.js';

/** @typedef {import('./utils.js').Todo} Todo */

const {
	createElement,
	useState,
	useCallback,
	useRef,
	useEffect,
	useMemo,
	useReducer,
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

// TODO: types に組み込む
const is勤務外 = type => {
	return [
		'昼休憩',
		'中断',
	].includes(type);
};

// バックアップから復元されたら、古いデータで上書きしないよう読み込み直す (import.js から送られる)
// 復元したデータを、まだ反映していない入力 (LazyInput) で上書きしないよう捨てる
let isDiscardingPendingInputs = false;
chrome.runtime.onMessage.addListener(message => {
	if (message?.type !== 'backup-restored') return;
	isDiscardingPendingInputs = true;
	location.reload();
});

const loadFromStorage = (key, callback) => {
	chrome.storage.local.get(key, items => {
		callback(items[key]);
	});
};
const saveToStorage = (key, value) => {
	chrome.storage.local.set({
		[key]: value,
	}).catch(error => {
		console.error('保存に失敗しました', key, error);
		alert(`保存に失敗しました。\n直前の変更はページを再読み込みすると失われます。\n\n${error?.message ?? error}`);
	});
};

/**
 * unlimitedStorage のため上限 (QUOTA_BYTES) は適用されない
 * @returns {Promise<{
 *	bytesInUse: number;
 * }>}
 */
const fetchUsage = () => {
	return chrome.storage.local.getBytesInUse().then(bytesInUse => ({bytesInUse}));
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
	const add = useCallback(value => {
		setList(list => {
			// TODO: setStateのcallbackの中で副作用ありで良いのか確認
			const newList = [...list, value];
			saveToStorage(storageKey, newList);
			return newList;
		});
	}, [storageKey]);
	// 入力欄 (LazyInput) は後から save するので、描画したときの allList ではなく最新の一覧を書き込む
	const save = useCallback(() => {
		setList(list => {
			saveToStorage(storageKey, list);
			return [...list];
		});
	}, [storageKey]);
	return {
		allList,
		add,
		save,
	};
};

/** 入力が止まってから反映するまでの時間 */
const inputCommitDelayMs = 1000;

/**
 * 文字入力のたびに全件を保存・再描画しないよう、入力中の文字はこの入力欄の中だけで持つ input
 * onCommit は入力が止まったとき・入力欄から離れたとき・ページが隠れたとき (閉じるときも先に hidden になる) に呼ぶ
 * @param {{
 * 	value: string | undefined;
 * 	onCommit: function(string): void;
 * 	inputRef?: any; // TODO: type定義
 * } & Object<string, any>} param0 そのほかは input にそのまま渡す
 */
const LazyInput = ({
	value,
	onCommit,
	inputRef,
	...props
}) => {
	const [text, setText] = useState(value ?? '');
	// 反映した値や、ほかから変わった値を表示する
	useEffect(() => setText(value ?? ''), [value]);
	const handlers = useMemo(() => {
		// 反映先は入力したときの onCommit にする (待っているあいだに表示する記録が替わっても、元の記録に反映する)
		const writer = createDebouncedWriter(pending => {
			if (!isDiscardingPendingInputs) pending.onCommit(pending.text);
		}, inputCommitDelayMs);
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') writer.flush();
		};
		return {
			writeSoon: writer.writeSoon,
			// 入力途中の文字を持つのはフォーカス中の入力欄だけなので、そのあいだだけ見張る
			onFocus: () => document.addEventListener('visibilitychange', onVisibilityChange),
			onBlur: () => {
				document.removeEventListener('visibilitychange', onVisibilityChange);
				writer.flush();
			},
		};
	}, []);
	useEffect(() => handlers.onBlur, [handlers]);
	return createElement('input', {
		...props,
		ref: inputRef,
		value: text,
		onChange: e => {
			setText(e.target.value);
			handlers.writeSoon({text: e.target.value, onCommit});
		},
		onFocus: handlers.onFocus,
		onBlur: handlers.onBlur,
	});
};

const titleSize = 40;

/**
 *
 * @param {Object} param0
 * @param {{name: string}[]} param0.types
 * @param {TimeRecord} param0.record
 * @param {function(): void} param0.save
 * @param {function(TimeRecord): void=} param0.editTime
 * @param {function(TimeRecord): void=} param0.finishAndAddRecord
 * @param {boolean=} param0.isEditable
 * @param {boolean=} param0.hideDate
 * @param {any=} param0.titleRef // TODO: type定義
 * @returns
 */
const RecordView = ({
	types,
	record,
	save,
	editTime,
	finishAndAddRecord,
	isEditable = true, // FIXME: 名前の適切化
	hideDate = false,
	titleRef,
}) => {
	// TODO: 縦位置を揃えたい
	return createElement(
		React.Fragment,
		{},
		`${Formats[hideDate ? 'localeTimeString' : 'localeDateTimeString'](record.start)}～${record.end ? Formats.localeTimeString(record.end) : ''}`,
		`(${Formats.seconds(record.workTimeSeconds)})`,
		editTime && createElement(
			'button',
			{
				onClick: () => {
					editTime(record);
				},
			},
			'時刻編集',
		),
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
			LazyInput,
			{
				inputRef: titleRef,
				value: record.title || '',
				placeholder: 'タイトル',
				size: titleSize,
				onCommit: title => {
					// FIXME: mutableをやめる
					record.setTitle(title);
					save();
				},
			},
		),
		createElement(
			LazyInput,
			{
				value: record.memo || '',
				placeholder: 'メモ',
				onCommit: memo => {
					// FIXME: mutableをやめる
					record.setMemo(memo);
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
 * 記録の開始・終了時刻を編集する
 * 前後の記録と重ならず、開始日の中 (0:00～24:00) に収まる範囲に制限する
 * @param {{
 * 	record: TimeRecord;
 * 	prev?: TimeRecord;
 * 	next?: TimeRecord;
 * 	save: function(): void;
 * }} param0
 */
const EditTimeForm = ({
	record,
	prev,
	next,
	save,
}) => {
	const initialStart = Formats.ISODateTimeString(record.start);
	const initialEnd = record.end ? Formats.ISODateTimeString(record.end) : '';
	const [start, setStart] = useState(initialStart);
	const [end, setEnd] = useState(initialEnd);
	const min = Formats.ISODateTimeString(Math.max(prev?.end ?? prev?.start ?? 0, startOfDate(new Date(record.start)).getTime()));
	const maxMs = Math.min(next?.start ?? Date.now(), record.endOfStartDate);
	const max = Formats.ISODateTimeString(maxMs);
	// 開始が 24:00 だと翌日の記録扱いになるため、開始は 1 秒手前までにする
	const startMax = Formats.ISODateTimeString(Math.min(maxMs, record.endOfStartDate - 1000));
	// 計測中に戻せるのは今日の最後の記録だけ (前日以前は 24:00 で自動終了されるため)
	const canResume = !next && record.isDateOf(startOfDate());
	return createElement(
		'form',
		{
			method: 'dialog',
			// 入力値のチェック (前後の記録と重ならない・終了は開始以降) は input の min/max/required で行う
			onSubmit: () => {
				// datetime-local の値はタイムゾーンなしのため、ローカル時刻として解釈される
				// 秒未満を落とさないよう、変更していない値は元のまま使う
				const startMs = start === initialStart ? record.start : new Date(start).getTime();
				const endMs = end === initialEnd ? record.end : end ? new Date(end).getTime() : undefined;
				// FIXME: mutableをやめる
				record.setTime(startMs, endMs);
				save();
			},
		},
		createElement('h3', {}, record.title ? `${record.type}(${record.title})` : record.type),
		createElement(
			'label',
			{},
			'開始: ',
			createElement('input', {
				type: 'datetime-local',
				step: 1,
				required: true,
				value: start,
				min,
				max: startMax,
				onChange: e => setStart(e.target.value),
			}),
		),
		createElement('br'),
		createElement(
			'label',
			{},
			'終了: ',
			createElement('input', {
				type: 'datetime-local',
				step: 1,
				required: !canResume,
				value: end,
				min: start,
				max,
				onChange: e => setEnd(e.target.value),
			}),
			canResume && '(空欄にすると計測中に戻る)',
		),
		createElement('button', {}, '確定'),
	);
};

const groupNothingName = '(グループなし)';

/**
 * @param {{
 * 	todo: Todo;
 * 	isTodoEditMode: boolean;
 * 	usingTodoGroup: boolean;
 * 	usingTodoDeadline: boolean;
 * 	usingTodoEstimation: boolean;
 * 	todos: Todo[],
 * 	todoGroups: string[],
 * 	saveTodo: function(): void
 * 	finishAndAddRecord: function(TimeRecord | Todo): void
 * 	types: {name: string}[];
 * 	todoWorkTimeTatal: number;
 * 	isDuplicate: boolean;
 * 	showSubtotal: function(): void;
 * }} param0
 * @returns
 */
const TodoRow = ({
	todo,
	isTodoEditMode,
	usingTodoGroup,
	usingTodoDeadline,
	usingTodoEstimation,
	todos,
	todoGroups,
	saveTodo,
	finishAndAddRecord,
	types,
	todoWorkTimeTatal,
	isDuplicate,
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
		usingTodoEstimation && createElement(React.Fragment, {},
			' / ',
			isTodoEditMode && createElement(LazyInput, {
				type: 'text',
				value: todo.estimation,
				placeholder: '見積もり',
				size: 4,
				onCommit: value => {
					// FIXME: mutableをやめる
					const num = Number(value);
					todo.estimation = Number.isNaN(num) || num < 0 ? undefined : value;
					saveTodo();
				},
			}),
			isTodoEditMode && '時間',
			!isTodoEditMode && Formats.seconds(todo.estimation ? Number(todo.estimation) * 60 * 60 : 0),
			todo.estimation && ` (${Formats.percent(todoWorkTimeTatal / (Number(todo.estimation) * 60 * 60))})`,
		),
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
			LazyInput,
			{
				value: todo.title,
				placeholder: 'タイトル',
				size: titleSize,
				onCommit: title => {
					// FIXME: mutableをやめる
					todo.title = title;
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
			LazyInput,
			{
				value: todo.memo,
				placeholder: 'メモ / URL',
				onCommit: memo => {
					// FIXME: mutableをやめる
					todo.memo = memo;
					saveTodo();
				},
			},
		) : hasUrlMemo ? '' : todo.memo,
		isDuplicate && createElement('span', {
			className: 'duplicate-todo',
		}, '※分類・タイトルが重複（時間は先に登録したToDoに計上）'),
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
				className: 'sticky',
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

const App = () => {
	const {
		allList: todos,
		add: addTodo,
		save: saveTodo,
	} = useStorageList('todo');
	const [newTodoType, setNewTodoType] = useState('');
	/** @type{ReturnType<typeof useRef<HTMLInputElement>>} */
	const currentTitleRef = useRef();
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
	const [usingTodoEstimation, setTodoEstimation] = useSetting('use-todo-estimation', false);
	const [isDetailVisible, setDetailVisible] = useSetting('detail-visible', false);
	const [hideNoTitleOrMemo, setHideNoTitleOrMemo] = useSetting('no-title_or_memo', true);
	const [isAggregationVisible, setAggregationVisible] = useSetting('aggregation-visible', false);

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

	// 毎秒の再描画で全件を集計し直さないよう、終了済みの記録の集計はメモ化し、計測中の記録だけ毎回加算する
	// 記録を書き換えたときは save() / add() で allList を作り直すこと（作り直さないとメモ化した集計が古いままになる）
	const todoIndexByKey = useMemo(() => {
		/** @type{Map<string, number>} */
		const todoIndexByKey = new Map();
		todos.forEach((todo, i) => {
			const key = todoKeyOf(todo);
			if (!todoIndexByKey.has(key)) todoIndexByKey.set(key, i);
		});
		return todoIndexByKey;
	}, [todos]);
	// 作業時間が変わり続けるのは、今日開始した未終了の記録だけ（前日以前の未終了の記録はその日の終わりまでで固定）
	const today = startOfDate().getTime();
	const [finishedRecords, runningRecords] = useMemo(() => {
		/** @type{TimeRecord[]} */
		const finished = [];
		/** @type{TimeRecord[]} */
		const running = [];
		for (const record of allList) (!record.end && record.start >= today ? running : finished).push(record);
		return [finished, running];
	}, [allList, today]);
	const finishedTodoWorkTimes = useMemo(() => {
		const empty = todos.map(todo => ({todo, total: 0, subtotalByDate: new Map()}));
		return addRecordsToTodoWorkTimes(empty, todoIndexByKey, finishedRecords);
	}, [todos, todoIndexByKey, finishedRecords]);
	const todoWorkTimes = addRecordsToTodoWorkTimes(finishedTodoWorkTimes, todoIndexByKey, runningRecords);

	const recordedDayCount = useMemo(() => {
		return allList.map(record => Formats.localeDateString(record.start)).reduce((acc, date) => {
			return date === acc.date ? acc : {date, count: acc.count + 1};
		}, {date: 'null', count: 0}).count;
	}, [allList]);

	/** @type{ReturnType<typeof useState<typeof todoWorkTimes[number]>>} */
	const [todoWorkTime, setTodoWorkTime] = useState();
	const {
		Dialog: SubtotalDialog,
		showModalDialog: showSubtotalModalDialog,
	} = useDialog();

	/** @type{ReturnType<typeof useState<{record: TimeRecord, key: number}>>} */
	const [editTimeTarget, setEditTimeTarget] = useState();
	const {
		Dialog: EditTimeDialog,
		showModalDialog: showEditTimeModalDialog,
	} = useDialog();
	/**
	 * @param {TimeRecord} record
	 */
	const editTime = record => {
		// 開くたびに key を変えて、前回キャンセルした入力内容を残さない
		setEditTimeTarget({record, key: Date.now()});
		showEditTimeModalDialog();
	};
	const editTimeTargetIndex = editTimeTarget ? allList.indexOf(editTimeTarget.record) : -1;

	// TODO: 日付関連もう少し整理する
	const list = allList.filter(record => record.isDateOf(startOfDate()));

	const currentRecord = list[list.length - 1];

	const [targetDate, setTargetDate] = useState(startOfDate());
	// @ts-expect-error TS2339: Property 'groupBy' does not exist on type 'MapConstructor'.
	// もうすぐ型定義が追加される https://github.com/microsoft/TypeScript/pull/56805
	const grouped = Map.groupBy(allList.filter(record => record.isDateOf(targetDate)), ({type}) => type);
	const totalWorkTimeSeconds = [...grouped.values()].flatMap(records => records.map(record => is勤務外(record.type) ? 0 : record.workTimeSeconds)).reduce((a, b) => a + b, 0);

	// 計測中の時間を表示し直すための再描画。allList は作り直さないので、allList に依存するメモ化は保たれる
	const [, rerender] = useReducer(count => count + 1, 0);
	useEffect(() => {
		const id = window.setInterval(() => {
			rerender();
		}, 1000);
		return () => window.clearInterval(id);
	}, []);

	useEffect(() => {
		// 終了し忘れたまま日付を跨いだ記録は、開始日の 24:00 で終了する
		// allList は毎秒作り直されないので、ページを開いたまま日付を跨いだときは today の変化で動かす
		const unfinished = allList.filter(record => !record.end && record.start < today);
		if (unfinished.length === 0) return;
		unfinished.forEach(record => {
			// FIXME: mutableをやめる
			record.end = record.endOfStartDate;
		});
		save();
	}, [allList, save, today]);

	const finishAndAddRecord = (args) => {
		// FIXME: mutableをやめる
		currentRecord?.finish();
		add(new TimeRecord(args));
	};

	return createElement(
		React.Fragment,
		{},
		createElement('h1', {}, 'Time Tracker'),
		createElement('button', {
			onClick: () => {
				chrome.tabs.getCurrent().then(tab => {
					if (tab === undefined) return;
					chrome.windows.getCurrent().then(({
						top, left, width, height,
					}) => {
						chrome.windows.create({
							top, left, width, height,
							tabId: tab.id,
							type: 'popup',
						});
					});
				});
			},
		}, 'Popupとして開く(URLクリック時に別ウィンドウで開くようになる)'),
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
								// 新しい記録の入力欄が描画されてからフォーカスする
								setTimeout(() => currentTitleRef.current?.focus());
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
						e.preventDefault();
						if (types.some(({name}) => name === newType)) {
							alert(`分類「${newType}」は既に存在します`);
							return;
						}
						addType({
							name: newType,
						});
						setNewType('');
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
			createElement(
				Checkbox, {
					checked: usingTodoEstimation,
					onChange: setTodoEstimation,
				},
				'見積もりを管理する',
			),
			(() => {
				const currentKey = currentRecord && todoKeyOf(currentRecord);
				const createList = (list) => {
					if (list.length === 0) return createElement('ul', {}, createElement('li', {}, 'ToDoなし'));
					return createElement('ul', {}, list.map((todo) => {
						const i = todos.indexOf(todo);
						const todoWorkTimeTatal = todoWorkTimes[i].total;
						const key = todoKeyOf(todo);
						const isCurrent = key === currentKey;
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
									usingTodoEstimation,
									todos,
									todoGroups,
									saveTodo,
									finishAndAddRecord,
									types,
									todoWorkTimeTatal,
									isDuplicate: todoIndexByKey.get(key) !== i,
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
			// TODO: 表示方法調整(グループ別対応？)
			usingTodoEstimation && createElement(
				'p',
				{},
				'残り時間: ',
				Formats.seconds(todoWorkTimes.reduce((acc, {todo, total}) => {
					return acc + calculateRemainingTime(todo, total);
				}, 0)),
			),
			usingTodoEstimation && createElement(
				'ul',
				{},
				// @ts-expect-error TS2339: Property 'groupBy' does not exist on type 'MapConstructor'.
				// もうすぐ型定義が追加される https://github.com/microsoft/TypeScript/pull/56805
				[...Map.groupBy(todoWorkTimes, ({todo}) => todo.type).entries()].map(([type, sameTypeTodoWorkTimes]) => {
					const remainTime = sameTypeTodoWorkTimes.reduce((acc, {todo, total}) => {
						return acc + calculateRemainingTime(todo, total);
					}, 0);
					if (!remainTime) return null;
					return createElement('li', {key: type}, `${type}: ${Formats.seconds(remainTime)}`);
				}),
			),
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
						e.preventDefault();
						if (todoIndexByKey.has(todoKeyOf({type: newTodoType, title: newTodoTitle}))) {
							alert(`ToDo「${newTodoType}(${newTodoTitle || '-'})」は既に存在します`);
							return;
						}
						addTodo({
							type: newTodoType,
							title: newTodoTitle,
							memo: newTodoMemo,
						});
						setNewTodoTitle('');
						setNewTodoMemo('');
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
		// 記録が替わったら入力欄を作り直し、前の記録への入力が新しい記録の入力欄に残らないようにする
		currentRecord ? createElement(RecordView, {key: currentRecord.start, titleRef: currentTitleRef, types, record: currentRecord, save, editTime, hideDate: true}) : '未開始',
		createElement('h2', {}, '履歴'),
		createElement('ol', {}, list.map((record) => {
			return createElement(
				'li',
				{
					key: record.start,
				},
				createElement(RecordView, {types, record, save, editTime, finishAndAddRecord, hideDate: true}),
			);
		})),
		createElement('h2', {}, '集計結果'),
		createElement(
			'div',
			{
				className: 'sticky',
			},
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
		),
		createElement('br'),
		createElement(
			Checkbox, {
				checked: isAggregationVisible,
				onChange: setAggregationVisible,
			},
			'同一タイトルで集約',
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
				isAggregationVisible && createElement(
					'ul',
					{},
					// @ts-expect-error TS2339: Property 'groupBy' does not exist on type 'MapConstructor'.
					// もうすぐ型定義が追加される https://github.com/microsoft/TypeScript/pull/56805
					[...Map.groupBy(records, ({title}) => title || '').entries()].map(([title, sameTitleRecords]) => {
						const sameTitleWorkTimeSeconds = sameTitleRecords.map(record => record.workTimeSeconds).reduce((a, b) => a + b, 0);
						return {
							title,
							sameTitleRecords,
							sameTitleWorkTimeSeconds,
						};
					}).sort((a, b) => {
						// 降順
						return b.sameTitleWorkTimeSeconds - a.sameTitleWorkTimeSeconds;
					}).map(({title, sameTitleRecords, sameTitleWorkTimeSeconds}) => {
						return createElement(
							'li',
							{
								key: title,
							},
							`[${Formats.seconds(sameTitleWorkTimeSeconds)}] ${title}`,
							isDetailVisible && createElement('ol', {}, sameTitleRecords.map(record => {
								if (hideNoTitleOrMemo && !(record.title || record.memo)) return null;
								return createElement(
									'li',
									{
										key: record.start,
									},
									createElement(RecordView, {types, record, save, editTime, finishAndAddRecord, isEditable: false}),
								);
							})),
						);
					}),
				),
				!isAggregationVisible && isDetailVisible && createElement('ol', {}, records.map(record => {
					if (hideNoTitleOrMemo && !(record.title || record.memo)) return null;
					return createElement(
						'li',
						{
							key: record.start,
						},
						createElement(RecordView, {types, record, save, editTime, finishAndAddRecord, isEditable: false}),
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
				`記録日数: ${recordedDayCount}`,
				'ストレージ: ' + (usage ? Formats.bytes(usage.bytesInUse) : '計算中'),
			].map(text => createElement('li', {}, text)),
		),
		createElement(
			EditTimeDialog,
			{},
			editTimeTarget && createElement(EditTimeForm, {
				key: editTimeTarget.key,
				record: editTimeTarget.record,
				prev: allList[editTimeTargetIndex - 1],
				next: allList[editTimeTargetIndex + 1],
				save,
			}),
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
