var initDone = false;
var existingTabs = new Array();
var tabBadgeMap = new Array();
var ruleList = [];
function onStartBackground() {
    updateDbIfNeeded(createRuleTable);
}
function removeFromExistingTabList(tabIdToRemove) {
    for (var id in existingTabs) {
        if (tabIdToRemove == id)
            existingTabs[id] = null;
    }
}
function addToExistingTabList(tabIdToAdd) {
    existingTabs[tabIdToAdd] = true;
}
function reloadLists() {
    loadLists();
}
function openRulePicker(selectedRule) {
    var status = (selectedRule) ? 'edit' : 'create';
    Analytics.trackEvent('openRulePicker', status);
    try {
        chrome.tabs.getSelected(null, function (tab) {
            var tabInfo = tabMap[tab.id];
            var appliedRules = (tabInfo) ? tabInfo.appliedRules : [];
            chrome.tabs.sendRequest(tab.id, {
                command: 'ruleEditor',
                rule: selectedRule,
                appliedRuleList: appliedRules
            }, getForegroundCallback(tab.id));
        });
    }
    catch (ex) {
        console.log(ex);
    }
}
chrome.extension.onRequest.addListener(function (request, sender) {
    if (request.command == "requestRules") {
        tabOnUpdate(sender.tab.id, null, sender.tab);
    }
});
var CustomBlockerTab = (function () {
    function CustomBlockerTab(tabId, tab) {
        this.tabId = tab.id;
        this.url = tab.url;
        this.appliedRules = [];
        this.port = chrome.tabs.connect(tabId, {});
        var self = this;
        this.port.onMessage.addListener(function (msg) {
            self.onMessage(msg);
        });
    }
    CustomBlockerTab.prototype.execCallbackReload = function (param) {
        this.port.postMessage({ rules: ruleList });
    };
    CustomBlockerTab.prototype.execCallbackDb = function (param) {
        console.log("TODO execCallbackDb");
    };
    CustomBlockerTab.prototype.execCallbackSetApplied = function (param) {
        this.appliedRules = param.list;
        try {
            chrome.browserAction.setIcon({
                path: ((this.appliedRules.length > 0) ? 'icon.png' : 'icon_disabled.png'),
                tabId: this.tabId
            });
        }
        catch (ex) {
            console.log(ex);
        }
    };
    CustomBlockerTab.prototype.execCallbackBadge = function (param) {
        var count = param.count;
        try {
            var badgeText = '' + count;
            tabBadgeMap[this.tabId] = badgeText;
            if (localStorage.badgeDisabled != "true") {
                chrome.browserAction.setBadgeText({
                    text: badgeText,
                    tabId: this.tabId
                });
            }
            chrome.browserAction.setTitle({
                title: getBadgeTooltipString(count),
                tabId: this.tabId
            });
            this.appliedRules = param.rules;
        }
        catch (ex) {
            console.log(ex);
        }
    };
    CustomBlockerTab.prototype.onMessage = function (message) {
        console.log("onMessage");
        console.log(message);
        switch (message.command) {
            case 'badge':
                this.execCallbackBadge(message.param);
                break;
            case 'setApplied':
                this.execCallbackSetApplied(message.param);
                break;
            case 'db':
                this.execCallbackDb(message.param);
                break;
            case 'reload':
                this.execCallbackReload(message.param);
                break;
        }
    };
    return CustomBlockerTab;
}());
var tabMap = {};
var tabOnUpdate = function (tabId, changeInfo, tab) {
    addToExistingTabList(tabId);
    var isDisabled = ('true' == localStorage.blockDisabled);
    _setIconDisabled(isDisabled, tabId);
    if (isDisabled) {
        return;
    }
    var url = tab.url;
    if (isValidURL(url)) {
        tabMap[tabId] = new CustomBlockerTab(tabId, tab);
        chrome.tabs.sendRequest(tabId, {
            command: 'init',
            rules: ruleList,
            tabId: tabId
        }, getForegroundCallback(tabId));
    }
};
var VALID_URL_REGEX = new RegExp('^https?:');
function isValidURL(url) {
    return url != null && VALID_URL_REGEX.test(url);
}
function getForegroundCallback(tabId) {
    return function (param) {
    };
}
;
function handleForegroundMessage(tabId, param) {
    console.log("Foreground message received.");
    console.log(param);
    if (!param)
        return;
    var useCallback = false;
    switch (param.command) {
        case 'badge':
            break;
        case 'setApplied':
            break;
        case 'db':
            useCallback = true;
            execCallbackDb(tabId, param);
            break;
        case 'reload':
            useCallback = true;
            execCallbackReload(tabId, param);
            break;
    }
    if (!useCallback) {
        chrome.tabs.sendRequest(tabId, {
            command: (param.nextAction || 'badge')
        }, getForegroundCallback(tabId));
    }
}
function execCallbackReload(tabId, param) {
    chrome.tabs.sendRequest(tabId, {
        command: (param.nextAction),
        rules: ruleList
    }, getForegroundCallback(tabId));
}
function execCallbackDb(tabId, param) {
    try {
        var exPeer;
        if ('save' == param.dbCommand) {
            console.log("WARNING:execCallbackDb.save called.");
            Analytics.trackEvent('save', 'save');
            var rule_1 = param.obj;
            rule_1.save(function () {
                chrome.tabs.sendRequest(tabId, {
                    command: param.nextAction,
                    rules: ruleList,
                    tabId: tabId,
                    rule: rule_1
                }, getForegroundCallback(tabId));
                reloadLists();
            });
        }
    }
    catch (e) {
        console.log(e);
    }
}
function getAppliedRules(callback) {
    chrome.tabs.getSelected(null, function (tab) {
        try {
            var appliedRules = (tabMap[tab.id]) ? tabMap[tab.id].appliedRules : [];
            callback(appliedRules);
        }
        catch (ex) {
            console.log(ex);
        }
    });
}
var smartRuleEditorSrc = '';
function loadSmartRuleEditorSrc() {
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if (xhr.readyState == 4) {
            if (xhr.status == 0 || xhr.status == 200) {
                smartRuleEditorSrc = xhr.responseText;
            }
        }
    };
    xhr.open("GET", chrome.extension.getURL('/smart_rule_editor_' + chrome.i18n.getMessage("extLocale") + '.html'), true);
    xhr.send();
}
{
    chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
        removeFromExistingTabList(tabId);
        tabMap[tabId] = null;
    });
    chrome.tabs.onSelectionChanged.addListener(function (_tabId, selectInfo) {
        var tabId = _tabId;
        for (var _index in existingTabs) {
            var tabIdToDisable = parseInt(_index);
            if (tabIdToDisable && tabIdToDisable != tabId) {
                chrome.tabs.sendRequest(tabIdToDisable, {
                    command: 'stop'
                }, getForegroundCallback(tabIdToDisable));
            }
        }
        try {
            if ('true' == localStorage.blockDisabled)
                _setIconDisabled(!applied, tabId);
            else {
                var appliedRules = (tabMap[tabId]) ? tabMap[tabId].appliedRules : [];
                var applied = appliedRules.length > 0;
                chrome.browserAction.setIcon({
                    path: (applied) ? 'icon.png' : 'icon_disabled.png',
                    tabId: tabId
                });
            }
            chrome.tabs.sendRequest(tabId, {
                command: 'resume'
            }, getForegroundCallback(tabId));
            if (tabBadgeMap[tabId]) {
                if (localStorage.badgeDisabled != "true") {
                    chrome.browserAction.setBadgeText({
                        text: tabBadgeMap[tabId],
                        tabId: tabId
                    });
                }
            }
        }
        catch (ex) {
            console.log(ex);
        }
    });
}
function setIconDisabled(isDisabled) {
    chrome.tabs.getSelected(null, function (tab) {
        _setIconDisabled(isDisabled, tab.id);
    });
}
function _setIconDisabled(isDisabled, tabId) {
    if (localStorage.badgeDisabled != "true") {
        chrome.browserAction.setBadgeText({
            text: (isDisabled) ? 'OFF' : '',
            tabId: tabId
        });
    }
    chrome.browserAction.setIcon({
        path: (isDisabled) ? 'icon_disabled.png' : 'icon.png',
        tabId: tabId
    });
}
function highlightRuleElements(rule) {
    chrome.tabs.getSelected(null, function (tab) {
        chrome.tabs.sendRequest(tab.id, {
            command: 'highlight',
            rule: rule
        }, getForegroundCallback(tab.id));
    });
}
function getBadgeTooltipString(count) {
    if (count > 1)
        return chrome.i18n.getMessage("tooltipCount").replace("__count__", count);
    else
        return chrome.i18n.getMessage("tooltipCountSingle");
}
function menuCreateOnRightClick(clicked, tab) {
    sendQuickRuleCreationRequest(clicked, tab, true);
    Analytics.trackEvent('contextMenu', 'create');
}
;
function menuAddOnRightClick(clicked, tab) {
    sendQuickRuleCreationRequest(clicked, tab, false);
    Analytics.trackEvent('contextMenu', 'add');
}
;
function sendQuickRuleCreationRequest(clicked, tab, needSuggestion) {
    var appliedRules = (tabMap[tab.id]) ? tabMap[tab.id].appliedRules : [];
    chrome.tabs.sendRequest(tab.id, {
        command: 'quickRuleCreation',
        src: smartRuleEditorSrc,
        appliedRuleList: appliedRules,
        selectionText: clicked.selectionText,
        needSuggestion: needSuggestion
    }, getForegroundCallback(tab.id));
}
;
var menuIdCreate = chrome.contextMenus.create({ "title": chrome.i18n.getMessage('menuCreateRule'), "contexts": ["selection"],
    "onclick": menuCreateOnRightClick });
var menuIdAdd = chrome.contextMenus.create({ "title": chrome.i18n.getMessage('menuAddToExistingRule'), "contexts": ["selection"],
    "onclick": menuAddOnRightClick });
chrome.runtime.onInstalled.addListener(function (details) {
    console.log("reason=" + details.reason);
    console.log("previousVersion=" + details.previousVersion);
    if ("install" == details.reason) {
        console.log("New install.");
        window.open(chrome.extension.getURL('/welcome_install_' + chrome.i18n.getMessage("extLocale") + '.html?install'));
    }
    else if (details.reason == "update" && details.previousVersion && details.previousVersion.match(/^2\.3\./)) {
        window.open(chrome.extension.getURL('/welcome_' + chrome.i18n.getMessage("extLocale") + '.html'));
    }
});
window.onload = function () {
    onStartBackground();
};
chrome.storage.onChanged.addListener(function (changes, namespace) {
    for (var key in changes) {
        var storageChange = changes[key];
        console.log('Storage key "%s" in namespace "%s" changed. ' +
            'Old value was "%s", new value is "%s".', key, namespace, storageChange.oldValue, storageChange.newValue);
    }
});
//# sourceMappingURL=background.js.map