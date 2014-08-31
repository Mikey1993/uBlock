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

/* jshint esnext: true, bitwise: false */
/* global µBlock */

/******************************************************************************/

µBlock.abpFilters = (function(){

/******************************************************************************/

// fedcba9876543210
// |||   | |      |
// |||   | |      |
// |||   | |      |
// |||   | |      |
// |||   | |      +---- bit 0-3: domain bits
// |||   | +---- bit 8-7: party [0 - 3]
// |||   +---- bit 12-9: type [0 - 15]
// ||+---- bit 13: `important`
// |+---- bit 14: [BlockAction | AllowAction]
// +---- bit 15: unused (to ensure valid unicode character)

const BlockAction = 0 << 14;
const AllowAction = 1 << 14;
const ToggleAction = BlockAction ^ AllowAction;

const Important = 1 << 13;
 
const AnyType = 1 << 9;

const AnyParty = 0 << 7;
const FirstParty = 1 << 7;
const ThirdParty = 2 << 7;
const SpecificParty = 3 << 7;

const BlockAnyTypeAnyParty = BlockAction | AnyType | AnyParty;
const BlockAnyType1stParty = BlockAction | AnyType | FirstParty;
const BlockAnyType3rdParty = BlockAction | AnyType | ThirdParty;
const BlockAnyTypeOneParty = BlockAction | AnyType | SpecificParty;
const BlockAnyType = BlockAction | AnyType;
const BlockAnyParty = BlockAction | AnyParty;
const BlockOneParty = BlockAction | SpecificParty;

const AllowAnyTypeAnyParty = AllowAction | AnyType | AnyParty;
const AllowAnyType1stParty = AllowAction | AnyType | FirstParty;
const AllowAnyType3rdParty = AllowAction | AnyType | ThirdParty;
const AllowAnyTypeOneParty = AllowAction | AnyType | SpecificParty;
const AllowAnyType = AllowAction | AnyType;
const AllowAnyParty = AllowAction | AnyParty;
const AllowOneParty = AllowAction | SpecificParty;

const noDomainName = 'not-a-real-domain';

var pageHostname = '';

var reIgnoreEmpty = /^\s+$/;
var reIgnoreComment = /^\[|^!/;
var reHostnameRule = /^[0-9a-z][0-9a-z.-]+[0-9a-z]$/;
var reHostnameToken = /^[0-9a-z]+/g;
var reGoodToken = /[%0-9a-z]{2,}/g;

var typeNameToTypeValue = {
        'stylesheet': 2 << 9,
             'image': 3 << 9,
            'object': 4 << 9,
            'script': 5 << 9,
    'xmlhttprequest': 6 << 9,
         'sub_frame': 7 << 9,
             'other': 8 << 9,
             'popup': 9 << 9
};

// ABP filters: https://adblockplus.org/en/filters
// regex tester: http://regex101.com/

/******************************************************************************/
/*
var histogram = function(label, categories) {
    var h = [],
        categoryBucket;
    for ( var k in categories ) {
        if ( categories.hasOwnProperty(k) === false ) {
            continue;
        }
        categoryBucket = categories[k];
        for ( var kk in categoryBucket ) {
            if ( categoryBucket.hasOwnProperty(kk) === false ) {
                continue;
            }
            filterBucket = categoryBucket[kk];
            h.push({
                k: k + ' ' + kk,
                n: filterBucket instanceof FilterBucket ? filterBucket.filters.length : 1
            });
        }
    }

    console.log('Histogram %s', label);

    var total = h.length;
    h.sort(function(a, b) { return b.n - a.n; });

    // Find indices of entries of interest
    var target = 2;
    for ( var i = 0; i < total; i++ ) {
        if ( h[i].n === target ) {
            console.log('\tEntries with only %d filter(s) start at index %s (key = "%s")', target, i, h[i].k);
            target -= 1;
        }
    }

    h = h.slice(0, 50);

    h.forEach(function(v) {
        console.log('\tkey=%s  count=%d', v.k, v.n);
    });
    console.log('\tTotal buckets count: %d', total);
};
*/
/*******************************************************************************

Filters family tree:

- plain (no wildcard)
  - anywhere
    - no hostname
    - specific hostname
  - anchored at start
    - no hostname
    - specific hostname
  - anchored at end
    - no hostname
    - specific hostname

- one wildcard
  - anywhere
    - no hostname
    - specific hostname
  - anchored at start
    - no hostname
    - specific hostname
  - anchored at end
    - no hostname
    - specific hostname

- more than one wildcard
  - anywhere
    - no hostname
    - specific hostname
  - anchored at start
    - no hostname
    - specific hostname
  - anchored at end
    - no hostname
    - specific hostname

*/

/******************************************************************************/

var FilterPlain = function(s, tokenBeg) {
    this.s = s;
    this.tokenBeg = tokenBeg;
};

FilterPlain.prototype.match = function(url, tokenBeg) {
    return url.substr(tokenBeg - this.tokenBeg, this.s.length) === this.s;
};

FilterPlain.prototype.toString = function() {
    return this.s;
};

/******************************************************************************/

var FilterPlainHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.hostname = hostname;
};

FilterPlainHostname.prototype.match = function(url, tokenBeg) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg - this.tokenBeg, this.s.length) === this.s;
};

FilterPlainHostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

/******************************************************************************/

var FilterPlainPrefix0 = function(s) {
    this.s = s;
};

FilterPlainPrefix0.prototype.match = function(url, tokenBeg) {
    return url.substr(tokenBeg, this.s.length) === this.s;
};

FilterPlainPrefix0.prototype.toString = function() {
    return this.s;
};

/******************************************************************************/

var FilterPlainPrefix0Hostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainPrefix0Hostname.prototype.match = function(url, tokenBeg) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.s.length) === this.s;
};

FilterPlainPrefix0Hostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

/******************************************************************************/

var FilterPlainPrefix1 = function(s) {
    this.s = s;
};

FilterPlainPrefix1.prototype.match = function(url, tokenBeg) {
    return url.substr(tokenBeg - 1, this.s.length) === this.s;
};

FilterPlainPrefix1.prototype.toString = function() {
    return this.s;
};

/******************************************************************************/

var FilterPlainPrefix1Hostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainPrefix1Hostname.prototype.match = function(url, tokenBeg) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg - 1, this.s.length) === this.s;
};

FilterPlainPrefix1Hostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

/******************************************************************************/

var FilterPlainLeftAnchored = function(s) {
    this.s = s;
};

FilterPlainLeftAnchored.prototype.match = function(url) {
    return url.slice(0, this.s.length) === this.s;
};

FilterPlainLeftAnchored.prototype.toString = function() {
    return '|' + this.s;
};

/******************************************************************************/

var FilterPlainLeftAnchoredHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainLeftAnchoredHostname.prototype.match = function(url) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(0, this.s.length) === this.s;
};

FilterPlainLeftAnchoredHostname.prototype.toString = function() {
    return '|' + this.s + '$domain=' + this.hostname;
};

/******************************************************************************/

var FilterPlainRightAnchored = function(s) {
    this.s = s;
};

FilterPlainRightAnchored.prototype.match = function(url) {
    return url.slice(-this.s.length) === this.s;
};

FilterPlainRightAnchored.prototype.toString = function() {
    return this.s + '|';
};

/******************************************************************************/

var FilterPlainRightAnchoredHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainRightAnchoredHostname.prototype.match = function(url) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(-this.s.length) === this.s;
};

FilterPlainRightAnchoredHostname.prototype.toString = function() {
    return this.s + '|$domain=' + this.hostname;
};

/******************************************************************************/

// With a single wildcard, regex is not optimal.
// See:
//   http://jsperf.com/regexp-vs-indexof-abp-miss/3
//   http://jsperf.com/regexp-vs-indexof-abp-hit/3

var FilterSingleWildcard = function(s, tokenBeg) {
    this.tokenBeg = tokenBeg;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
};

FilterSingleWildcard.prototype.match = function(url, tokenBeg) {
    tokenBeg -= this.tokenBeg;
    return url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

FilterSingleWildcard.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment;
};

/******************************************************************************/

var FilterSingleWildcardHostname = function(s, tokenBeg, hostname) {
    this.tokenBeg = tokenBeg;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardHostname.prototype.match = function(url, tokenBeg) {
    tokenBeg -= this.tokenBeg;
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

FilterSingleWildcardHostname.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment + '$domain=' + this.hostname;
};

/******************************************************************************/

var FilterSingleWildcardPrefix0 = function(s) {
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
};

FilterSingleWildcardPrefix0.prototype.match = function(url, tokenBeg) {
    return url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

FilterSingleWildcardPrefix0.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment;
};

/******************************************************************************/

var FilterSingleWildcardPrefix0Hostname = function(s, hostname) {
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardPrefix0Hostname.prototype.match = function(url, tokenBeg) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

FilterSingleWildcardPrefix0Hostname.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment + '$domain=' + this.hostname;
};

/******************************************************************************/

// With a single wildcard, regex is not optimal.
// See:
//   http://jsperf.com/regexp-vs-indexof-abp-miss/3
//   http://jsperf.com/regexp-vs-indexof-abp-hit/3

var FilterSingleWildcardLeftAnchored = function(s) {
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
};

FilterSingleWildcardLeftAnchored.prototype.match = function(url) {
    return url.slice(0, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, this.lSegment.length) > 0;
};

FilterSingleWildcardLeftAnchored.prototype.toString = function() {
    return '|' + this.lSegment + '*' + this.rSegment;
};

/******************************************************************************/

var FilterSingleWildcardLeftAnchoredHostname = function(s, hostname) {
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardLeftAnchoredHostname.prototype.match = function(url) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(0, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, this.lSegment.length) > 0;
};

FilterSingleWildcardLeftAnchoredHostname.prototype.toString = function() {
    return '|' + this.lSegment + '*' + this.rSegment + '$domain=' + this.hostname;
};

/******************************************************************************/

// With a single wildcard, regex is not optimal.
// See:
//   http://jsperf.com/regexp-vs-indexof-abp-miss/3
//   http://jsperf.com/regexp-vs-indexof-abp-hit/3

var FilterSingleWildcardRightAnchored = function(s) {
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
};

FilterSingleWildcardRightAnchored.prototype.match = function(url) {
    return url.slice(-this.rSegment.length) === this.rSegment &&
           url.lastIndexOf(this.lSegment, url.length - this.rSegment.length - this.lSegment.length) >= 0;
};

FilterSingleWildcardRightAnchored.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment + '|';
};

/******************************************************************************/

var FilterSingleWildcardRightAnchoredHostname = function(s, hostname) {
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardRightAnchoredHostname.prototype.match = function(url) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(-this.rSegment.length) === this.rSegment &&
           url.lastIndexOf(this.lSegment, url.length - this.rSegment.length - this.lSegment.length) >= 0;
};

FilterSingleWildcardRightAnchoredHostname.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment + '|$domain=' + this.hostname;
};

/******************************************************************************/

// With many wildcards, a regex is best.

// Ref: regex escaper taken from:
// https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
// modified for the purpose here.

var FilterManyWildcards = function(s, tokenBeg) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.re = new RegExp('^' + s.replace(/([.+?^=!:${}()|\[\]\/\\])/g, '\\$1').replace(/\*/g, '.*'));
};

FilterManyWildcards.prototype.match = function(url, tokenBeg) {
    return this.re.test(url.slice(tokenBeg - this.tokenBeg));
};

FilterManyWildcards.prototype.toString = function() {
    return this.s;
};

/******************************************************************************/

var FilterManyWildcardsHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.re = new RegExp('^' + s.replace(/([.+?^=!:${}()|\[\]\/\\])/g, '\\$1').replace(/\*/g, '.*'));
    this.hostname = hostname;
};

FilterManyWildcardsHostname.prototype.match = function(url, tokenBeg) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           this.re.test(url.slice(tokenBeg - this.tokenBeg));
};

FilterManyWildcardsHostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

/******************************************************************************/

var makeFilter = function(details, tokenBeg) {
    var s = details.f;
    var wcOffset = s.indexOf('*');
    if ( wcOffset > 0 ) {
        if ( (/\*[^*]\*/).test(s) ) {
            return details.anchor === 0 ? new FilterManyWildcards(s, tokenBeg) : null;
        }
        if ( details.anchor < 0 ) {
            return new FilterSingleWildcardLeftAnchored(s);
        }
        if ( details.anchor > 0 ) {
            return new FilterSingleWildcardRightAnchored(s);
        }
        if ( tokenBeg === 0 ) {
            return new FilterSingleWildcardPrefix0(s);
        }
        return new FilterSingleWildcard(s, tokenBeg);
    }
    if ( details.anchor < 0 ) {
        return new FilterPlainLeftAnchored(s);
    }
    if ( details.anchor > 0 ) {
        return new FilterPlainRightAnchored(s);
    }
    if ( tokenBeg === 0 ) {
        return new FilterPlainPrefix0(s);
    }
    if ( tokenBeg === 1 ) {
        return new FilterPlainPrefix1(s);
    }
    return new FilterPlain(s, tokenBeg);
};

/******************************************************************************/

var makeHostnameFilter = function(details, tokenBeg, hostname) {
    var s = details.f;
    var wcOffset = s.indexOf('*');
    if ( wcOffset > 0 ) {
        if ( (/\*[^*]\*/).test(s) ) {
            return details.anchor === 0 ? new FilterManyWildcardsHostname(s, tokenBeg, hostname) : null;
        }
        if ( details.anchor < 0 ) {
            return new FilterSingleWildcardLeftAnchoredHostname(s, hostname);
        }
        if ( details.anchor > 0 ) {
            return new FilterSingleWildcardRightAnchoredHostname(s, hostname);
        }
        if ( tokenBeg === 0 ) {
            return new FilterSingleWildcardPrefix0Hostname(s, hostname);
        }
        return new FilterSingleWildcardHostname(s, tokenBeg, hostname);
    }
    if ( details.anchor < 0 ) {
        return new FilterPlainLeftAnchoredHostname(s, hostname);
    }
    if ( details.anchor > 0 ) {
        return new FilterPlainRightAnchoredHostname(s, hostname);
    }
    if ( tokenBeg === 0 ) {
        return new FilterPlainPrefix0Hostname(s, hostname);
    }
    if ( tokenBeg === 1 ) {
        return new FilterPlainPrefix1Hostname(s, hostname);
    }
    return new FilterPlainHostname(s, tokenBeg, hostname);
};

/******************************************************************************/

// Given a string, find a good token. Tokens which are too generic, i.e. very
// common with a high probability of ending up as a miss, are not
// good. Avoid if possible. This has a *significant* positive impact on
// performance.
// These "bad tokens" are collated manually.

var badTokens = {
    'com': true,
    'http': true,
    'https': true,
    'images': true,
    'img': true,
    'js': true,
    'net': true,
    'news': true,
    'www': true
};

var findFirstGoodToken = function(s) {
    reGoodToken.lastIndex = 0;
    var matches;
    while ( matches = reGoodToken.exec(s) ) {
        if ( badTokens[matches[0]] === undefined ) {
            return matches;
        }
    }
    // No good token found, just return the first token from left
    reGoodToken.lastIndex = 0;
    return reGoodToken.exec(s);
};

/******************************************************************************/

var findHostnameToken = function(s) {
    reHostnameToken.lastIndex = 0;
    return reHostnameToken.exec(s);
};

/******************************************************************************/

// Trim leading/trailing char "c"

var trimChar = function(s, c) {
    // Remove leading and trailing wildcards
    var pos = 0;
    while ( s.charAt(pos) === c ) {
        pos += 1;
    }
    s = s.slice(pos);
    if ( pos = s.length ) {
        while ( s.charAt(pos-1) === c ) {
            pos -= 1;
        }
        s = s.slice(0, pos);
    }
    return s;
};

/******************************************************************************/

var FilterParser = function() {
    this.domains = [];
    this.hostnames = [];
    this.types = [];
    this.reset();
};

/******************************************************************************/

FilterParser.prototype.toNormalizedType = {
        'stylesheet': 'stylesheet',
             'image': 'image',
            'object': 'object',
 'object-subrequest': 'object',
            'script': 'script',
    'xmlhttprequest': 'xmlhttprequest',
       'subdocument': 'sub_frame',
             'other': 'other',
             'popup': 'popup'
};

/******************************************************************************/

FilterParser.prototype.reset = function() {
    this.action = BlockAction;
    this.anchor = 0;
    this.domains.length = 0;
    this.elemHiding = false;
    this.f = '';
    this.firstParty = false;
    this.fopts = '';
    this.hostname = false;
    this.hostnames.length = 0;
    this.notHostname = false;
    this.thirdParty = false;
    this.types.length = 0;
    this.important = 0;
    this.unsupported = false;
    return this;
};

/******************************************************************************/

FilterParser.prototype.parseOptType = function(raw, not) {
    var type = this.toNormalizedType[raw];
    if ( not ) {
        for ( var k in typeNameToTypeValue ) {
            if ( k === type ) { continue; }
            // https://github.com/gorhill/uBlock/issues/121
            // `popup` is a special type, it cannot be set for filters intended
            // for real net request types. The test is safe since there is no
            // such thing as a filter using `~popup`.
            if ( k === 'popup' ) { continue; }
            this.types.push(typeNameToTypeValue[k]);
        }
    } else {
        this.types.push(typeNameToTypeValue[type]);
    }
};

/******************************************************************************/

FilterParser.prototype.parseOptParty = function(not) {
    if ( not ) {
        this.firstParty = true;
    } else {
        this.thirdParty = true;
    }
};

/******************************************************************************/

FilterParser.prototype.parseOptHostnames = function(raw) {
    var µburi = µBlock.URI;
    var hostnames = raw.split('|');
    var hostname, not, domain;
    for ( var i = 0; i < hostnames.length; i++ ) {
        hostname = hostnames[i];
        not = hostname.charAt(0) === '~';
        if ( not ) {
            hostname = hostname.slice(1);
        }
        // https://github.com/gorhill/uBlock/issues/188
        // If not a real domain as per PSL, assign a synthetic one
        domain = µburi.domainFromHostname(hostname);
        if ( domain === '' ) {
            domain = noDomainName;
        }
        // https://github.com/gorhill/uBlock/issues/191
        // Well it doesn't seem to make a whole lot of sense to have both 
        // non-negated hostnames mixed with negated hostnames.
        if ( this.hostnames.length !== 0 && not !== this.notHostname ) {
            console.error('FilterContainer.parseOptHostnames(): ambiguous filter syntax: "%s"', this.f);
            this.unsupported = true;
            return;
        }
        this.notHostname = not;
        this.hostnames.push(hostname);
        this.domains.push(domain);
    }
};

/******************************************************************************/

FilterParser.prototype.parse = function(s) {
    // important!
    this.reset();

    // element hiding filter?
    if ( s.indexOf('##') >= 0 || s.indexOf('#@') >= 0 ) {
        this.elemHiding = true;
        return this;
    }

    // block or allow filter?
    if ( s.slice(0, 2) === '@@' ) {
        this.action = AllowAction;
        s = s.slice(2);
    }

    // hostname anchoring
    if ( s.slice(0, 2) === '||' ) {
        this.hostname = true;
        s = s.slice(2);
    }

    // left-anchored
    if ( s.charAt(0) === '|' ) {
        this.anchor = -1;
        s = s.slice(1);
    }

    // options
    var pos = s.indexOf('$');
    if ( pos > 0 ) {
        this.fopts = s.slice(pos + 1);
        s = s.slice(0, pos);
    }

    // right-anchored
    if ( s.slice(-1) === '|' ) {
        this.anchor = 1;
        s = s.slice(0, -1);
    }

    // normalize placeholders
    // TODO: transforming `^` into `*` is not a strict interpretation of
    // ABP syntax.
    s = s.replace(/\^/g, '*');
    s = s.replace(/\*\*+/g, '*');

    // remove leading and trailing wildcards
    this.f = trimChar(s, '*');

    if ( !this.fopts ) {
        return this;
    }

    // parse options
    var opts = this.fopts.split(',');
    var opt, not;
    for ( var i = 0; i < opts.length; i++ ) {
        opt = opts[i];
        not = opt.charAt(0) === '~';
        if ( not ) {
            opt = opt.slice(1);
        }
        if ( opt === 'third-party' ) {
            this.parseOptParty(not);
            continue;
        }
        if ( this.toNormalizedType.hasOwnProperty(opt) ) {
            this.parseOptType(opt, not);
            continue;
        }
        if ( opt.slice(0,7) === 'domain=' ) {
            this.parseOptHostnames(opt.slice(7));
            continue;
        }
        if ( opt === 'popup' ) {
            this.parseOptType('popup', not);
            continue;
        }
        if ( opt === 'important' ) {
            this.important = Important;
            continue;
        }
        this.unsupported = true;
        break;
    }
    return this;
};

/******************************************************************************/
/******************************************************************************/

var FilterBucket = function(a, b) {
    this.filters = [a, b];
    this.f = null;
};

FilterBucket.prototype.add = function(a) {
    this.filters.push(a);
};

FilterBucket.prototype.match = function(url, tokenBeg) {
    var filters = this.filters;
    var i = filters.length;
    while ( i-- ) {
        if ( filters[i].match(url, tokenBeg) !== false ) {
            this.f = filters[i];
            return true;
        }
    }
    return false;
};

FilterBucket.prototype.toString = function() {
    if ( this.f !== null ) {
        return this.f.toString();
    }
    return '';
};

/******************************************************************************/
/******************************************************************************/

var FilterContainer = function() {
    this.reAnyToken = /[%0-9a-z]+/g;
    this.buckets = new Array(8);
    this.blockedAnyPartyHostnames = new µBlock.LiquidDict();
    this.blocked3rdPartyHostnames = new µBlock.LiquidDict();
    this.filterParser = new FilterParser();
    this.noDomainBits = this.toDomainBits(noDomainName);
    this.reset();
};

/******************************************************************************/

// Reset all, thus reducing to a minimum memory footprint of the context.

FilterContainer.prototype.reset = function() {
    this.frozen = false;
    this.processedFilterCount = 0;
    this.acceptedCount = 0;
    this.allowFilterCount = 0;
    this.blockFilterCount = 0;
    this.duplicateCount = 0;
    this.categories = {};
    this.duplicates = {};
    this.blockedAnyPartyHostnames.reset();
    this.blocked3rdPartyHostnames.reset();
    this.filterParser.reset();
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    //histogram('allFilters', this.categories);
    this.blockedAnyPartyHostnames.freeze();
    this.blocked3rdPartyHostnames.freeze();
    this.duplicates = {};
    this.filterParser.reset();
    this.frozen = true;
};

/******************************************************************************/

FilterContainer.prototype.toDomainBits = function(domain) {
    if ( domain === undefined ) {
        return 0;
    }
    var i = domain.length >> 2;
    return (domain.charCodeAt(    0) & 0x01) << 3 |
           (domain.charCodeAt(    i) & 0x01) << 2 |
           (domain.charCodeAt(  i+i) & 0x01) << 1 |
           (domain.charCodeAt(i+i+i) & 0x01) << 0;
};

/******************************************************************************/

FilterContainer.prototype.makeCategoryKey = function(category) {
    return String.fromCharCode(category);
};

/******************************************************************************/

FilterContainer.prototype.addAnyPartyHostname = function(hostname) {
    if ( this.blockedAnyPartyHostnames.add(hostname) ) {
        this.acceptedCount++;
        this.blockFilterCount++;
        return true;
    }
    this.duplicateCount++;
    return false;
};

/******************************************************************************/

FilterContainer.prototype.add3rdPartyHostname = function(hostname) {
    if ( this.blocked3rdPartyHostnames.add(hostname) ) {
        this.acceptedCount++;
        this.blockFilterCount++;
        return true;
    }
    this.duplicateCount++;
    return false;
};

/******************************************************************************/

FilterContainer.prototype.add = function(s) {
    // ORDER OF TESTS IS IMPORTANT!

    // Ignore empty lines
    if ( reIgnoreEmpty.test(s) ) {
        return false;
    }

    // Ignore comments
    if ( reIgnoreComment.test(s) ) {
        return false;
    }

    var parsed = this.filterParser.parse(s);

    // Ignore element-hiding filters
    if ( parsed.elemHiding ) {
        return false;
    }

    if ( this.duplicates[s] ) {
        this.duplicateCount++;
        return false;
    }
    this.duplicates[s] = true;

    this.processedFilterCount += 1;

    // Ignore rules with other conditions for now
    if ( parsed.unsupported ) {
        // console.log('µBlock> abp-filter.js/FilterContainer.add(): unsupported filter "%s"', s);
        return false;
    }

    // Ignore optionless hostname rules, these will be taken care of by µBlock.
    if ( parsed.hostname && parsed.fopts === '' && parsed.action === BlockAction && reHostnameRule.test(parsed.f) ) {
        return false;
    }

    this.acceptedCount += 1;

    // Pure third-party hostnames, use more efficient liquid dict
    if ( reHostnameRule.test(parsed.f) && parsed.hostname && parsed.action === BlockAction ) {
        if ( parsed.fopts === 'third-party' ) {
            return this.blocked3rdPartyHostnames.add(parsed.f);
        }
        if ( parsed.fopts === '' ) {
            return this.blockedAnyPartyHostnames.add(parsed.f);
        }
    }

    var r = this.addFilter(parsed);
    if ( r === false ) {
        return false;
    }

    if ( parsed.action ) {
        this.allowFilterCount += 1;
    } else {
        this.blockFilterCount += 1;
    }
    return true;
};

/******************************************************************************/

FilterContainer.prototype.addFilter = function(parsed) {
    // TODO: avoid duplicates

    var matches = parsed.hostname ? findHostnameToken(parsed.f) : findFirstGoodToken(parsed.f);
    if ( !matches || !matches[0].length ) {
        return false;
    }
    var tokenBeg = matches.index;
    var tokenEnd = parsed.hostname ? reHostnameToken.lastIndex : reGoodToken.lastIndex;
    var filter;

    var i = parsed.hostnames.length;

    if ( i !== 0 && !parsed.notHostname ) {
        while ( i-- ) {
            filter = makeHostnameFilter(parsed, tokenBeg, parsed.hostnames[i]);
            if ( !filter ) {
                return false;
            }
            this.addFilterEntry(
                filter,
                parsed,
                SpecificParty | this.toDomainBits(parsed.domains[i]),
                tokenBeg,
                tokenEnd
            );
        }
        return true;
    }

    // https://github.com/gorhill/uBlock/issues/191
    // Invert the purpose of the filter for negated hostnames
    if ( i !== 0 && parsed.notHostname ) {
        filter = makeFilter(parsed, tokenBeg);
        if ( !filter ) {
            return false;
        }
        this.addFilterEntry(filter, parsed, AnyParty, tokenBeg, tokenEnd);
        // Reverse purpose of filter
        parsed.action ^= ToggleAction;
        while ( i-- ) {
            filter = makeHostnameFilter(parsed, tokenBeg, parsed.hostnames[i]);
            if ( !filter ) {
                return false;
            }
            // https://github.com/gorhill/uBlock/issues/191#issuecomment-53654024
            // If it is a block filter, we need to reverse the order of
            // evaluation.
            if ( parsed.action === BlockAction ) {
                parsed.important = Important;
            }
            this.addFilterEntry(
                filter,
                parsed,
                SpecificParty | this.toDomainBits(parsed.domains[i]),
                tokenBeg,
                tokenEnd
            );
        }
        return true;
    }

    filter = makeFilter(parsed, tokenBeg);
    if ( !filter ) {
        return false;
    }
    if ( parsed.firstParty ) {
        this.addFilterEntry(filter, parsed, FirstParty, tokenBeg, tokenEnd);
    } else if ( parsed.thirdParty ) {
        this.addFilterEntry(filter, parsed, ThirdParty, tokenBeg, tokenEnd);
    } else {
        this.addFilterEntry(filter, parsed, AnyParty, tokenBeg, tokenEnd);
    }
    return true;
};

/******************************************************************************/

FilterContainer.prototype.addFilterEntry = function(filter, parsed, party, tokenBeg, tokenEnd) {
    var s = parsed.f;
    var tokenKey = s.slice(tokenBeg, tokenEnd);
    var bits = parsed.action | parsed.important | party;
    if ( parsed.types.length === 0 ) {
        this.addToCategory(bits | AnyType, tokenKey, filter);
        return;
    }
    var n = parsed.types.length;
    for ( var i = 0; i < n; i++ ) {
        this.addToCategory(bits | parsed.types[i], tokenKey, filter);
    }
};

/******************************************************************************/

FilterContainer.prototype.addToCategory = function(category, tokenKey, filter) {
    var categoryKey = this.makeCategoryKey(category);
    var categoryBucket = this.categories[categoryKey];
    if ( !categoryBucket ) {
        categoryBucket = this.categories[categoryKey] = {};
    }
    var filterEntry = categoryBucket[tokenKey];
    if ( filterEntry === undefined ) {
        categoryBucket[tokenKey] = filter;
        return;
    }
    if ( filterEntry instanceof FilterBucket ) {
        filterEntry.add(filter);
        return;
    }
    categoryBucket[tokenKey] = new FilterBucket(filterEntry, filter);
};

/******************************************************************************/

FilterContainer.prototype.matchTokens = function(url) {
    var re = this.reAnyToken;
    var matches, beg, token, f;
    var buckets = this.buckets;
    var bucket0 = buckets[0];
    var bucket1 = buckets[1];
    var bucket2 = buckets[2];
    var bucket3 = buckets[3];
    var bucket4 = buckets[4];
    var bucket5 = buckets[5];
    var bucket6 = buckets[6];
    var bucket7 = buckets[7];

    re.lastIndex = 0;
    while ( matches = re.exec(url) ) {
        beg = matches.index;
        token = url.slice(beg, re.lastIndex);
        if ( bucket0 !== undefined && bucket0.hasOwnProperty(token) ) {
            f = bucket0[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket1 !== undefined && bucket1.hasOwnProperty(token) ) {
            f = bucket1[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket2 !== undefined && bucket2.hasOwnProperty(token) ) {
            f = bucket2[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket3 !== undefined && bucket3.hasOwnProperty(token) ) {
            f = bucket3[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket4 !== undefined && bucket4.hasOwnProperty(token) ) {
            f = bucket4[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket5 !== undefined && bucket5.hasOwnProperty(token) ) {
            f = bucket5[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket6 !== undefined && bucket6.hasOwnProperty(token) ) {
            f = bucket6[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket7 !== undefined && bucket7.hasOwnProperty(token) ) {
            f = bucket7[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
    }
    return false;
};

/******************************************************************************/

// This is where we test filters which have the form:
//
//   `||www.example.com^`
//
// Because LiquidDict is well optimized to deal with plain hostname, we gain
// reusing it here for these sort of filters rather than using filters
// specialized to deal with other complex filters.

FilterContainer.prototype.matchAnyPartyHostname = function(requestHostname) {
    // Quick test first
    if ( this.blockedAnyPartyHostnames.test(requestHostname) ) {
        return '||' + requestHostname + '^';
    }
    // Check parent hostnames if quick test failed
    var hostnames = µBlock.URI.parentHostnamesFromHostname(requestHostname);
    for ( var i = 0, n = hostnames.length; i < n; i++ ) {
        if ( this.blockedAnyPartyHostnames.test(hostnames[i]) ) {
            return '||' + hostnames[i] + '^';
        }
    }
    return false;
};

/******************************************************************************/

// This is where we test filters which have the form:
//
//   `||www.example.com^$third-party`
//
// Because LiquidDict is well optimized to deal with plain hostname, we gain
// reusing it here for these sort of filters rather than using filters
// specialized to deal with other complex filters.

FilterContainer.prototype.match3rdPartyHostname = function(requestHostname) {
    // Quick test first
    if ( this.blocked3rdPartyHostnames.test(requestHostname) ) {
        return '||' + requestHostname + '^$third-party';
    }
    // Check parent hostnames if quick test failed
    var hostnames = µBlock.URI.parentHostnamesFromHostname(requestHostname);
    for ( var i = 0, n = hostnames.length; i < n; i++ ) {
        if ( this.blocked3rdPartyHostnames.test(hostnames[i]) ) {
            return '||' + hostnames[i] + '^$third-party';
        }
    }
    return false;
};

/******************************************************************************/

// Specialized handlers

// https://github.com/gorhill/uBlock/issues/116
// Some type of requests are exceptional, they need custom handling,
// not the generic handling.

FilterContainer.prototype.matchStringExactType = function(pageDetails, requestURL, requestType, requestHostname) {
    var url = requestURL.toLowerCase();
    var pageDomain = pageDetails.pageDomain || '';
    var party = requestHostname.slice(-pageDomain.length) === pageDomain ?
        FirstParty :
        ThirdParty;
    var domainParty = this.toDomainBits(pageDomain);
    var type = typeNameToTypeValue[requestType];
    var categories = this.categories;
    var buckets = this.buckets;

    // This will be used by hostname-based filters
    pageHostname = pageDetails.pageHostname || '';

    buckets[0] = buckets[1] = buckets[2] = buckets[6] = undefined;

    // https://github.com/gorhill/uBlock/issues/139
    // Test against important block filters
    buckets[3] = categories[this.makeCategoryKey(BlockAnyParty | Important | type)];
    buckets[4] = categories[this.makeCategoryKey(BlockAction | Important | type | party)];
    buckets[5] = categories[this.makeCategoryKey(BlockOneParty | Important | type | domainParty)];
    buckets[7] = categories[this.makeCategoryKey(BlockOneParty | Important | type | this.noDomainBits)];
    var bf = this.matchTokens(url);
    if ( bf !== false ) {
        return bf.toString();
    }

    // Test against block filters
    // If there is no block filter, no need to test against allow filters
    buckets[3] = categories[this.makeCategoryKey(BlockAnyParty | type)];
    buckets[4] = categories[this.makeCategoryKey(BlockAction | type | party)];
    buckets[5] = categories[this.makeCategoryKey(BlockOneParty | type | domainParty)];
    buckets[7] = categories[this.makeCategoryKey(BlockOneParty | type | this.noDomainBits)];
    bf = this.matchTokens(url);
    if ( bf === false ) {
        return false;
    }

    // Test against allow filters
    buckets[3] = categories[this.makeCategoryKey(AllowAnyParty | type)];
    buckets[4] = categories[this.makeCategoryKey(AllowAction | type | party)];
    buckets[5] = categories[this.makeCategoryKey(AllowOneParty | type | domainParty)];
    buckets[7] = categories[this.makeCategoryKey(AllowOneParty | type | this.noDomainBits)];
    var af = this.matchTokens(url);
    if ( af !== false ) {
        return '@@' + af.toString();
    }

    return bf.toString();
};

/******************************************************************************/

FilterContainer.prototype.matchString = function(pageDetails, requestURL, requestType, requestHostname) {
    // https://github.com/gorhill/httpswitchboard/issues/239
    // Convert url to lower case:
    //     `match-case` option not supported, but then, I saw only one
    //     occurrence of it in all the supported lists (bulgaria list).
    var url = requestURL.toLowerCase();

    // The logic here is simple:
    //
    // block = !whitelisted &&  blacklisted
    //   or equivalent
    // allow =  whitelisted || !blacklisted

    // Statistically, hits on a URL in order of likelihood:
    // 1. No hit
    // 2. Hit on a block filter
    // 3. Hit on an allow filter
    //
    // High likelihood of "no hit" means to optimize we need to reduce as much
    // as possible the number of filters to test.
    //
    // Then, because of the order of probabilities, we should test only
    // block filters first, and test allow filters if and only if there is a 
    // hit on a block filter. Since there is a high likelihood of no hit,
    // testing allow filter by default is likely wasted work, hence allow
    // filters are tested *only* if there is a (unlikely) hit on a block
    // filter.

    var pageDomain = pageDetails.pageDomain || '';
    var party = requestHostname.slice(-pageDomain.length) === pageDomain ?
        FirstParty :
        ThirdParty;

    // This will be used by hostname-based filters
    pageHostname = pageDetails.pageHostname || '';

    var domainParty = this.toDomainBits(pageDomain);
    var type = typeNameToTypeValue[requestType];
    var categories = this.categories;
    var buckets = this.buckets;

    // https://github.com/gorhill/uBlock/issues/139
    // Test against important block filters.
    // The purpose of the `important` option is to reverse the order of
    // evaluation. Normally, it is "evaluate block then evaluate allow", with
    // the `important` property it is "evaluate allow then evaluate block".
    buckets[0] = categories[this.makeCategoryKey(BlockAnyTypeAnyParty | Important)];
    buckets[1] = categories[this.makeCategoryKey(BlockAnyType | Important | party)];
    buckets[2] = categories[this.makeCategoryKey(BlockAnyTypeOneParty | Important | domainParty)];
    buckets[3] = categories[this.makeCategoryKey(BlockAnyParty | Important | type)];
    buckets[4] = categories[this.makeCategoryKey(BlockAction | Important | type | party)];
    buckets[5] = categories[this.makeCategoryKey(BlockOneParty | Important | type | domainParty)];
    buckets[6] = categories[this.makeCategoryKey(BlockAnyTypeOneParty | Important | this.noDomainBits)];
    buckets[7] = categories[this.makeCategoryKey(BlockOneParty | Important | type | this.noDomainBits)];
    var bf = this.matchTokens(url);
    if ( bf !== false ) {
        return bf.toString();
    }

    // Test hostname-based block filters
    bf = this.matchAnyPartyHostname(requestHostname);
    if ( bf === false && party === ThirdParty ) {
        bf = this.match3rdPartyHostname(requestHostname);
    }

    // Test against block filters
    if ( bf === false ) {
        buckets[0] = categories[this.makeCategoryKey(BlockAnyTypeAnyParty)];
        buckets[1] = categories[this.makeCategoryKey(BlockAnyType | party)];
        buckets[2] = categories[this.makeCategoryKey(BlockAnyTypeOneParty | domainParty)];
        buckets[3] = categories[this.makeCategoryKey(BlockAnyParty | type)];
        buckets[4] = categories[this.makeCategoryKey(BlockAction | type | party)];
        buckets[5] = categories[this.makeCategoryKey(BlockOneParty | type | domainParty)];
        // https://github.com/gorhill/uBlock/issues/188
        // Test for synthetic domain as well
        buckets[6] = categories[this.makeCategoryKey(BlockAnyTypeOneParty | this.noDomainBits)];
        buckets[7] = categories[this.makeCategoryKey(BlockOneParty | type | this.noDomainBits)];
        bf = this.matchTokens(url);
    }

    // If there is no block filter, no need to test against allow filters
    if ( bf === false ) {
        return false;
    }

    // Test against allow filters
    buckets[0] = categories[this.makeCategoryKey(AllowAnyTypeAnyParty)];
    buckets[1] = categories[this.makeCategoryKey(AllowAnyType | party)];
    buckets[2] = categories[this.makeCategoryKey(AllowAnyTypeOneParty | domainParty)];
    buckets[3] = categories[this.makeCategoryKey(AllowAnyParty | type)];
    buckets[4] = categories[this.makeCategoryKey(AllowAction | type | party)];
    buckets[5] = categories[this.makeCategoryKey(AllowOneParty | type | domainParty)];
    // https://github.com/gorhill/uBlock/issues/188
    // Test for synthetic domain as well
    buckets[6] = categories[this.makeCategoryKey(AllowAnyTypeOneParty | this.noDomainBits)];
    buckets[7] = categories[this.makeCategoryKey(AllowOneParty | type | this.noDomainBits)];
    var af = this.matchTokens(url);
    if ( af !== false ) {
        return '@@' + af.toString();
    }

    return bf.toString();
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.blockFilterCount + this.allowFilterCount;
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();
