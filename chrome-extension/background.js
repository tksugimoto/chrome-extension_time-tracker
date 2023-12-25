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
