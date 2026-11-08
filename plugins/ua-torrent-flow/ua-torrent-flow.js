(function () {
    'use strict';

    if (typeof Lampa === 'undefined' || window.__uat_torrent_flow) return;
    window.__uat_torrent_flow = true;

    var ID = 'ua_torrent_flow';
    var NAME = 'UA Torrent Flow';
    var VERSION = '2.1.2';
    var TOP_COUNT = 3;
    var lastMovie = null;
    var SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
    var SCRIPT_DIR = SCRIPT_SRC.replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
    var DATA_BASE = SCRIPT_DIR + '../../data/voices/';
    var SHARD_SIZE = 1000;
    var KEY_VOICES_SERVICE = 'ua_torrent_flow_voices_service';
    var shards = {};
    var VOICE_BATCH = 20;
    var VOICE_RETRIES = 12;
    var voiceData = {};
    var voiceTries = {};
    var voiceWanted = [];
    var voiceTimer = null;

    var CSS = [
        '.uat-item{padding:1.5em !important}',
        '.uat-item .torrent-item__details{display:none !important}',
        '.uat-item .torrent-item__ffprobe{display:none !important}',
        '.uat-item .torrent-item__title{word-break:normal}',
        '.uat-title{display:flex;align-items:baseline;gap:0.8em}',
        '.uat-title__main{min-width:0;flex:1 1 auto;font-weight:400;overflow-wrap:anywhere}',
        '.uat-title__sep{margin:0 0.45em;color:rgba(255,255,255,0.35);font-weight:400}',
        '.uat-voices{margin-top:0.35em;font-size:0.63em;font-weight:600;color:rgba(255,255,255,0.58);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.uat-voices:empty{display:none}',
        '.uat-title__side{flex:0 0 auto;margin-left:auto;white-space:nowrap;font-size:0.8em;font-weight:600;color:inherit;opacity:0.6}',
        '.uat-panel{display:flex;flex-wrap:wrap;align-items:center;gap:0.9em;margin:1.2em -1.5em -1.5em;padding:1.125em 1.5em 1.275em;',
        'border-radius:0 0 0.3em 0.3em;border-top:1px solid rgba(255,255,255,0.05);background:transparent;',
        'animation:uat-panel-in 0.22s ease-out}',
        '.uat-panel__left{min-width:0;flex:0 0 auto}',
        '.uat-panel__label{font-size:0.95em;font-weight:800;letter-spacing:0.2px;color:rgba(255,255,255,0.92);line-height:1.15}',
        '.uat-panel__meta{margin-top:0.25em;font-size:0.82em;font-weight:600;color:rgba(255,255,255,0.58);',
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.uat-panel__right{display:flex;flex-wrap:wrap;gap:0.54em;margin-left:auto;justify-content:flex-end}',
        '.uat-chip{display:inline-flex;align-items:baseline;padding:0.34em 0.66em;border-radius:999px;',
        'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.10);',
        'font-size:1.03em;font-weight:400;color:rgba(255,255,255,0.6);white-space:nowrap}',
        '.uat-panel__meta .uat-tracker{font-weight:400 !important}',
        '.uat-panel--high{background:linear-gradient(to right,rgba(76,175,80,0.12) 0%,rgba(76,175,80,0) 50%)}',
        '.uat-panel--high .uat-panel__label{color:rgba(160,255,200,0.92)}',
        '.uat-panel--mid{background:linear-gradient(to right,rgba(255,193,7,0.12) 0%,rgba(255,193,7,0) 50%)}',
        '.uat-panel--mid .uat-panel__label{color:rgba(255,226,130,0.95)}',
        '.uat-chip--low{background:rgba(244,67,54,0.18);border-color:rgba(244,67,54,0.45);color:rgba(255,150,150,0.95)}',
        '.uat-chip--mid{background:rgba(255,193,7,0.18);border-color:rgba(255,193,7,0.45);color:rgba(255,226,130,0.95)}',
        '.uat-chip--high{background:rgba(76,175,80,0.18);border-color:rgba(76,175,80,0.45);color:rgba(160,255,200,0.95)}',
        '@keyframes uat-panel-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}',
        '@media (max-width:520px){.uat-panel{gap:0.7em;padding:0.975em 1.35em 1.125em}.uat-panel__meta{display:none}}'
    ].join('');

    function injectStyles() {
        try {
            var style = document.createElement('style');
            style.setAttribute('data-uat', 'true');
            style.innerHTML = CSS;
            document.head.appendChild(style);
        } catch (e) {
            console.error(NAME, 'style error', e);
        }
    }

    function num(v) {
        var n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    }

    function pick(el, keys) {
        for (var i = 0; i < keys.length; i++) {
            if (el[keys[i]] !== undefined && el[keys[i]] !== null && el[keys[i]] !== '') return el[keys[i]];
        }
        return 0;
    }

    function sizeBytes(el) {
        var v = pick(el, ['Size', 'size_bytes', 'size']);
        if (typeof v === 'number') return v;
        var m = String(v).replace(',', '.').match(/([\d.]+)\s*(kb|mb|gb|tb|кб|мб|гб|тб)?/i);
        if (!m) return 0;
        var n = parseFloat(m[1]) || 0;
        var u = (m[2] || '').toLowerCase();
        var mul = { kb: 1024, 'кб': 1024, mb: 1048576, 'мб': 1048576, gb: 1073741824, 'гб': 1073741824, tb: 1099511627776, 'тб': 1099511627776 };
        return u ? n * mul[u] : n;
    }

    function isSerial(movie) {
        return !!(movie && (movie.original_name || movie.number_of_seasons > 0 || movie.seasons));
    }

    function parseSeason(title) {
        var m = /\bS(\d{1,2})\s*[-–]\s*S?(\d{1,2})\b/i.exec(title);
        if (m && +m[2] > +m[1]) return { from: +m[1], to: +m[2] };
        m = /seasons?\s*(\d{1,2})\s*(?:[-–&]|and|і|та)\s*(\d{1,2})(?!\d)/i.exec(title);
        if (m && +m[2] > +m[1]) return { from: +m[1], to: +m[2] };
        m = /(?:^|[^\d])(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:сезон|season)/i.exec(title);
        if (m && +m[2] > +m[1]) return { from: +m[1], to: +m[2] };
        m = /\bS(\d{1,2})\s*E\d{1,3}/i.exec(title) || /\bS(\d{1,2})\b/i.exec(title) ||
            /seasons?\s*(\d{1,2})(?!\d)/i.exec(title) || /(?:^|[^\d])(\d{1,2})\s*(?:сезон|season)/i.exec(title) ||
            /сезон\s*(\d{1,2})/i.exec(title);
        if (m) return { from: +m[1], to: +m[1] };
        return null;
    }

    function parseRes(el, title) {
        var probe = el.ffprobe;
        if (probe && probe.length) {
            for (var i = 0; i < probe.length; i++) {
                var s = probe[i];
                if (s.codec_type === 'video' && s.height) {
                    if (s.height >= 2160 || (s.width && s.width >= 3800)) return 2160;
                    if (s.height >= 1080 || (s.width && s.width >= 1900)) return 1080;
                    if (s.height >= 720 || (s.width && s.width >= 1260)) return 720;
                    return 480;
                }
            }
        }
        var t = title.toLowerCase();
        if (/\b2160p?\b|\b4k\b/.test(t)) return 2160;
        if (/\b1440p\b/.test(t)) return 1440;
        if (/\b1080[pi]\b/.test(t)) return 1080;
        if (/\b720p\b/.test(t)) return 720;
        if (/\b(480p|576p|dvd|sd)\b/.test(t)) return 480;
        return 0;
    }

    function parseLang(title) {
        var main = title.split(/\|\s*sub\b/i)[0];
        var langs = [];
        var tracks = 1;
        var m = /(\d+)\s*x\s*(?:ukr|ua)(?![a-z])/i.exec(main);
        var ukr = /(?:^|[^a-z]|\d\s*x)(?:ukr|ua)(?![a-z])/i.test(main) || /укр/i.test(main);
        if (m) tracks = +m[1];
        if (ukr) langs.push('UKR');
        if (/(^|[^a-z])eng(?![a-z])/i.test(main)) langs.push('ENG');
        if (/(^|[^a-z])(?:rus|ru)(?![a-z])/i.test(main)) langs.push('RUS');
        if (/(^|[^a-z])pol(?![a-z])/i.test(main)) langs.push('POL');
        return { ukr: ukr, tracks: tracks, langs: langs };
    }

    function episodesFor(movie, season) {
        if (!movie) return 0;
        var list = movie.seasons;
        if (season && list && list.length) {
            var total = 0;
            for (var i = 0; i < list.length; i++) {
                var n = list[i].season_number;
                if (n >= season.from && n <= season.to) total += list[i].episode_count || 0;
            }
            if (total > 0) return total;
        }
        if (movie.number_of_episodes && movie.number_of_seasons) {
            var span = season ? season.to - season.from + 1 : 1;
            return Math.round(movie.number_of_episodes / movie.number_of_seasons * span);
        }
        return 0;
    }

    function bitrateOf(el, title, bytes, movie, serial, season) {
        var probe = el.ffprobe;
        if (probe && probe.length) {
            for (var i = 0; i < probe.length; i++) {
                var s = probe[i];
                if (s.codec_type === 'video') {
                    var bps = parseInt((s.tags && s.tags.BPS) || s.bit_rate, 10);
                    if (bps > 0) return Math.round(bps / 1e6);
                }
            }
        }
        var minutes = movie && (movie.runtime || movie.duration || movie.episode_run_time);
        if (minutes && minutes.length !== undefined && typeof minutes !== 'string') minutes = minutes[0];
        minutes = num(minutes);
        if (!minutes && serial) minutes = 45;
        if (!bytes || !minutes) return 0;
        var eps = serial ? (episodesFor(movie, season) || 1) : 1;
        var mbps = Math.round(bytes * 8 / 1e6 / (minutes * 60 * eps));
        if (mbps <= 0) return 0;
        return Math.min(mbps, 150);
    }

    function info(el, movie) {
        var title = el.Title || el.title || '';
        var serial = isSerial(movie);
        var season = serial ? parseSeason(title) : null;
        var bytes = sizeBytes(el);
        var lang = parseLang(title);
        return {
            season: season,
            res: parseRes(el, title),
            ukr: lang.ukr,
            tracks: lang.tracks,
            langs: lang.langs,
            bitrate: bitrateOf(el, title, bytes, movie, serial, season),
            seeds: num(pick(el, ['Seeders', 'seeders', 'Seeds', 'seeds'])),
            peers: num(pick(el, ['Peers', 'peers', 'leechers', 'Leechers'])),
            gb: bytes / 1073741824,
            source: matchFirst(SOURCES, normalizeTitle(title)),
            tracker: String(el.Tracker || el.tracker || '').trim()
        };
    }

    function sourceRank(source) {
        if (source === 'BDRip' || source === 'UHD BDRip') return 0;
        if (source === 'BDRemux' || source === 'UHD BDRemux' || source === 'BluRay') return 1;
        if (source === 'WEB-DL') return 2;
        if (source === 'WEBRip' || source === 'WEB') return 3;
        if (source === 'HDTV' || source === 'HDRip') return 4;
        return 5;
    }

    function byPreference(a, b) {
        var x = a._uatInfo;
        var y = b._uatInfo;
        var tier = (stateOf(x.seeds) === 'high' ? 0 : 1) - (stateOf(y.seeds) === 'high' ? 0 : 1);
        return tier || sourceRank(x.source) - sourceRank(y.source) || y.seeds - x.seeds;
    }

    function bySeeds(a, b) {
        return b._uatInfo.seeds - a._uatInfo.seeds;
    }

    function resRank(res) {
        if (res === 1080) return 0;
        if (res === 2160) return 1;
        if (res === 720) return 2;
        return 3;
    }

    function seasonSpan(info) {
        return info.season ? info.season.to - info.season.from + 1 : 1;
    }

    function pickMulti(list) {
        var best = null;
        for (var i = 0; i < list.length; i++) {
            var a = list[i]._uatInfo;
            if (seasonSpan(a) < 2) continue;
            if (!best) { best = list[i]; continue; }
            var b = best._uatInfo;
            var better = seasonSpan(a) - seasonSpan(b) ||
                resRank(b.res) - resRank(a.res) ||
                sourceRank(b.source) - sourceRank(a.source) ||
                a.seeds - b.seeds;
            if (better > 0) best = list[i];
        }
        return best;
    }

    function baseTop(list, multiRes) {
        var r1080 = [], r4k = [], r720 = [], other = [];
        var i;
        for (i = 0; i < list.length; i++) {
            var res = list[i]._uatInfo.res;
            if (res === 1080) r1080.push(list[i]);
            else if (res === 2160) r4k.push(list[i]);
            else if (res === 720) r720.push(list[i]);
            else other.push(list[i]);
        }
        r1080.sort(byPreference); r4k.sort(byPreference); r720.sort(byPreference); other.sort(byPreference);

        var top = [];
        var withMultiSlot = multiRes !== undefined;
        var preferred = !withMultiSlot ? [r1080[0], r1080[1], r4k[0]] :
            multiRes === 2160 ? [r1080[0], r1080[1]] : [r1080[0], r4k[0]];
        var limit = withMultiSlot ? TOP_COUNT - 1 : TOP_COUNT;
        for (i = 0; i < preferred.length; i++) if (preferred[i]) top.push(preferred[i]);
        var pool = r1080.concat(r4k, r720, other);
        for (i = 0; i < pool.length && top.length < limit; i++) {
            if (top.indexOf(pool[i]) === -1) top.push(pool[i]);
        }
        return top;
    }

    function withMulti(top, multi) {
        var pos = 0;
        if (stateOf(multi._uatInfo.seeds) !== 'high') {
            pos = top[1] && stateOf(top[1]._uatInfo.seeds) === 'high' ? 2 : 1;
        }
        var out = top.slice();
        out.splice(Math.min(pos, out.length), 0, multi);
        return out.slice(0, TOP_COUNT);
    }

    function arrange(list) {
        var alive = [];
        var i;
        for (i = 0; i < list.length; i++) {
            var el = list[i];
            if (!el._uatInfo) el._uatInfo = info(el, lastMovie);
            if (el._uatInfo.seeds > 0) alive.push(el);
        }

        var eligible = [];
        for (i = 0; i < alive.length; i++) {
            if (alive[i]._uatInfo.ukr && stateOf(alive[i]._uatInfo.seeds) !== 'low') eligible.push(alive[i]);
        }

        var multi = isSerial(lastMovie) ? pickMulti(eligible) : null;
        var base = [];
        for (i = 0; i < eligible.length; i++) if (eligible[i] !== multi) base.push(eligible[i]);
        var top = multi ? withMulti(baseTop(base, multi._uatInfo.res), multi) : baseTop(base);

        var rest = [];
        for (i = 0; i < alive.length; i++) if (top.indexOf(alive[i]) === -1) rest.push(alive[i]);
        rest.sort(bySeeds);

        var out = top.concat(rest);
        for (i = 0; i < out.length; i++) out[i]._uatRank = i < top.length ? i : 999;
        return out;
    }

    function patchList(list) {
        if (!list || list._uatPatched) return list;
        var origSort = list.sort;
        var origFilter = list.filter;
        list.sort = function () {
            origSort.apply(this, arguments);
            var arranged = arrange(Array.prototype.slice.call(this));
            this.length = 0;
            for (var i = 0; i < arranged.length; i++) this.push(arranged[i]);
            return this;
        };
        list.filter = function () {
            return patchList(arrange(origFilter.apply(this, arguments)));
        };
        list._uatPatched = true;
        return list;
    }

    function hookParser() {
        var parser = window.Lampa && (Lampa.Parser || (Lampa.Component && Lampa.Component.Parser));
        if (!parser || typeof parser.get !== 'function') return false;
        if (parser._uatHooked) return true;
        var original = parser.get;
        parser.get = function (params, oncomplete, onerror) {
            lastMovie = (params && params.movie) || null;
            return original.call(this, params, function (data) {
                if (data && data.Results && Array.isArray(data.Results)) {
                    var results = patchList(arrange(data.Results));
                    try {
                        Object.defineProperty(data, 'Results', {
                            get: function () { return results; },
                            set: function (v) { results = patchList(arrange(v)); },
                            configurable: true,
                            enumerable: true
                        });
                    } catch (e) {
                        data.Results = results;
                    }
                }
                return oncomplete.apply(this, arguments);
            }, onerror);
        };
        parser._uatHooked = true;
        return true;
    }

    function pill(text, cls) {
        return '<span class="uat-chip' + (cls ? ' ' + cls : '') + '">' + text + '</span>';
    }

    function seasonText(season) {
        if (!season) return '';
        if (season.from === season.to) return 'Сезон ' + season.from;
        return 'Сезони ' + season.from + '–' + season.to;
    }

    function resText(res) {
        if (res >= 2160) return '4K';
        if (res) return res + 'p';
        return '—';
    }

    function langText(i) {
        if (!i.ukr) return 'Без UKR';
        return '🇺🇦 ' + (i.tracks > 1 ? i.tracks + '× ' : '') + i.langs.join(' · ');
    }

    function speedText(seeds) {
        if (seeds >= 20) return 'Швидко';
        if (seeds >= 5) return 'Нормально';
        return 'Повільно';
    }

    function labelText(rank) {
        if (rank === 0) return 'Топ 1';
        if (rank === 1) return 'Топ 2';
        if (rank === 2) return 'Топ 3';
        return 'Роздача';
    }

    function stateOf(seeds) {
        if (seeds < 3) return 'low';
        if (seeds <= 10) return 'mid';
        return 'high';
    }

    var SOURCES = [
        [/\buhd[\s.-]*bd[\s.-]*remux\b/i, 'UHD BDRemux'],
        [/\bbd[\s.-]*remux\b|\bremux\b/i, 'BDRemux'],
        [/\buhd[\s.-]*bd[\s.-]*rip\b/i, 'UHD BDRip'],
        [/\bbd[\s.-]*rip\b|\bbrrip\b/i, 'BDRip'],
        [/\bblu[\s.-]*ray\b/i, 'BluRay'],
        [/\bweb[\s.-]*dl\b/i, 'WEB-DL'],
        [/\bweb[\s.-]*rip\b/i, 'WEBRip'],
        [/\bhdtv(?:rip)?\b/i, 'HDTV'],
        [/\bhd[\s.-]*rip\b/i, 'HDRip'],
        [/\bdvd[\s.-]*rip\b/i, 'DVDRip'],
        [/\bdvd(?:5|9)?\b/i, 'DVD'],
        [/\bweb\b/i, 'WEB'],
        [/\bcam[\s.-]*rip\b|\bcamrip\b|\bts\b|\btelesync\b/i, 'CAMRip']
    ];

    var CODECS = [
        [/\b(?:h[\s.]?265|hevc|x265)\b/i, 'H.265'],
        [/\b(?:h[\s.]?264|avc|x264)\b/i, 'H.264'],
        [/\bav1\b/i, 'AV1'],
        [/\bxvid\b/i, 'XviD'],
        [/\bmpeg[\s.-]?2\b/i, 'MPEG-2']
    ];

    var EDITIONS = [
        [/\bdirector['’`]?s?[\s.]*cut\b|режис+ерськ\S*[\s.]*верс\S*|режисс?ерск\S*[\s.]*верс\S*/i, 'Режисерська версія'],
        [/\btheatrical(?:[\s.]*(?:cut|version|edition))?\b|театральн\S*[\s.]*верс\S*/i, 'Театральна версія'],
        [/\bextended(?:[\s.]*(?:cut|version|edition))?\b|розширен\S*[\s.]*верс\S*|расширенн\S*[\s.]*верс\S*/i, 'Розширена версія'],
        [/\bfinal[\s.]*cut\b/i, 'Фінальна версія'],
        [/\bultimate[\s.]*(?:cut|edition)\b/i, 'Ultimate Cut'],
        [/\bunrated\b/i, 'Без рейтингу'],
        [/\buncut\b/i, 'Без скорочень'],
        [/\bimax(?:[\s.]*enhanced)?\b/i, 'IMAX'],
        [/\bremaster(?:ed)?\b/i, 'Ремастер'],
        [/\bspecial[\s.]*edition\b/i, 'Спеціальне видання'],
        [/\bcollector['’`]?s[\s.]*edition\b/i, 'Колекційне видання'],
        [/\banniversary[\s.]*edition\b/i, 'Ювілейне видання'],
        [/\bcriterion\b/i, 'Criterion'],
        [/\bredux\b/i, 'Redux']
    ];

    function editionsOf(title) {
        var found = [];
        for (var i = 0; i < EDITIONS.length; i++) {
            var m = EDITIONS[i][0].exec(title);
            if (m) found.push({ at: m.index, label: EDITIONS[i][1] });
        }
        found.sort(function (a, b) { return a.at - b.at; });
        var out = [];
        for (var k = 0; k < found.length; k++) if (out.indexOf(found[k].label) === -1) out.push(found[k].label);
        return out;
    }

    function stripEditions(name) {
        var out = name;
        for (var i = 0; i < EDITIONS.length; i++) out = out.replace(new RegExp(EDITIONS[i][0].source, 'gi'), ' ');
        return out.replace(/\s+/g, ' ').replace(/^[\s\-–:.,]+|[\s\-–:.,]+$/g, '')
            .replace(/[\s:,-]+(?:the|a|an)$/i, '').replace(/[\s\-–:.,]+$/g, '');
    }

    var NAME_STOP = /[\(\[\|]|\b(?:19|20)\d{2}\b|\bS\d{1,2}(?:\s*E\d{1,3})?\b|\bseasons?\b|\b(?:2160|1440|1080|720|576|480)[pi]\b|\b4k\b|\b(?:uhd|web|webrip|web-dl|bdrip|bdremux|bluray|blu-ray|hdtv|hdrip|dvdrip|remux)\b/ig;

    function matchFirst(list, text) {
        for (var i = 0; i < list.length; i++) if (list[i][0].test(text)) return list[i][1];
        return '';
    }

    function normalizeTitle(title) {
        var t = String(title || '');
        if (!/\s/.test(t) && /[._]/.test(t)) t = t.replace(/[._]+/g, ' ');
        return t.replace(/\s+/g, ' ').trim();
    }

    function nameOf(title) {
        var cut = title;
        var m;
        NAME_STOP.lastIndex = 0;
        while ((m = NAME_STOP.exec(title)) !== null) {
            if (m.index > 0) {
                cut = title.slice(0, m.index);
                break;
            }
            if (NAME_STOP.lastIndex === m.index) NAME_STOP.lastIndex++;
        }
        var parts = cut.split('/');
        var best = '';
        var cyr = '';
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].replace(/^[\s\-–:.,]+|[\s\-–:.,]+$/g, '');
            if (p.length > best.length) best = p;
            if (!cyr && /[а-яіїєґ]{2,}/i.test(p)) cyr = p;
        }
        return cyr || best;
    }

    function yearOf(title) {
        var m = /\((\d{4})\s*[-–]\s*(\d{4})\)/.exec(title);
        if (m) return m[1] + '–' + m[2];
        m = /\((\d{4})\)/.exec(title) || /(?:^|[^\d])((?:19|20)\d{2})(?![\d])/.exec(title.replace(/^\d{4}\b/, ''));
        return m ? m[1] : '';
    }

    function plain(text) {
        return String(text || '').toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, ' ').trim();
    }

    function localName(name, movie) {
        if (!movie || /[а-яіїєґ]/i.test(name)) return name;
        var local = movie.title || movie.name || '';
        var original = movie.original_title || movie.original_name || '';
        if (!local || !original || !/[а-яіїєґ]/i.test(local)) return name;
        return plain(name) === plain(original) ? local : name;
    }

    function titleParts(el, i, movie) {
        var raw = normalizeTitle(el.Title || el.title || '');
        var main = [];
        var desc = normalizeTitle(String(el.Description || '').replace(/<[^>]*>/g, ' '));
        var fullName = /[а-яіїєґ]{2,}/i.test(desc) ? nameOf(desc) : nameOf(raw);
        var name = stripEditions(fullName);
        if (name.length < 2 || /^(?:the|a|an)$/i.test(name)) name = fullName;
        name = localName(name, movie);
        main.push(name || raw);
        var editions = editionsOf(raw + ' ' + desc);
        for (var e = 0; e < editions.length; e++) main.push(editions[e]);
        var year = yearOf(raw);
        if (year) main.push(year);
        if (i.season) main.push(seasonText(i.season));
        var side = [];
        var source = matchFirst(SOURCES, raw);
        if (source) side.push(source);
        var codec = matchFirst(CODECS, raw);
        if (codec) side.push(codec);
        if (fmtSize(i.gb)) side.push(fmtSize(i.gb));
        return { main: main, side: side, raw: raw };
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function tolokaId(el) {
        if (!el) return '';
        var m = /toloka\.to\/t(\d+)/.exec(String(el.Details || el.Guid || el.Comments || ''));
        return m ? m[1] : '';
    }

    function requestVoice(id) {
        var data = voiceData[id];
        if (data && data.status !== 'pending') return;
        if (voiceWanted.indexOf(id) === -1) voiceWanted.push(id);
        scheduleVoices(300);
    }

    function scheduleVoices(delay) {
        if (voiceTimer) return;
        voiceTimer = setTimeout(function () {
            voiceTimer = null;
            flushVoices();
        }, delay);
    }

    function voicesService() {
        var value = '';
        try { value = String(Lampa.Storage.get(KEY_VOICES_SERVICE, '') || ''); } catch (e) {}
        value = value.replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
        if (!value) return '';
        return /^https?:\/\//i.test(value) ? value : 'http://' + value;
    }

    function getJson(url, timeout, done) {
        var xhr;
        try {
            xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = timeout;
        } catch (e) {
            done(null, 0);
            return;
        }
        xhr.onload = function () {
            var json = null;
            try { json = JSON.parse(xhr.responseText); } catch (e) {}
            done(json, xhr.status);
        };
        xhr.onerror = xhr.ontimeout = function () { done(null, 0); };
        xhr.send();
    }

    function loadShard(number, done) {
        var shard = shards[number];
        if (shard && shard.ready) return done(shard.data);
        if (shard) {
            shard.waiters.push(done);
            return;
        }
        shard = shards[number] = { ready: false, data: {}, waiters: [done] };
        getJson(DATA_BASE + 'voices-' + number + '.json', 10000, function (json) {
            shard.data = json && typeof json === 'object' ? json : {};
            shard.ready = true;
            var waiters = shard.waiters;
            shard.waiters = [];
            for (var w = 0; w < waiters.length; w++) waiters[w](shard.data);
        });
    }

    function flushStatic(ids) {
        var result = {};
        var left = ids.length;
        ids.forEach(function (id) {
            loadShard(Math.floor(Number(id) / SHARD_SIZE), function (data) {
                result[id] = data[id] || { status: 'none' };
                left--;
                if (!left) {
                    onVoices(ids, result);
                    if (voiceWanted.length) scheduleVoices(300);
                }
            });
        });
    }

    function flushVoices() {
        if (!voiceWanted.length) return;
        var ids = voiceWanted.splice(0, VOICE_BATCH);
        var service = voicesService();
        if (!service) return flushStatic(ids);
        getJson(service + '/voices?ids=' + ids.join(','), 10000, function (json, status) {
            if (json && status === 200) onVoices(ids, json);
            if (voiceWanted.length) scheduleVoices(300);
        });
    }

    function onVoices(ids, json) {
        var retry = [];
        for (var k = 0; k < ids.length; k++) {
            var id = ids[k];
            var entry = json[id];
            if (!entry) continue;
            if (entry.status === 'pending') {
                voiceTries[id] = (voiceTries[id] || 0) + 1;
                if (voiceTries[id] < VOICE_RETRIES) retry.push(id);
                continue;
            }
            voiceData[id] = entry;
            applyVoice(id);
        }
        if (retry.length) {
            setTimeout(function () {
                for (var r = 0; r < retry.length; r++) if (voiceWanted.indexOf(retry[r]) === -1) voiceWanted.push(retry[r]);
                scheduleVoices(0);
            }, 3000);
        }
    }

    function cardOf(node) {
        while (node && node.nodeType === 1) {
            if ((' ' + node.className + ' ').indexOf(' torrent-item ') !== -1) return node;
            node = node.parentNode;
        }
        return null;
    }

    function applyVoice(id) {
        var data = voiceData[id];
        if (!data || typeof document === 'undefined') return;
        var nodes = document.querySelectorAll('.uat-voices[data-uat-id="' + id + '"]');
        for (var n = 0; n < nodes.length; n++) {
            if (data.voices && data.voices.length) nodes[n].textContent = data.voices.join(' · ');
            var card = cardOf(nodes[n]);
            var br = card && card.querySelector('.uat-br');
            if (br && data.videoBitrate) br.textContent = ' • ' + data.videoBitrate + ' Мбіт/с';
        }
    }

    function placeholderVoices(i) {
        if (!i.langs || !i.langs.length) return '';
        return (i.tracks > 1 ? i.tracks + '× ' : '') + i.langs.join(' · ');
    }

    function renderTitle(item, el, i) {
        var node = item.find('.torrent-item__title');
        if (!node.length) return;
        var parts = titleParts(el, i, lastMovie);
        var main = [];
        for (var k = 0; k < parts.main.length; k++) main.push(escapeHtml(parts.main[k]));
        node.attr('title', parts.raw);
        node.html('<div class="uat-title"><span class="uat-title__main">' +
            main.join('<span class="uat-title__sep">|</span>') + '</span>' +
            (parts.side.length ? '<span class="uat-title__side">' + escapeHtml(parts.side.join(' · ')) + '</span>' : '') +
            '</div>');
        var id = tolokaId(el);
        if (!id) return;
        var data = voiceData[id];
        var text = data && data.voices && data.voices.length ? data.voices.join(' · ') : placeholderVoices(i);
        node.append('<div class="uat-voices" data-uat-id="' + id + '">' + escapeHtml(text) + '</div>');
        requestVoice(id);
    }

    function fmtSize(gb) {
        if (!gb) return '';
        if (gb >= 1) return (Math.round(gb * 10) / 10) + ' ГБ';
        return Math.round(gb * 1024) + ' МБ';
    }

    function bitrateText(i, el) {
        var data = voiceData[tolokaId(el)];
        if (data && data.videoBitrate) return ' • ' + data.videoBitrate + ' Мбіт/с';
        return i.bitrate ? ' • ≈ ' + i.bitrate + ' Мбіт/с' : '';
    }

    function buildRow(i, rank, el) {
        var meta = escapeHtml(speedText(i.seeds)) + '<span class="uat-br">' + bitrateText(i, el) + '</span>' +
            (i.tracker ? ' • <span class="uat-tracker">' + escapeHtml(i.tracker) + '</span>' : '');
        var right = pill('▲ ' + i.seeds + ' · ▼ ' + i.peers, 'uat-chip--' + stateOf(i.seeds)) + pill(langText(i)) + pill(resText(i.res));
        var topClass = rank < TOP_COUNT ? ' uat-panel--' + stateOf(i.seeds) : '';
        return '<div class="uat-panel' + topClass + '">' +
            '<div class="uat-panel__left">' +
            '<div class="uat-panel__label">' + labelText(rank) + '</div>' +
            '<div class="uat-panel__meta">' + meta + '</div>' +
            '</div>' +
            '<div class="uat-panel__right">' + right + '</div></div>';
    }

    function onRender(e) {
        try {
            var el = e.element;
            var item = e.item;
            if (!el || !item) return;
            var i = el._uatInfo || (el._uatInfo = info(el, lastMovie));
            var rank = el._uatRank === undefined ? 999 : el._uatRank;

            item.find('.uat-panel').remove();
            item.addClass('uat-item');
            renderTitle(item, el, i);
            item.append(buildRow(i, rank, el));
        } catch (err) {
            console.error(NAME, 'render error', err);
        }
    }

    function register() {
        try {
            Lampa.Manifest = Lampa.Manifest || {};
            Lampa.Manifest.plugins = Lampa.Manifest.plugins || {};
            Lampa.Manifest.plugins[ID] = {
                type: 'other',
                name: NAME,
                version: VERSION,
                description: 'Українські плашки торентів і сторінка файлів'
            };
        } catch (err) {
            console.error(NAME, 'register error', err);
        }
        window['plugin_' + ID + '_ready'] = true;
    }

    function pluralEpisodes(n) {
        var m10 = n % 10;
        var m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return n + ' серія';
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' серії';
        return n + ' серій';
    }

    function resetFiles(list) {
        var done = 0;
        list.forEach(function (file) {
            var view = file && file.timeline;
            if (!view || !view.hash) return;
            try {
                view.percent = 0;
                view.time = 0;
                view.duration = 0;
                Lampa.Timeline.update(view);
                if (typeof file.viewed === 'function') file.viewed(0);
                done++;
            } catch (err) {
                console.error(NAME, 'reset error', err);
            }
        });
        return done;
    }

    function addResetMenu(e) {
        var menu = e && e.menu;
        var element = e && e.element;
        if (!menu || !element) return;
        var files = Array.isArray(e.items) ? e.items : [element];
        var enabled = Lampa.Controller.enabled ? Lampa.Controller.enabled().name : 'content';
        var isSeason = typeof element.season === 'number' && !isNaN(element.season);
        var finish = function (list) {
            var n = resetFiles(list);
            Lampa.Noty.show(n ? 'Скинуто тайм-кодів: ' + n : 'Тайм-кодів для скидання немає');
            Lampa.Controller.toggle(enabled);
        };
        var extra = [];
        if (isSeason) {
            var season = files.filter(function (file) { return file.season === element.season; });
            extra.push({
                title: 'Скинути тайм-код сезону',
                subtitle: 'Сезон ' + element.season + ' · ' + pluralEpisodes(season.length),
                onSelect: function () { finish(season); }
            });
        }
        if (isSeason || files.length > 1) {
            extra.push({
                title: isSeason ? 'Скинути тайм-коди всіх сезонів' : 'Скинути тайм-коди всіх файлів',
                subtitle: pluralEpisodes(files.length),
                onSelect: function () { finish(files); }
            });
        }
        if (!extra.length) return;
        var at = -1;
        for (var i = 0; i < menu.length; i++) {
            if (menu[i] && menu[i].timeclear) {
                at = i;
                break;
            }
        }
        menu.splice.apply(menu, [at + 1, 0].concat(extra));
    }

    function addSettings() {
        var params = [{
            param: { name: KEY_VOICES_SERVICE, type: 'input', values: '', 'default': '' },
            field: { name: 'Свій сервіс озвучок', description: 'Необов\'язково. Порожньо — озвучки беруться з репозиторію.' }
        }];
        if (window.WatchPlugins) return window.WatchPlugins.settings('ua-torrent-flow', params);
        if (!Lampa.SettingsApi) return;
        Lampa.SettingsApi.addComponent({ component: 'ua_torrent_flow', name: NAME, icon: '' });
        params.forEach(function (item) {
            item.component = 'ua_torrent_flow';
            Lampa.SettingsApi.addParam(item);
        });
    }

    function init() {
        try { addSettings(); } catch (err) { console.error(NAME, 'settings error', err); }
        injectStyles();
        register();
        if (!hookParser()) {
            var tries = 0;
            var timer = setInterval(function () {
                tries++;
                if (hookParser() || tries > 20) clearInterval(timer);
            }, 500);
        }
        Lampa.Listener.follow('torrent', function (e) {
            if (e.type === 'render') onRender(e);
        });
        Lampa.Listener.follow('torrent_file', function (e) {
            if (e && e.type === 'onlong') {
                try { addResetMenu(e); } catch (err) { console.error(NAME, 'reset menu error', err); }
            }
        });
        console.log(NAME, 'loaded', VERSION);
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') init();
    });
})();

(function () {
    'use strict';

    if (typeof Lampa === 'undefined' || window.__uat_torrent_files) return;
    window.__uat_torrent_files = true;

    var NAME = 'UA Torrent Files';
    var SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
    var ICONS = SCRIPT_SRC.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') + 'icons/';
    var COMPONENT = 'uat_torrent_files';
    var VIEWED_PERCENT = 80;
    var REFRESH_MS = 1500;
    var session = null;
    var flow = null;
    var preload = null;
    var pageActive = false;
    var originalOpen = null;
    var CSS = '.uat-eps{display:flex;flex-direction:column;height:100%;min-height:0;padding:0 1.5em}' +
        '.uat-eps>.scroll{flex:1 1 0;height:auto;min-height:0}' +
        '.uat-tabs{display:flex;flex-shrink:0;gap:.7em;padding:.5em .4em 1em;overflow:hidden;white-space:nowrap;scroll-behavior:smooth}' +
        '.uat-tab{flex-shrink:0;padding:.75em 1.5em;border-radius:100em;background:#292b2b;font-size:.89em;font-weight:600;line-height:1.2}' +
        '.uat-tab--active{background:#fff;color:#1d1f20}' +
        '.uat-tab.focus{box-shadow:0 0 0 .15em #1d1f20,0 0 0 .3em #fff}' +
        '.uat-ep{position:relative;display:flex;align-items:center;height:11.134em;margin:.4em .4em 1.113em}' +
        '.uat-ep::after{content:"";position:absolute;left:-.334em;right:-.334em;top:-.334em;bottom:-.334em;border:.223em solid #fff;border-radius:.89em;opacity:0;pointer-events:none}' +
        '.uat-ep.focus::after{opacity:1}' +
        '.uat-ep-season{display:flex;align-items:center;gap:1.5em;padding-top:.75em;margin:0 .4em 1.25em;font-size:.89em;font-weight:600;line-height:1.2;text-transform:uppercase;color:rgba(255,255,255,.6)}' +
        '.uat-ep-season::after{content:"";flex:1;height:1px;background:#292b2b}' +
        '.uat-ep__media{position:relative;width:19.762em;height:11.134em;flex-shrink:0;border-radius:.668em;overflow:hidden;background:rgba(0,0,0,.3)}' +
        '.uat-ep__img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s}' +
        '.uat-ep__img--loaded{opacity:1}' +
        '.uat-ep__shade{position:absolute;left:0;right:0;bottom:0;padding:.445em .668em;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.8) 100%)}' +
        '.uat-ep__row{display:flex;align-items:center;gap:.75em;min-height:1.2em;font-size:.89em;font-weight:600;line-height:1.2;white-space:nowrap}' +
        '.uat-ep__icon{width:1em;height:1em;flex-shrink:0}' +
        '.uat-ep--loading .uat-ep__icon{width:1.5em;height:1.5em}' +
        '.uat-ep__bar{flex-shrink:0;width:3em;height:.5em;border-radius:100em;background:rgba(255,255,255,.25);overflow:hidden}' +
        '.uat-ep__fill{display:block;height:100%;background:#fff}' +
        '.uat-ep__body{flex:1;min-width:0;height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:.445em;padding:1.113em 2.227em;overflow:hidden}' +
        '.uat-ep__body>*{flex-shrink:0}' +
        '.uat-ep__num{font-size:.89em;font-weight:600;line-height:1.2;opacity:.6;text-transform:uppercase}' +
        '.uat-ep__title{font-size:1.336em;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.uat-ep__descr{height:4.5em;font-size:.89em;font-weight:400;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}' +
        '.uat-ep__meta{display:flex;align-items:center;gap:.75em;font-size:.89em;font-weight:600;line-height:1;opacity:.5}' +
        '.uat-ep__rate{display:flex;align-items:center;gap:.5em}' +
        '.uat-ep__rate img{width:1em;height:1em}' +
        '.uat-eps-empty{padding:3em 1.5em;text-align:center;opacity:.7}' +
        '.uat-eps-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4em 1.5em;text-align:center}' +
        '.uat-eps-loader .modal-loading{width:8em}' +
        '.uat-eps-loader__text{margin-top:1em;opacity:.7}';

    Lampa.Lang.add({
        uat_tf_episode: { en: 'Episode', uk: 'Серія' },
        uat_tf_season: { en: 'Season', uk: 'Сезон' },
        uat_tf_files: { en: 'Files', uk: 'Файли' },
        uat_tf_empty: { en: 'No files', uk: 'Немає файлів' },
        uat_tf_loading: { en: 'Loading torrent…', uk: 'Завантаження торента…' }
    });

    function minutesText(minutes) {
        var m = Math.max(1, Math.round(minutes));
        if (m >= 60) return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
        return m + ' m';
    }

    function etaText(seconds) {
        if (seconds < 90) return '~ ' + Math.max(1, Math.ceil(seconds)) + 's';
        return '~ ' + Math.ceil(seconds / 60) + 'm';
    }

    function dateText(value) {
        if (!value) return '';
        var date = new Date(value);
        if (isNaN(date.getTime())) return '';
        try {
            return date.toLocaleDateString('uk-UA', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (err) {
            return value;
        }
    }

    function groupOf(element) {
        return element.season > 0 && element.episode > 0 ? element.season : 0;
    }

    function episodeMeta(params, element) {
        var season = params.seasons && params.seasons[element.season];
        if (!season || !season.episodes || !element.episode) return null;
        for (var i = 0; i < season.episodes.length; i++) {
            if (season.episodes[i].episode_number == element.episode) return season.episodes[i];
        }
        return null;
    }

    function buildEntries(data) {
        var entries = data.items.map(function (element, index) {
            return { element: element, index: index, group: groupOf(element), meta: episodeMeta(data.params, element), node: null, sig: '', loading: null };
        });
        entries.sort(function (a, b) {
            if (a.group !== b.group) return (a.group || 9999) - (b.group || 9999);
            return (a.element.episode - b.element.episode) || (a.index - b.index);
        });
        return entries;
    }

    function rawStore() {
        var raw = window.localStorage.getItem(Lampa.Timeline.filename());
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    }

    function primeModal() {
        try {
            Lampa.Modal.close();
        } catch (err) {
            originalOpen.call(Lampa.Modal, { title: '', html: $('<div></div>'), size: 'small', onBack: function () {} });
            Lampa.Modal.close();
        }
    }

    function TorrentFiles(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var myFlow = flow;
        var data = null;
        var card = object.movie || {};
        var mode = 'loading';
        var wrapper = $('<div class="uat-eps"><div class="uat-tabs"></div></div>');
        var tabsBox = wrapper.find('.uat-tabs');
        var cards = [];
        var tabs = [];
        var zone = 'list';
        var ci = 0;
        var ti = 0;
        var destroyed = false;
        var timer = null;
        var onVisible = null;
        var lastRaw = null;

        function progressOf(entry) {
            var view = entry.element.timeline;
            if (!view) return null;
            var runtime = entry.meta && entry.meta.runtime ? entry.meta.runtime * 60 : 0;
            var time = Number(view.time) || 0;
            var duration = Number(view.duration) || runtime;
            var percent = Number(view.percent) || 0;
            var rest = 0;
            if (time > 0 && view.duration > 0) rest = view.duration - time;
            else if (percent > 0 && duration) rest = duration * (1 - percent / 100);
            return { percent: percent, duration: duration, rest: rest };
        }

        function stateOf(progress) {
            if (progress && progress.percent >= VIEWED_PERCENT) return 'viewed';
            if (progress && progress.percent > 0) return 'partial';
            return 'new';
        }

        function paint(entry) {
            if (!entry.node) return;
            var progress = progressOf(entry);
            var state = entry.loading ? 'loading' : stateOf(progress);
            var runtime = entry.meta && entry.meta.runtime ? entry.meta.runtime * 60 : 0;
            var duration = (progress && progress.duration) || runtime;
            var icon = 'play.svg';
            var text = '';
            var bar = null;
            if (state === 'loading') {
                icon = 'downloading-loop.svg';
                bar = entry.loading.percent;
                text = entry.loading.percent + '%' + (entry.loading.eta ? ' · ' + entry.loading.eta : '');
            } else if (state === 'viewed') {
                icon = 'replay.svg';
                text = duration ? minutesText(duration / 60) : '';
            } else if (state === 'partial') {
                bar = Math.max(2, Math.min(100, Math.round(progress.percent)));
                text = progress.rest > 0 ? minutesText(progress.rest / 60) : '';
            } else {
                text = duration ? minutesText(duration / 60) : '';
            }
            var sig = state + '|' + text + '|' + (bar === null ? '' : bar);
            if (entry.sig === sig) return;
            entry.sig = sig;
            entry.node.toggleClass('uat-ep--loading', state === 'loading');
            var iconNode = entry.node.find('.uat-ep__icon');
            if (iconNode.attr('data-icon') !== icon) iconNode.attr('data-icon', icon).attr('src', ICONS + icon);
            entry.node.find('.uat-ep__bar').css('display', bar === null ? 'none' : '').find('.uat-ep__fill').css('width', (bar || 0) + '%');
            entry.node.find('.uat-ep__text').text(text);
        }

        function paintAll() {
            cards.forEach(paint);
        }

        function syncViews() {
            try {
                var fresh = rawStore();
                if (fresh) {
                    Lampa.Storage.set(Lampa.Timeline.filename(), fresh);
                    Lampa.Timeline.read(true);
                }
                cards.forEach(function (entry) {
                    var view = entry.element.timeline;
                    if (!view || !view.hash) return;
                    var meta = view.card ? { card: view.card, season: view.season, episode: view.episode } : undefined;
                    var latest = Lampa.Timeline.view(view.hash, meta);
                    view.percent = latest.percent;
                    view.time = latest.time;
                    if (latest.duration) view.duration = latest.duration;
                });
                lastRaw = window.localStorage.getItem(Lampa.Timeline.filename());
            } catch (err) {
                console.error(NAME, 'timeline sync error', err);
            }
            paintAll();
        }

        function markFocus(el) {
            wrapper.find('.focus').removeClass('focus');
            $(el).addClass('focus');
        }

        function focusEl(el) {
            Lampa.Controller.collectionFocus(el, wrapper[0]);
        }

        function firstOfTab(index) {
            for (var i = 0; i < cards.length; i++) if (cards[i].tab === index) return i;
            return 0;
        }

        function activateTab(index) {
            ti = index;
            tabs.forEach(function (tab, i) { tab.node.toggleClass('uat-tab--active', i === index); });
            var node = tabs[index] && tabs[index].node[0];
            if (node) tabsBox[0].scrollLeft = Math.max(0, node.offsetLeft - tabs[0].node[0].offsetLeft);
        }

        function focusCard(index) {
            ci = index;
            zone = 'list';
            focusEl(cards[index].node[0]);
        }

        function focusTab(index) {
            ti = index;
            zone = 'tabs';
            focusEl(tabs[index].node[0]);
        }

        function play(entry) {
            if (preload) return;
            var item = data.nodes[entry.index];
            if (!item) return;
            syncViews();
            preload = { entry: entry, active: false, cancel: null, started: Date.now() };
            item.trigger('hover:enter');
            if (preload && !preload.active) preload = null;
        }

        function menu(entry) {
            if (preload) return;
            var item = data.nodes[entry.index];
            if (item) item.trigger('hover:long');
        }

        function titleOf(entry) {
            if (entry.meta && entry.meta.name) return entry.meta.name;
            return String(entry.element.fname || entry.element.path_human || entry.element.title || '').replace(/^\d+\s\/\s/, '');
        }

        function renderCard(entry, index) {
            var element = entry.element;
            var ep = entry.meta || {};
            var node = $('<div class="uat-ep selector">' +
                '<div class="uat-ep__media"><img class="uat-ep__img" alt="">' +
                '<div class="uat-ep__shade"><div class="uat-ep__row"><img class="uat-ep__icon" alt="">' +
                '<div class="uat-ep__bar"><div class="uat-ep__fill"></div></div><div class="uat-ep__text"></div></div></div></div>' +
                '<div class="uat-ep__body"><div class="uat-ep__num"></div><div class="uat-ep__title"></div>' +
                '<div class="uat-ep__descr"></div><div class="uat-ep__meta"></div></div></div>');
            node.find('.uat-ep__num').text(element.episode > 0 ? Lampa.Lang.translate('uat_tf_episode') + ' ' + element.episode : (element.size || ''));
            node.find('.uat-ep__title').text(titleOf(entry));
            node.find('.uat-ep__descr').text(ep.overview || (element.episode > 0 ? '' : card.overview || ''));
            var meta = node.find('.uat-ep__meta');
            var add = function (part) {
                if (meta.children().length) meta.append('<span>·</span>');
                meta.append(part);
            };
            if (ep.vote_average > 0) add($('<span class="uat-ep__rate"><img alt="" src="' + ICONS + 'star.svg"><span></span></span>').find('span').text(ep.vote_average.toFixed(1)).end());
            var date = dateText(ep.air_date);
            if (date) add($('<span></span>').text(date));
            if (element.episode > 0 && element.size) add($('<span></span>').text(element.size));
            var image = node.find('.uat-ep__img')[0];
            var still = ep.still_path || card.backdrop_path;
            if (still) {
                image.onload = function () { $(image).addClass('uat-ep__img--loaded'); };
                image.src = Lampa.Api.sources.tmdb.img(still, 'w500');
            } else if (element.img && element.img.indexOf('img_broken') === -1) {
                image.onload = function () { $(image).addClass('uat-ep__img--loaded'); };
                image.src = element.img;
            }
            node.on('hover:focus', function () {
                ci = index;
                zone = 'list';
                markFocus(node[0]);
                if (tabs.length && entry.tab !== ti) activateTab(entry.tab);
                scroll.update(node, true);
            });
            node.on('hover:hover hover:touch', function () { focusEl(node[0]); });
            node.on('hover:enter', function () { play(entry); });
            node.on('hover:long', function () { menu(entry); });
            entry.node = node;
            entry.repaint = function () { paint(entry); };
            paint(entry);
            return node;
        }

        function groupTitle(group) {
            return group > 0 ? Lampa.Lang.translate('uat_tf_season') + ' ' + group : Lampa.Lang.translate('uat_tf_files');
        }

        function resetLists() {
            tabsBox.empty();
            scroll.clear();
            cards = [];
            tabs = [];
            ci = 0;
            ti = 0;
            zone = 'list';
        }

        function showLoader() {
            mode = 'loading';
            resetLists();
            tabsBox.css('display', 'none');
            scroll.append($('<div class="uat-eps-loader"><div class="modal-loading"></div><div class="uat-eps-loader__text"></div></div>'));
            wrapper.find('.uat-eps-loader__text').text(Lampa.Lang.translate('uat_tf_loading'));
        }

        function showMessage(text) {
            resetLists();
            tabsBox.css('display', 'none');
            scroll.append($('<div class="uat-eps-empty"></div>').text(text));
        }

        function build() {
            mode = 'files';
            resetLists();
            var entries = buildEntries(data);
            if (!entries.length) return showMessage(Lampa.Lang.translate('uat_tf_empty'));
            var groups = [];
            entries.forEach(function (entry) {
                if (groups.indexOf(entry.group) === -1) groups.push(entry.group);
            });
            var hasTabs = groups.length > 1 || groups[0] > 0;
            tabsBox.css('display', hasTabs ? '' : 'none');
            tabs = hasTabs ? groups.map(function (group, index) {
                var node = $('<div class="uat-tab selector"></div>').text(groupTitle(group));
                node.on('hover:focus', function () {
                    zone = 'tabs';
                    markFocus(node[0]);
                    activateTab(index);
                    ci = firstOfTab(index);
                    scroll.update(cards[ci].node, true);
                });
                node.on('hover:hover hover:touch', function () { focusEl(node[0]); });
                node.on('hover:enter', function () { focusCard(firstOfTab(index)); });
                tabsBox.append(node);
                return { group: group, node: node };
            }) : [];
            cards = entries;
            cards.forEach(function (entry, index) {
                entry.tab = groups.indexOf(entry.group);
                var node = renderCard(entry, index);
                if (hasTabs && (index === 0 || entry.tab !== cards[index - 1].tab)) {
                    scroll.append($('<div class="uat-ep-season"></div>').text(groupTitle(entry.group)));
                }
                scroll.append(node);
            });
            for (var i = 0; i < cards.length; i++) {
                if (stateOf(progressOf(cards[i])) !== 'viewed') {
                    ci = i;
                    break;
                }
            }
            ti = hasTabs ? cards[ci].tab : 0;
            if (hasTabs) activateTab(ti);
            zone = 'list';
        }

        function refocus() {
            if (pageActive && !destroyed) Lampa.Controller.toggle('content');
        }

        function tick() {
            if (destroyed || !cards.length) return;
            var active = Lampa.Controller.enabled ? Lampa.Controller.enabled().name : 'content';
            if (active !== 'content') return;
            if (mode === 'files' && window.localStorage.getItem(Lampa.Timeline.filename()) !== lastRaw) syncViews();
            else paintAll();
        }

        function startTimer() {
            if (!timer) timer = setInterval(tick, REFRESH_MS);
        }

        function stopTimer() {
            if (timer) clearInterval(timer);
            timer = null;
        }

        function cleanup() {
            try {
                if (mode === 'files') {
                    var hash = data && data.items.length && data.items[0].torrent_hash;
                    if (hash) Lampa.Torserver.drop(hash);
                    Lampa.Torserver.clear();
                    Lampa.Listener.send('torrent_file', { type: 'list_close' });
                } else if (myFlow && myFlow.opts && typeof myFlow.opts.onBack === 'function') {
                    var before = Lampa.Controller.enabled ? Lampa.Controller.enabled().name : 'content';
                    primeModal();
                    myFlow.opts.onBack();
                    Lampa.Controller.toggle(before);
                }
            } catch (err) {
                console.error(NAME, 'cleanup error', err);
            }
        }

        this.receive = function (html, snapshot) {
            if (destroyed) return;
            if (html && html.hasClass && html.hasClass('torrent-files') && snapshot) {
                data = snapshot;
                card = data.params.movie || card;
                build();
                if (pageActive) {
                    refocus();
                    paintAll();
                }
            } else {
                mode = 'error';
                var text = html && html.text ? $.trim(html.text().replace(/\s+/g, ' ')) : '';
                showMessage(text || Lampa.Lang.translate('uat_tf_empty'));
                if (pageActive) refocus();
            }
        };

        this.create = function () {
            onVisible = function () {
                if (!destroyed && mode === 'files' && document.visibilityState !== 'hidden') syncViews();
            };
            document.addEventListener('visibilitychange', onVisible);
            window.addEventListener('focus', onVisible);
            files.appendFiles(wrapper);
            wrapper.append(scroll.render());
            showLoader();
            if (myFlow) {
                myFlow.page = self;
                if (myFlow.received) self.receive(myFlow.received.html, myFlow.received.session);
            }
            return this.render();
        };

        this.start = function () {
            pageActive = true;
            if (Lampa.Background && Lampa.Background.immediately && Lampa.Utils.cardImgBackgroundBlur) {
                Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(card));
            }
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(wrapper);
                    if (!cards.length) return Lampa.Controller.collectionFocus(false, wrapper[0]);
                    if (zone === 'tabs' && tabs[ti]) focusEl(tabs[ti].node[0]);
                    else focusEl(cards[ci].node[0]);
                },
                up: function () {
                    if (zone === 'tabs' || !cards.length) return Lampa.Controller.toggle('head');
                    if (ci > 0) focusCard(ci - 1);
                    else if (tabs.length) focusTab(ti);
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (!cards.length) return;
                    if (zone === 'tabs') focusCard(ci);
                    else if (ci < cards.length - 1) focusCard(ci + 1);
                },
                left: function () {
                    if (!cards.length) return Lampa.Controller.toggle('menu');
                    if (ti > 0 && tabs.length) {
                        if (zone === 'tabs') focusTab(ti - 1);
                        else focusCard(firstOfTab(ti - 1));
                    } else {
                        Lampa.Controller.toggle('menu');
                    }
                },
                right: function () {
                    if (!cards.length || !tabs.length || ti >= tabs.length - 1) return;
                    if (zone === 'tabs') focusTab(ti + 1);
                    else focusCard(firstOfTab(ti + 1));
                },
                back: function () {
                    if (preload && preload.cancel) return preload.cancel();
                    Lampa.Activity.backward();
                }
            });
            Lampa.Controller.toggle('content');
            syncViews();
            startTimer();
        };

        this.pause = function () {
            pageActive = false;
            stopTimer();
        };
        this.stop = function () {
            pageActive = false;
            stopTimer();
        };
        this.render = function () { return files.render(); };
        this.destroy = function () {
            if (destroyed) return;
            destroyed = true;
            pageActive = false;
            stopTimer();
            if (onVisible) {
                document.removeEventListener('visibilitychange', onVisible);
                window.removeEventListener('focus', onVisible);
            }
            if (preload && preload.cancel) {
                try { preload.cancel(); } catch (err) { console.error(NAME, 'preload cancel error', err); }
            }
            preload = null;
            cleanup();
            if (flow === myFlow) flow = null;
            scroll.destroy();
            files.destroy();
        };
    }

    function openPage(current) {
        var movie = current.movie || {};
        Lampa.Activity.push({
            url: '',
            title: movie.name || movie.title || '',
            component: COMPONENT,
            movie: movie,
            page: 1
        });
    }

    function hookTorrent() {
        ['start', 'open'].forEach(function (name) {
            var original = Lampa.Torrent[name];
            Lampa.Torrent[name] = function (first, second) {
                flow = { armed: true, opts: null, page: null, received: null, movie: second };
                return original.apply(this, arguments);
            };
        });
    }

    function hookModal() {
        originalOpen = Lampa.Modal.open;
        Lampa.Modal.open = function (params) {
            if (flow && flow.armed) {
                flow.armed = false;
                if (params && params.html && params.html.hasClass && params.html.hasClass('modal-loading')) {
                    flow.opts = params;
                    openPage(flow);
                    return;
                }
            }
            return originalOpen.apply(this, arguments);
        };
        var originalUpdate = Lampa.Modal.update;
        Lampa.Modal.update = function (html) {
            if (flow && flow.opts && !Lampa.Modal.opened()) {
                var snapshot = session;
                if (flow.page) flow.page.receive(html, snapshot);
                else flow.received = { html: html, session: snapshot };
                return;
            }
            return originalUpdate.apply(this, arguments);
        };
    }

    function hookLoading() {
        var loading = Lampa.Loading;
        var start = loading.start;
        var stop = loading.stop;
        var setProgress = loading.setProgress;
        var setText = loading.setText;
        var entryOf = function () { return preload && preload.entry; };
        loading.start = function (cancel, text, opts) {
            if (preload && opts && opts.media) {
                preload.active = true;
                preload.cancel = cancel;
                preload.started = Date.now();
                preload.entry.loading = { percent: 0, eta: '' };
                preload.entry.sig = '';
                repaint(preload.entry);
                return;
            }
            return start.apply(this, arguments);
        };
        loading.stop = function () {
            if (preload && preload.active) {
                var entry = entryOf();
                entry.loading = null;
                entry.sig = '';
                preload = null;
                repaint(entry);
                return;
            }
            return stop.apply(this, arguments);
        };
        loading.setProgress = function (progress) {
            if (preload && preload.active) {
                var entry = entryOf();
                var percent = Math.max(0, Math.min(100, Math.round(progress || 0)));
                var elapsed = (Date.now() - preload.started) / 1000;
                entry.loading = { percent: percent, eta: percent >= 2 && elapsed > 1 ? etaText(elapsed * (100 - percent) / percent) : '' };
                repaint(entry);
                return;
            }
            return setProgress.apply(this, arguments);
        };
        loading.setText = function () {
            if (preload && preload.active) return;
            return setText.apply(this, arguments);
        };
    }

    function repaint(entry) {
        if (entry && entry.repaint) entry.repaint();
    }

    function init() {
        try {
            var style = document.createElement('style');
            style.setAttribute('data-uat-torrent-files', 'true');
            style.innerHTML = CSS;
            document.head.appendChild(style);
        } catch (err) {
            console.error(NAME, 'style error', err);
        }
        Lampa.Component.add(COMPONENT, TorrentFiles);
        hookModal();
        hookTorrent();
        hookLoading();
        Lampa.Listener.follow('torrent_file', function (e) {
            if (!e) return;
            if (e.type === 'list_open') {
                session = { items: e.items || [], params: e.params || {}, nodes: [] };
            } else if (e.type === 'render' && session && e.item) {
                var index = session.items.indexOf(e.element);
                if (index !== -1) session.nodes[index] = e.item;
            } else if (e.type === 'onenter' && pageActive) {
                Lampa.Player.callback(function () { Lampa.Controller.toggle('content'); });
            }
        });
        console.log(NAME, 'loaded');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
