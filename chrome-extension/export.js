/* global chrome */
import {setBackupDownloadLink} from './backup.js';

const autoDownload = new URLSearchParams(location.search).has('auto');
// リロードやセッション復元のたびにダウンロードされないよう、URL から外しておく
if (autoDownload) history.replaceState(null, '', location.pathname);

chrome.storage.local.get(null).then(items => {
	const link = /** @type {HTMLAnchorElement} */ (document.getElementById('download'));
	setBackupDownloadLink(link, items, {extensionVersion: chrome.runtime.getManifest().version});
	link.hidden = false;
	if (autoDownload) link.click();
	document.getElementById('status').textContent = autoDownload
		? 'ダウンロードを開始しました。保存されていない場合は下のリンクから保存してください。'
		: '下のリンクから保存してください。';
}).catch(error => {
	console.error(error);
	document.getElementById('status').textContent = `バックアップに失敗しました: ${error.message}`;
});
