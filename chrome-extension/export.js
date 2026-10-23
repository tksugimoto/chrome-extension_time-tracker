/* global chrome */

const pad = n => String(n).padStart(2, '0');

const createFileName = (date = new Date()) => {
	const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
	const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return `time-tracker-backup-${ymd}-${hms}.json`;
};

const autoDownload = new URLSearchParams(location.search).has('auto');
// リロードやセッション復元のたびにダウンロードされないよう、URL から外しておく
if (autoDownload) history.replaceState(null, '', location.pathname);

chrome.storage.local.get(null).then(items => {
	const now = new Date();
	// 将来インポートするときに、ファイルの種類と形式の版を見分けられるようにする
	const backup = {
		format: 'time-tracker-backup',
		version: 1,
		extensionVersion: chrome.runtime.getManifest().version,
		exportedAt: now.toISOString(),
		data: items,
	};
	const blob = new Blob([JSON.stringify(backup, null, '\t')], {
		type: 'application/json',
	});
	const link = document.getElementById('download');
	link.href = URL.createObjectURL(blob);
	link.download = link.textContent = createFileName(now);
	link.hidden = false;
	if (autoDownload) link.click();
	document.getElementById('status').textContent = autoDownload
		? 'ダウンロードを開始しました。保存されていない場合は下のリンクから保存してください。'
		: '下のリンクから保存してください。';
}).catch(error => {
	console.error(error);
	document.getElementById('status').textContent = `バックアップに失敗しました: ${error.message}`;
});
