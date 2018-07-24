var initDone = false;
var existingTabs = new Array();
var tabBadgeMap = new Array();
var ruleList = [];
function onStartBackground() {
    updateDbIfNeeded(createRuleTable);
}
function createRuleTable() {
    console.log("createRuleTable");
    RulePeer.getInstance().createTable(createWordTable);
}
function createWordTable() {
    WordPeer.getInstance().createTable(loadLists);
}
function loadLists() {
    RulePeer.getInstance().select('', onRuleListLoaded, null);
}
function onRuleListLoaded(list) {
    var count = '' + list.length;
    Analytics.trackEvent('loadRuleList', count);
    ruleList = list;
    WordPeer.getInstance().select('', onWordListLoaded, null);
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
function onWordListLoaded(wordList) {
    var count = '' + wordList.length;
    Analytics.trackEvent('loadWordList', count);
    var ruleMap = new Array();
    for (var i = 0, l = ruleList.length; i < l; i++) {
        ruleMap[ruleList[i].rule_id] = ruleList[i];
    }
    for (var i_1 = 0, l_1 = wordList.length; i_1 < l_1; i_1++) {
        var rule = ruleMap[wordList[i_1].rule_id];
        if (rule) {
            rule.words.push(wordList[i_1]);
        }
    }
    loadSmartRuleEditorSrc();
    saveUuidIfNotSet();
}
function saveUuidIfNotSet() {
    for (var i = 0; i < ruleList.length; i++) {
        var rule = ruleList[i];
        var needSave = false;
        if (CustomBlockerUtil.isEmpty(rule.user_identifier)) {
            needSave = true;
            rule.user_identifier = UUID.generate();
        }
        if (CustomBlockerUtil.isEmpty(rule.global_identifier)) {
            needSave = true;
            rule.global_identifier = UUID.generate();
        }
        if (needSave) {
            RulePeer.getInstance().saveObject(rule, function (obj) {
                var bgWindow = chrome.extension.getBackgroundPage();
                bgWindow.reloadLists();
            }, function () { });
        }
    }
}
function reloadLists() {
    loadLists();
}
function openRulePicker(selectedRule) {
    var status = (selectedRule) ? 'edit' : 'create';
    Analytics.trackEvent('openRulePicker', status);
    try {
        chrome.tabs.getSelected(null, function (tab) {
            chrome.tabs.sendRequest(tab.id, {
                command: 'ruleEditor',
                rule: selectedRule,
                appliedRuleList: appliedRuleMap[tab.id]
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
var tabOnUpdate = function (tabId, changeInfo, tab) {
    addToExistingTabList(tabId);
    var isDisabled = ('true' == localStorage.blockDisabled);
    _setIconDisabled(isDisabled, tabId);
    if (isDisabled) {
        return;
    }
    var url = tab.url;
    if (isValidURL(url)) {
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
        console.log("Foreground message received.");
        console.log(param);
        if (!param)
            return;
        var useCallback = false;
        switch (param.command) {
            case 'badge':
                execCallbackBadge(tabId, param);
                break;
            case 'setApplied':
                execCallbackSetApplied(tabId, param);
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
    };
}
;
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
            Analytics.trackEvent('save', 'save');
            var rule = param.obj;
            var saveRuleTask = new SaveRuleTask(rule, reloadLists, tabId);
            saveRuleTask.exec(param.nextAction);
        }
    }
    catch (e) {
        console.log(e);
    }
}
function execCallbackSetApplied(tabId, param) {
    var list = param.list || new Array();
    try {
        chrome.browserAction.setIcon({
            path: ((list.length > 0) ? 'icon.png' : 'icon_disabled.png'),
            tabId: tabId
        });
    }
    catch (ex) {
        console.log(ex);
    }
    appliedRuleMap[tabId] = list;
}
;
function execCallbackBadge(tabId, param) {
    console.log("execCallbackBadge param=");
    console.log(param);
    var count = param.count;
    try {
        chrome.tabs.sendRequest(tabId, {
            command: (param.nextAction)
        }, getForegroundCallback(tabId));
        var badgeText = '' + count;
        tabBadgeMap[tabId] = badgeText;
        if (localStorage.badgeDisabled != "true") {
            chrome.browserAction.setBadgeText({
                text: badgeText,
                tabId: tabId
            });
        }
        chrome.browserAction.setTitle({
            title: getBadgeTooltipString(count),
            tabId: tabId
        });
        appliedRuleMap[tabId] = param.rules;
    }
    catch (ex) {
        console.log(ex);
    }
}
function getAppliedRules(callback) {
    chrome.tabs.getSelected(null, function (tab) {
        try {
            callback(appliedRuleMap[tab.id]);
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
var SaveRuleTask = (function () {
    function SaveRuleTask(rule, reloadLists, tabId) {
        var saveWords = [];
        var deleteWords = [];
        for (var i = 0, l = rule.words.length; i < l; i++) {
            var word = rule.words[i];
            if (word.isNew) {
                saveWords.push(word);
            }
            else if (word.deleted) {
                deleteWords.push(word);
            }
        }
        this.rule = rule;
        this.tabId = tabId;
        this.saveWords = saveWords;
        this.deleteWords = deleteWords;
        this.reloadLists = reloadLists;
    }
    SaveRuleTask.prototype.exec = function (nextAction) {
        RulePeer.getInstance().saveObject(this.rule, this.getNextTask(nextAction), function () { });
    };
    SaveRuleTask.prototype.getNextTask = function (nextAction) {
        var self = this;
        return function () {
            var nextSaveWord = self.getNextSaveWord();
            if (nextSaveWord) {
                WordPeer.getInstance().saveObject(nextSaveWord, self.getNextTask(nextAction), function () { });
                return;
            }
            var nextDeleteWord = self.getNextDeleteWord();
            if (nextDeleteWord) {
                WordPeer.getInstance().deleteObject(nextDeleteWord, self.getNextTask(nextAction), function () { });
                return;
            }
            chrome.tabs.sendRequest(self.tabId, {
                command: nextAction,
                rules: ruleList,
                tabId: self.tabId,
                rule: self.rule
            }, getForegroundCallback(self.tabId));
            self.reloadLists();
        };
    };
    SaveRuleTask.prototype.getNextSaveWord = function () {
        for (var i = 0, l = this.saveWords.length; i < l; i++) {
            var word = this.saveWords[i];
            if (word.dirty) {
                word.rule_id = this.rule.rule_id;
                return word;
            }
        }
        return null;
    };
    SaveRuleTask.prototype.getNextDeleteWord = function () {
        for (var i = 0, l = this.deleteWords.length; i < l; i++) {
            var word = this.deleteWords[i];
            if (word.dirty) {
                word.rule_id = this.rule.rule_id;
                return word;
            }
        }
    };
    return SaveRuleTask;
}());
var appliedRuleMap = new Array();
{
    chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
        removeFromExistingTabList(tabId);
        appliedRuleMap[tabId] = null;
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
                var applied = appliedRuleMap[tabId]
                    && appliedRuleMap[tabId].length > 0;
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
onStartBackground();
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
    chrome.tabs.sendRequest(tab.id, {
        command: 'quickRuleCreation',
        src: smartRuleEditorSrc,
        appliedRuleList: appliedRuleMap[tab.id],
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
//# sourceMappingURL=background.js.map