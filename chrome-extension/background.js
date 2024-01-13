/* global chrome */

const openNewTab = () => {
	chrome.tabs.create({
		url: chrome.runtime.getManifest().action.default_popup,
	});
};

const ContextMenus = [{
	id: 'open',
	title: '新規タブで開く',
	onClicked: openNewTab,
}, {
	id: 'reload',
	title: 'リロード',
	onClicked: () => chrome.runtime.reload(),
}];

chrome.runtime.onInstalled.addListener((details) => {
	if ([
		chrome.runtime.OnInstalledReason.INSTALL,
		chrome.runtime.OnInstalledReason.UPDATE,
	].includes(details.reason)) openNewTab();

	ContextMenus.reduce((promise, contextMenu) => {
		return promise.then(() => {
			return new Promise(resolve => {
				chrome.contextMenus.create({
					title: contextMenu.title,
					contexts: ['action'],
					id: contextMenu.id,
				}, resolve);
			});
		});
	}, new Promise(resolve => chrome.contextMenus.removeAll(resolve)));
});

chrome.contextMenus.onClicked.addListener(info => {
	const contextMenu = ContextMenus.find(({id}) => id === info.menuItemId);
	if (contextMenu) contextMenu.onClicked();
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
