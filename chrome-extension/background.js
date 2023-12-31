/* global chrome */

const openNewTab = () => {
	chrome.tabs.create({
		url: chrome.runtime.getManifest().action.default_popup,
	});
};

const CONTEXT_MENU_KEY_ID_OPEN = 'open';
const CONTEXT_MENU_KEY_ID_RELOAD = 'reload';

chrome.runtime.onInstalled.addListener(async () => {
	openNewTab();
	await chrome.contextMenus.create({
		title: '新規タブで開く',
		contexts: ['action'],
		id: CONTEXT_MENU_KEY_ID_OPEN,
	});
	await chrome.contextMenus.create({
		title: 'リロード',
		contexts: ['action'],
		id: CONTEXT_MENU_KEY_ID_RELOAD,
	});
});

chrome.contextMenus.onClicked.addListener(info => {
	if (info.menuItemId === CONTEXT_MENU_KEY_ID_OPEN) {
		openNewTab();
		return;
	}
	if (info.menuItemId === CONTEXT_MENU_KEY_ID_RELOAD) {
		chrome.runtime.reload();
		return;
	}
});

chrome.commands.onCommand.addListener(command => {
	if (command === 'open_or_focus') {
		const url = chrome.runtime.getURL(chrome.runtime.getManifest().action.default_popup);
		chrome.tabs.query({
			url, // "tabs" 権限が必要。自拡張のURLでも必要。
		}).then(([tab]) => {
			if (!tab) return chrome.tabs.create({url});

			chrome.windows.update(tab.windowId, {
				focused: true,
			});
			chrome.tabs.update(tab.id, {
				active: true,
			});
		});
	}
});
