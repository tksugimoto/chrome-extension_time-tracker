/* global chrome */

const CONTEXT_MENU_KEY_ID_OPEN = 'open';

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		title: '新規タブで開く',
		contexts: ['action'],
		id: CONTEXT_MENU_KEY_ID_OPEN,
	});
});

chrome.contextMenus.onClicked.addListener(info => {
	if (info.menuItemId === CONTEXT_MENU_KEY_ID_OPEN) {
		chrome.tabs.create({
			url: chrome.runtime.getManifest().action.default_popup,
		});
	}
});
