/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* global chrome, µBlock, punycode, publicSuffixList */

/******************************************************************************/

µBlock.getBytesInUse = function() {
    var getBytesInUseHandler = function(bytesInUse) {
        µBlock.storageUsed = bytesInUse;
    };
    chrome.storage.local.getBytesInUse(null, getBytesInUseHandler);
};

/******************************************************************************/

µBlock.saveLocalSettings = function() {
    chrome.storage.local.set(this.localSettings, function() {
        µBlock.getBytesInUse();
    });
};

/******************************************************************************/

µBlock.loadLocalSettings = function() {
    var settingsLoaded = function(store) {
        µBlock.localSettings = store;
    };

    chrome.storage.local.get(this.localSettings, settingsLoaded);
};

/******************************************************************************/

// Save local settings regularly. Not critical.

µBlock.asyncJobs.add(
    'autoSaveLocalSettings',
    null,
    µBlock.saveLocalSettings.bind(µBlock),
    2 * 60 * 1000,
    true
);

/******************************************************************************/

µBlock.saveUserSettings = function() {
    chrome.storage.local.set(this.userSettings, function() {
        µBlock.getBytesInUse();
    });
};

/******************************************************************************/

µBlock.loadUserSettings = function(callback) {
    var settingsLoaded = function(store) {
        µBlock.userSettings = store;
        if ( typeof callback === 'function' ) {
            callback();
        }
    };

    chrome.storage.local.get(this.userSettings, settingsLoaded);
};

/******************************************************************************/

µBlock.saveWhitelist = function() {
    var bin = {
        'netWhitelist': this.stringFromWhitelist(this.netWhitelist)
    };
    chrome.storage.local.set(bin, function() {
        µBlock.getBytesInUse();
    });
    this.netWhitelistModifyTime = Date.now();
};

/******************************************************************************/

µBlock.loadWhitelist = function(callback) {
    var onWhitelistLoaded = function(store) {
        var µb = µBlock;
        // Backward compatibility after fix to #5
        // TODO: remove once all users are up to date with latest version.
        if ( store.netExceptionList ) {
            if ( store.netWhitelist === '' ) {
                store.netWhitelist = Object.keys(store.netExceptionList).join('\n');
                if ( store.netWhitelist !== '' ) {
                    chrome.storage.local.set({ 'netWhitelist': store.netWhitelist });
                }
            }
            chrome.storage.local.remove('netExceptionList');
        }
        µb.netWhitelist = µb.whitelistFromString(store.netWhitelist);
        µb.netWhitelistModifyTime = Date.now();

        if ( typeof callback === 'function' ) {
            callback();
        }
    };

    var bin = {
        'netWhitelist': '',
        'netExceptionList': ''
    };
    chrome.storage.local.get(bin, onWhitelistLoaded);
};

/******************************************************************************/

µBlock.saveUserFilters = function(content, callback) {
    return this.assets.put(this.userFiltersPath, content, callback);
};

/******************************************************************************/

µBlock.loadUserFilters = function(callback) {
    return this.assets.get(this.userFiltersPath, callback);
};

/******************************************************************************/

µBlock.appendUserFilters = function(content) {
    var onSaved = function(details) {
        if ( details.error ) {
            return;
        }
        µBlock.loadUbiquitousBlacklists();
    };
    var onLoaded = function(details) {
        if ( details.error ) {
            return;
        }
        if ( details.content.indexOf(content.trim()) !== -1 ) {
            return;
        }
        µBlock.saveUserFilters(details.content + '\n' + content, onSaved);
    };
    if ( content.length > 0 ) {
        this.loadUserFilters(onLoaded);
    }
};

/******************************************************************************/

µBlock.getAvailableLists = function(callback) {
    var availableLists = {};
    var redirections = {};

    // selected lists
    var onSelectedListsLoaded = function(store) {
        var µb = µBlock;
        var lists = store.remoteBlacklists;
        var locations = Object.keys(lists);
        var oldLocation, newLocation;
        var availableEntry, storedEntry;

        while ( oldLocation = locations.pop() ) {
            newLocation = redirections[oldLocation] || oldLocation;
            availableEntry = availableLists[newLocation];
            if ( availableEntry === undefined ) {
                continue;
            }
            storedEntry = lists[oldLocation];
            availableEntry.off = storedEntry.off || false;
            µb.assets.setHomeURL(newLocation, availableEntry.homeURL);
            if ( storedEntry.entryCount !== undefined ) {
                availableEntry.entryCount = storedEntry.entryCount;
            }
            if ( storedEntry.entryUsedCount !== undefined ) {
                availableEntry.entryUsedCount = storedEntry.entryUsedCount;
            }
        }
        callback(availableLists);
    };

    // built-in lists
    var onBuiltinListsLoaded = function(details) {
        var location, locations;
        try {
            locations = JSON.parse(details.content);
        } catch (e) {
            locations = {};
        }
        var entry;
        for ( location in locations ) {
            if ( locations.hasOwnProperty(location) === false ) {
                continue;
            }
            entry = locations[location];
            availableLists['assets/thirdparties/' + location] = entry;
            if ( entry.old !== undefined ) {
                redirections[entry.old] = location;
                delete entry.old;
            }
        }

        // Now get user's selection of lists
        chrome.storage.local.get(
            { 'remoteBlacklists': availableLists },
            onSelectedListsLoaded   
        );
    };

    // permanent lists
    var location;
    var lists = this.permanentLists;
    for ( location in lists ) {
        if ( lists.hasOwnProperty(location) === false ) {
            continue;
        }
        availableLists[location] = lists[location];
    }

    // custom lists
    var c;
    var locations = this.userSettings.externalLists.split('\n');
    for ( var i = 0; i < locations.length; i++ ) {
        location = locations[i].trim();
        c = location.charAt(0);
        if ( location === '' || c === '!' || c === '#' ) {
            continue;
        }
        // Coarse validation
        if ( /[^0-9A-Za-z!*'();:@&=+$,\/?%#\[\]_.~-]/.test(location) ) {
            continue;
        }
        availableLists[location] = {
            title: '',
            group: 'custom',
            external: true
        };
    }

    // get built-in block lists.
    this.assets.get('assets/ublock/filter-lists.json', onBuiltinListsLoaded);
};

/******************************************************************************/

µBlock.loadUbiquitousBlacklists = function() {
    var µb = this;
    var blacklistLoadCount;

    var loadBlacklistsEnd = function() {
        µb.abpFilters.freeze();
        µb.abpHideFilters.freeze();
        µb.messaging.announce({ what: 'loadUbiquitousBlacklistCompleted' });
        chrome.storage.local.set({ 'remoteBlacklists': µb.remoteBlacklists });
    };

    var mergeBlacklist = function(details) {
        µb.mergeUbiquitousBlacklist(details);
        blacklistLoadCount -= 1;
        if ( blacklistLoadCount === 0 ) {
            loadBlacklistsEnd();
        }
    };

    var loadBlacklistsStart = function(lists) {
        µb.remoteBlacklists = lists;

        // rhill 2013-12-10: set all existing entries to `false`.
        µb.abpFilters.reset();
        µb.abpHideFilters.reset();
        var locations = Object.keys(lists);
        blacklistLoadCount = locations.length;
        if ( blacklistLoadCount === 0 ) {
            loadBlacklistsEnd();
            return;
        }

        // Load each preset blacklist which is not disabled.
        var location;
        while ( location = locations.pop() ) {
            // rhill 2013-12-09:
            // Ignore list if disabled
            // https://github.com/gorhill/httpswitchboard/issues/78
            if ( lists[location].off ) {
                blacklistLoadCount -= 1;
                continue;
            }
            µb.assets.get(location, mergeBlacklist);
        }
    };

    this.getAvailableLists(loadBlacklistsStart);
};

/******************************************************************************/

µBlock.mergeUbiquitousBlacklist = function(details) {
    // console.log('µBlock > mergeUbiquitousBlacklist from "%s": "%s..."', details.path, details.content.slice(0, 40));

    var rawText = details.content;
    var rawEnd = rawText.length;

    // rhill 2013-10-21: No need to prefix with '* ', the hostname is just what
    // we need for preset blacklists. The prefix '* ' is ONLY needed when
    // used as a filter in temporary blacklist.

    // rhill 2014-01-22: Transpose possible Adblock Plus-filter syntax
    // into a plain hostname if possible.
    // Useful references:
    //    https://adblockplus.org/en/filter-cheatsheet
    //    https://adblockplus.org/en/filters
    var abpFilters = this.abpFilters;
    var abpHideFilters = this.abpHideFilters;
    var parseCosmeticFilters = this.userSettings.parseAllABPHideFilters;
    var duplicateCount = abpFilters.duplicateCount + abpHideFilters.duplicateCount;
    var acceptedCount = abpFilters.acceptedCount + abpHideFilters.acceptedCount;
    var reLocalhost = /(^|\s)(localhost\.localdomain|localhost|local|broadcasthost|0\.0\.0\.0|127\.0\.0\.1|::1|fe80::1%lo0)(?=\s|$)/g;
    var reAdblockFilter = /^[^a-z0-9:]|[^a-z0-9]$|[^a-z0-9_:.-]/;
    var reAdblockHostFilter = /^\|\|([a-z0-9.-]+[a-z0-9])\^?$/;
    var reAsciiSegment = /^[\x21-\x7e]+$/;
    var matches;
    var lineBeg = 0, lineEnd, currentLineBeg;
    var line, c;

    while ( lineBeg < rawEnd ) {
        lineEnd = rawText.indexOf('\n', lineBeg);
        if ( lineEnd < 0 ) {
            lineEnd = rawText.indexOf('\r', lineBeg);
            if ( lineEnd < 0 ) {
                lineEnd = rawEnd;
            }
        }

        // rhill 2014-04-18: The trim is important here, as without it there
        // could be a lingering `\r` which would cause problems in the
        // following parsing code.
        line = rawText.slice(lineBeg, lineEnd).trim();
        currentLineBeg = lineBeg;
        lineBeg = lineEnd + 1;

        // Strip comments
        c = line.charAt(0);
        if ( c === '!' || c === '[' ) {
            continue;
        }

        // 2014-05-18: ABP element hide filters are allowed to contain space
        // characters
        if ( parseCosmeticFilters ) {
            if ( abpHideFilters.add(line) ) {
                continue;
            }
        }

        if ( c === '#' ) {
            continue;
        }

        // https://github.com/gorhill/httpswitchboard/issues/15
        // Ensure localhost et al. don't end up in the ubiquitous blacklist.
        line = line
            .replace(/\s+#.*$/, '')
            .toLowerCase()
            .replace(reLocalhost, '')
            .trim();

        // The filter is whatever sequence of printable ascii character without
        // whitespaces
        matches = reAsciiSegment.exec(line);
        if ( !matches || matches.length === 0 ) {
            continue;
        }

        // Bypass anomalies
        // For example, when a filter contains whitespace characters, or
        // whatever else outside the range of printable ascii characters.
        if ( matches[0] !== line ) {
            // console.error('"%s": "%s" !== "%s"', details.path, matches[0], line);
            continue;
        }

        line = matches[0];

        // Likely an ABP net filter?
        if ( reAdblockFilter.test(line) ) {
            if ( abpFilters.add(line) ) {
                continue;
            }
            // rhill 2014-01-22: Transpose possible Adblock Plus-filter syntax
            // into a plain hostname if possible.
            matches = reAdblockHostFilter.exec(line);
            if ( !matches || matches.length < 2 ) {
                continue;
            }
            line = matches[1];
        }

        if ( line === '' ) {
            continue;
        }

        abpFilters.addAnyPartyHostname(line);
    }

    // For convenience, store the number of entries for this
    // blacklist, user might be happy to know this information.
    duplicateCount = abpFilters.duplicateCount + abpHideFilters.duplicateCount - duplicateCount;
    acceptedCount = abpFilters.acceptedCount + abpHideFilters.acceptedCount - acceptedCount;

    this.remoteBlacklists[details.path].entryCount = acceptedCount + duplicateCount;
    this.remoteBlacklists[details.path].entryUsedCount = acceptedCount;
};

/******************************************************************************/

// `switches` contains the preset blacklists for which the switch must be
// revisited.

µBlock.reloadPresetBlacklists = function(switches, update) {
    var presetBlacklists = this.remoteBlacklists;

    // Toggle switches, if any
    if ( switches !== undefined ) {
        var i = switches.length;
        while ( i-- ) {
            if ( !presetBlacklists[switches[i].location] ) {
                continue;
            }
            presetBlacklists[switches[i].location].off = !!switches[i].off;
        }

        // Save switch states
        chrome.storage.local.set({ 'remoteBlacklists': presetBlacklists }, function() {
            µBlock.getBytesInUse();
        });
    }

    // Now force reload
    this.loadUpdatableAssets(update);
};

/******************************************************************************/

µBlock.loadPublicSuffixList = function(callback) {
    var applyPublicSuffixList = function(details) {
        // TODO: Not getting proper suffix list is a bit serious, I think
        // the extension should be force-restarted if it occurs..
        if ( !details.error ) {
            publicSuffixList.parse(details.content, punycode.toASCII);
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    };
    this.assets.get(
        'assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat',
        applyPublicSuffixList
    );
};

/******************************************************************************/

// Load updatable assets

µBlock.loadUpdatableAssets = function(update) {
    this.assets.autoUpdate = update || this.userSettings.autoUpdate;
    this.assets.autoUpdateDelay = this.updateAssetsEvery;
    this.loadPublicSuffixList();
    this.loadUbiquitousBlacklists();

    // It could be a manual update, so we reset the auto-updater
    if ( update ) {
        this.updater.restart();
    }
};

/******************************************************************************/

// Load all

µBlock.load = function() {
    var µb = this;

    // User whitelist directives and filters need the Public Suffix List to be
    // available -- because the way they are stored internally.
    var onPSLReady = function() {
        µb.loadWhitelist();
        µb.loadUbiquitousBlacklists();
    };

    // Public Suffix List loader needs the user settings need to be available
    // because we need to know whether to auto-update the list or not.
    var onUserSettingsReady = function() {
        µb.assets.autoUpdate = µb.userSettings.autoUpdate || true;
        µb.loadPublicSuffixList(onPSLReady);
    };
    this.loadUserSettings(onUserSettingsReady);

    this.loadLocalSettings();
    this.getBytesInUse();
};
