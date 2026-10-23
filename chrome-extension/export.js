/* global chrome */

const pad = n => String(n).padStart(2, '0');

const createFileName = (date = new Date()) => {
	const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
	const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return `time-tracker-backup-${ymd}-${hms}.json`;
};

chrome.storage.local.get(null).then(items => {
	const blob = new Blob([JSON.stringify(items, null, '\t')], {
		type: 'application/json',
	});
	const link = document.getElementById('download');
	link.href = URL.createObjectURL(blob);
	link.download = createFileName();
	link.hidden = false;
	link.click();
	document.getElementById('status').textContent = `${link.download} を保存しました。`;
}).catch(error => {
	console.error(error);
	document.getElementById('status').textContent = `バックアップに失敗しました: ${error.message}`;
});
