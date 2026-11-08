(function () {
    'use strict';

    if (typeof Lampa === 'undefined' || window.__uat_torrent_flow) return;
    window.__uat_torrent_flow = true;

    var ID = 'ua_torrent_flow';
    var NAME = 'UA Torrent Flow';
    var VERSION = '2.2.0';
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
