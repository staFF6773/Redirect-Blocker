const extTabs = [];
let keepAlive;
const builtInURLs = ["https://google.com/", "chrome://", "chrome-extension://"];
let allowedURLs = [...builtInURLs];
const defaultSettings = {
    tabExclusive: false,
    preventURLChange: false,
    savedURLs: ["https://soap2day.day/", "https://vipleague.im/"],
    allowedURLs: ["https://youtube.com/@Tyson3101"],
    shortCut: ["alt", "shift", "s"],
};
let settings = defaultSettings;
chrome.tabs.onCreated.addListener(async (tab) => {
    const extTab = extTabs.find((t) => t.active && t.windowId === tab.windowId);
    if (!extTab)
        return;
    let createdTabActive = tab.active;
    if (extTab.windowId === tab.windowId) {
        await chrome.tabs.update(extTab.id, { active: true }).catch(() => null);
        let intMs = 0;
        let urlPropertiesInterval = setInterval(async () => {
            const updatedTab = await chrome.tabs.get(tab.id).catch(() => null);
            if (!updatedTab)
                return clearInterval(urlPropertiesInterval);
            intMs += 20;
            if (updatedTab.url || updatedTab.pendingUrl) {
                clearInterval(urlPropertiesInterval);
                checkRedirect(updatedTab).catch(() => null);
            }
            else if (intMs >= 1000) {
                return clearInterval(urlPropertiesInterval);
            }
        }, 20);
    }
    async function checkRedirect(tab) {
        const combinedURLs = [
            ...allowedURLs,
            ...settings.savedURLs,
            new URL(extTab.url).origin,
        ];
        if (urlCheck(combinedURLs, tab.pendingUrl || tab.url)) {
            if (createdTabActive) {
                return await chrome.tabs
                    .update(tab.id, { active: true })
                    .catch(() => null);
            }
        }
        else
            await chrome.tabs.remove(tab.id).catch(() => null);
    }
});
chrome.tabs.onUpdated.addListener(async (tabId, _changeInfo, tab) => {
    let extTab = extTabs.find((t) => t.id === tabId);
    if (urlCheck(settings.savedURLs, tab.url)) {
        if (!extTab)
            return (extTab = (await modifyExtTab(tab, false, true)));
    }
    if (urlCheck([...settings.savedURLs, ...allowedURLs], tab.url)) {
        if (extTab) {
            if (new URL(extTab.url).origin !== new URL(tab.url).origin) {
                if (!settings.tabExclusive)
                    return removeExtTab(extTab);
            }
            return modifyExtTab(tab, extTab);
        }
    }
    if (!extTab || !tab.url)
        return;
    if (new URL(extTab.url).origin !== new URL(tab.url).origin) {
        const url = new URL(tab.url);
        if (new URL(extTab.url).hostname !== url.origin) {
            if (settings.preventURLChange) {
                return chrome.tabs.update(tabId, { url: extTab.url }).catch(() => null);
            }
            else {
                if (!settings.tabExclusive) {
                    return removeExtTab(extTab);
                }
            }
        }
    }
    if (extTab)
        modifyExtTab(tab, extTab);
});
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
    if (!tab)
        return;
    for (let extTab of extTabs) {
        if (extTab.id === tab.id) {
            modifyExtTab(tab, extTab);
            continue;
        }
        if (extTab.active && extTab.windowId === tab.windowId) {
            const extChromeTab = await chrome.tabs.get(extTab.id).catch(() => null);
            if (!extChromeTab)
                return removeExtTab(extTab);
            modifyExtTab(extChromeTab, extTab);
            continue;
        }
    }
});
chrome.windows.onCreated.addListener(async (window) => {
    const extTab = extTabs.find((t) => t.active && t.windowActive);
    if (!extTab || window.incognito)
        return;
    const popupTab = (await chrome.tabs.query({ windowId: window.id }).catch(() => null))?.[0];
    if (window.type === "popup" && popupTab) {
        const combinedURLs = [
            ...allowedURLs,
            ...settings.savedURLs,
            new URL(extTab.url).origin,
        ];
        if (!urlCheck(combinedURLs, popupTab.pendingUrl || popupTab.url)) {
            chrome.windows.remove(window.id).catch(() => null);
        }
    }
});
async function tabMoved(tabId) {
    const extTab = extTabs.find((t) => t.id === tabId);
    if (!extTab)
        return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    modifyExtTab(tab, extTab);
}
chrome.tabs.onAttached.addListener(tabMoved);
chrome.tabs.onDetached.addListener(tabMoved);
chrome.tabs.onRemoved.addListener((tabId) => {
    const extTab = extTabs.find((t) => t.id === tabId);
    if (!extTab)
        return;
    removeExtTab(extTab);
});
async function modifyExtTab(tab, update, instantSave) {
    if (!tab)
        return;
    if (Array.isArray(tab)) {
        extTabs.splice(0, extTabs.length, ...tab);
        save();
        return extTabs;
    }
    let extTabIndex = extTabs.findIndex((t) => t.id === tab.id);
    let extTab = extTabs[extTabIndex];
    if (extTabIndex >= 0 && !update)
        return extTabs[extTabIndex];
    if (update) {
        extTabs[extTabIndex] = {
            ...extTabs[extTabIndex],
            ...update,
            url: tab.url,
            active: tab.active,
            windowId: tab.windowId,
            windowActive: tab.windowId === (await getCurrentWindowId()),
        };
        save();
        return extTabs[extTabIndex];
    }
    else {
        extTab = {
            id: tab.id,
            windowId: tab.windowId,
            url: tab.url,
            active: tab.active,
            windowActive: tab.windowId === (await getCurrentWindowId()),
        };
        extTabs.push(extTab);
        save();
        return extTab;
    }
    function save() {
        if (instantSave)
            filterAndSave();
        else
            saveExtensionTabsToStorage();
    }
}
function removeExtTab(extTab, instantSave) {
    const extTabIndex = extTabs.findIndex((t) => t.id === extTab.id);
    if (extTabIndex < 0)
        return;
    extTabs.splice(extTabIndex, 1);
    if (instantSave)
        filterAndSave();
    else
        saveExtensionTabsToStorage();
}
function filterAndSave() {
    const extTabsSet = [...new Set(extTabs.map((t) => t.id))].map((id) => extTabs.find((t) => t.id === id));
    extTabs.splice(0, extTabs.length, ...extTabsSet);
    chrome.storage.local.set({ extensionTabs: extTabs });
}
let saveExtensionTabsToStorage = debounce(() => {
    filterAndSave();
    if (!extTabs.length) {
        if (keepAlive)
            clearInterval(keepAlive);
        keepAlive = null;
        return;
    }
    if (!keepAlive)
        persistServiceWorker();
}, 5000);
async function getCurrentWindowId() {
    const window = await chrome.windows.getCurrent();
    return window.id;
}
function persistServiceWorker() {
    if (keepAlive)
        clearInterval(keepAlive);
    keepAlive = setInterval(() => {
        chrome.tabs.query({}, (tabs) => {
            console.log(`${extTabs.length}/${tabs.length} TABS HAVE EXTENSION TURNED ON.`);
        });
    }, 1000 * 25);
}
function urlCheck(urls, url) {
    if (!url)
        return false;
    const normalizeUrl = (url) => url
        .replace(/^https?:\/\/(www\.)?(ww\d+\.)?/, "https://")
        .replace(/\/([^?]+).*$/, "/$1")
        .replace(/\/$/, "")
        .toLowerCase();
    const normalizedUrl = normalizeUrl(url);
    for (const currentUrl of urls) {
        const normalizedCurrentUrl = normalizeUrl(currentUrl);
        if (normalizedUrl === normalizedCurrentUrl ||
            normalizedUrl.startsWith(normalizedCurrentUrl + "/")) {
            return true;
        }
    }
    return false;
}
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
chrome.storage.onChanged.addListener((changes) => {
    const newSettings = changes.settings?.newValue;
    if (newSettings) {
        allowedURLs = [...newSettings.allowedURLs, ...builtInURLs];
        settings = changes.settings.newValue;
    }
    if (changes.extensionTabs?.newValue) {
        modifyExtTab(changes.extensionTabs.newValue);
    }
});
chrome.runtime.onMessage.addListener(async (message) => {
    if (message.toggle === true) {
        const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))?.[0];
        if (!tab)
            return;
        const extTab = extTabs.find((t) => t.id === tab.id);
        if (extTab) {
            removeExtTab(extTab, true);
        }
        else {
            modifyExtTab(tab, false, true);
        }
    }
});
(function init() {
    chrome.storage.sync.get("settings", (res) => {
        let savedSettings = res.settings;
        if (!savedSettings) {
            savedSettings = defaultSettings;
            chrome.storage.sync.set({ settings: defaultSettings });
        }
        allowedURLs = [...savedSettings.allowedURLs, ...builtInURLs];
        settings = savedSettings;
    });
    chrome.storage.local.get("extensionTabs", (res) => {
        if (!res.extensionTabs) {
            chrome.storage.local.set({ extensionTabs: [] });
        }
        modifyExtTab(res.extensionTabs);
    });
})();
