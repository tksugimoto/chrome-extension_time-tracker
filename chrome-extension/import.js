/* global chrome */
import {LIST_KEYS, Lists, keysToRemove, parseBackup, setBackupDownloadLink, summarize} from './backup.js';

const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file'));
const statusElement = document.getElementById('status');
const preview = document.getElementById('preview');
const restoreButton = /** @type {HTMLButtonElement} */ (document.getElementById('restore'));

/** @type {ReturnType<typeof parseBackup> | undefined} */
let selectedBackup;
/** ファイルを選び直したときに、前のファイルの読み込み結果で上書きしないための番号 */
let fileSelectionId = 0;

const showStatus = message => {
	statusElement.textContent = message;
};

const createCell = (tagName, text) => {
	const cell = document.createElement(tagName);
	cell.textContent = text;
	return cell;
};

const renderCounts = (current, backup) => {
	document.getElementById('counts').replaceChildren(...Object.entries(Lists).map(([key, {label}]) => {
		const row = document.createElement('tr');
		row.append(
			createCell('th', label),
			createCell('td', `${current[key]} 件`),
			createCell('td', `${backup[key]} 件`),
		);
		return row;
	}));
};

/**
 * @param {string} exportedAt
 */
const formatExportedAt = exportedAt => {
	const date = new Date(exportedAt);
	return Number.isNaN(date.getTime()) ? '作成日時不明' : `${date.toLocaleString()} に作成`;
};

/** 復元で消える現在のデータを、念のためダウンロードしておく（保存されたかは分からないので、リンクも残す） */
const downloadCurrentData = items => {
	const link = /** @type {HTMLAnchorElement} */ (document.getElementById('before-restore-download'));
	setBackupDownloadLink(link, items, {extensionVersion: chrome.runtime.getManifest().version});
	document.getElementById('before-restore').hidden = false;
	link.click();
};

fileInput.addEventListener('change', () => {
	const selectionId = ++fileSelectionId;
	selectedBackup = undefined;
	preview.hidden = true;
	const [file] = fileInput.files;
	if (!file) {
		showStatus('');
		return;
	}
	Promise.all([
		file.text(),
		chrome.storage.local.get(LIST_KEYS),
	]).then(([text, currentLists]) => {
		if (selectionId !== fileSelectionId) return;
		const backup = parseBackup(text);
		selectedBackup = backup;
		showStatus(`${formatExportedAt(backup.exportedAt)}のバックアップです（拡張機能 v${backup.extensionVersion ?? '不明'}）。`);
		renderCounts(summarize(currentLists), summarize(backup.data));
		restoreButton.disabled = false;
		preview.hidden = false;
	}).catch(error => {
		if (selectionId !== fileSelectionId) return;
		console.error(error);
		showStatus(`読み込めませんでした: ${error.message}`);
	});
});

restoreButton.addEventListener('click', () => {
	const backup = selectedBackup;
	if (!backup) return;
	if (!confirm('現在のデータをすべてバックアップの内容に置き換えます。よろしいですか？')) return;
	restoreButton.disabled = true;
	fileInput.disabled = true;
	showStatus('復元しています…');
	chrome.storage.local.get(null).then(currentItems => {
		downloadCurrentData(currentItems);
		// 先に書き込んでから不要なキーを消す（clear してから書き込むと、書き込みに失敗したときに全データを失う）
		return chrome.storage.local.set(backup.data)
			.then(() => chrome.storage.local.remove(keysToRemove(Object.keys(currentItems), backup.data)));
	}).then(() => {
		selectedBackup = undefined;
		// 同じファイルを選び直しても change が発生するようにする
		fileInput.value = '';
		preview.hidden = true;
		showStatus('復元しました。開いている記録ページは自動で読み込み直されます。復元前のデータが保存されていない場合は、下のリンクから保存してください。');
		// 開いている記録ページが古いデータで上書きしないよう、読み込み直させる (main.js で受け取る)
		// 受け取るページがないときは reject されるので無視する
		chrome.runtime.sendMessage({type: 'backup-restored'}).catch(() => {});
	}).catch(error => {
		console.error(error);
		showStatus(`復元に失敗しました: ${error.message}`);
		restoreButton.disabled = false;
	}).finally(() => {
		fileInput.disabled = false;
	});
});
