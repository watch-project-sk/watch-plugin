(function () {
    'use strict';

    if (typeof Lampa === 'undefined' || window.__uat_trakt) return;
    window.__uat_trakt = true;

    var NAME = 'Trakt Recommendations';
    var KEY_CLIENT_ID = 'trakt_client_id';
    var KEY_CLIENT_SECRET = 'trakt_client_secret';
    var STORE_PREFIX = 'watch_trakt_';
    var COMPONENT = 'trakt_bridge';
    var SCROBBLE_KEY = 'trakt_bridge_scrobble';
    var RELATED_TIMEOUT = 2500;
    var TMDB_PARALLEL = 4;
    var ROW_LIMIT = 20;
    var GENRE_MIN = 5;
    var IMPORT_PERCENT = 80;
    var IMPORT_CHUNK = 300;
    var ICON_MODULE = 62;
    var REPLAY_ICON = '<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M4 3.5v4.6h4.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var BRAND_RED = '#ed1c24';
    var FIRE_ORANGE = '#fd4518';
    var HIDDEN_TITLES = ['title_trend_day', 'title_trend_week', 'title_upcoming', 'title_now_watch'];
    var REPLACED_TITLES = ['title_popular_movie', 'title_popular_tv'];
    var ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="4"/><path d="M15 24l6 6 12-13" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ATTRIBUTION = 'Плагін використовує Trakt, але не схвалений і не сертифікований Trakt.';
    var ERRORS = {
        expired: 'Код прострочено, спробуйте ще раз.',
        denied: 'Вхід відхилено в Trakt.',
        already_used: 'Цей код уже використано, спробуйте ще раз.',
        invalid_code: 'Код недійсний, спробуйте ще раз.'
    };
    var GENRE_SLUGS = {
        28: ['action'], 12: ['adventure'], 16: ['animation'], 35: ['comedy'], 80: ['crime'], 99: ['documentary'],
        18: ['drama'], 10751: ['family'], 14: ['fantasy'], 36: ['history'], 27: ['horror'], 10402: ['music'],
        9648: ['mystery'], 10749: ['romance'], 878: ['science-fiction'], 10770: ['tv-movie'], 53: ['thriller'],
        10752: ['war'], 37: ['western'], 10759: ['action', 'adventure'], 10762: ['children'], 10763: ['news'],
        10764: ['reality'], 10765: ['science-fiction', 'fantasy'], 10766: ['soap'], 10767: ['talk-show'], 10768: ['war']
    };

    var status = { configured: false, connected: false };
    var bridgeOk = true;
    var tmdbCache = {};
    var tmdbQueue = [];
    var tmdbActive = 0;
    var loginTimer = null;
    var watchKeys = {};
    var scrobble = { current: null, percent: 0, playing: false, paused: false };

    function debug() {
        if (window.trakt_debug && window.console) console.log.apply(console, ['[Trakt]'].concat(Array.prototype.slice.call(arguments)));
    }

    var client = null;

    function xhrHttp(method, url, headers, body) {
        return new Promise(function (resolve) {
            var xhr;
            try {
                xhr = new XMLHttpRequest();
                xhr.open(method, url, true);
                xhr.timeout = 15000;
                Object.keys(headers).forEach(function (name) { xhr.setRequestHeader(name, headers[name]); });
            } catch (e) {
                resolve({ status: 0, text: '' });
                return;
            }
            xhr.onload = function () {
                resolve({ status: xhr.status, text: xhr.responseText, retryAfter: Number(xhr.getResponseHeader('Retry-After')) || 0 });
            };
            xhr.onerror = xhr.ontimeout = function () { resolve({ status: 0, text: '' }); };
            xhr.send(body);
        });
    }

    var store = {
        get: function (key) {
            try { return JSON.parse(window.localStorage.getItem(STORE_PREFIX + key)); } catch (e) { return null; }
        },
        set: function (key, value) {
            try { window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value)); } catch (e) {}
        },
        remove: function (key) {
            try { window.localStorage.removeItem(STORE_PREFIX + key); } catch (e) {}
        }
    };

    function ensureClient() {
        if (client) return client;
        if (typeof window.WatchTraktClient !== 'function' || typeof Promise === 'undefined') return null;
        client = window.WatchTraktClient({
            http: xhrHttp,
            storage: store,
            credentials: function () {
                return {
                    id: Lampa.Storage.get(KEY_CLIENT_ID, ''),
                    secret: Lampa.Storage.get(KEY_CLIENT_SECRET, '')
                };
            }
        });
        return client;
    }

    function credentialsChanged() {
        var c = ensureClient();
        if (c) c.reload();
        refreshStatus(function () {
            if (Lampa.Settings && Lampa.Settings.update) Lampa.Settings.update();
        });
    }

    function request(method, path, done, body) {
        var c = ensureClient();
        if (!c) {
            done(null);
            return;
        }
        var promise;
        try {
            promise = c.handle(method, path, body);
        } catch (e) {
            done(null);
            return;
        }
        promise.then(function (result) {
            done(result.code >= 200 && result.code < 300 ? result.body : null);
        }, function () { done(null); });
    }

    function refreshStatus(done) {
        request('GET', '/auth/status', function (json) {
            bridgeOk = Boolean(json && json.configured);
            if (json) status = json;
            if (done) done(status);
        });
    }

    function sprite(name) {
        return '<svg><use xlink:href="#sprite-' + name + '"></use></svg>';
    }

    function tmdbUrl(type, id) {
        var lang = Lampa.Storage.get('language') || 'uk';
        return Lampa.TMDB.api(type + '/' + id + '?api_key=' + Lampa.TMDB.key() + '&language=' + lang);
    }

    function pumpTmdb() {
        while (tmdbActive < TMDB_PARALLEL && tmdbQueue.length) {
            var job = tmdbQueue.shift();
            tmdbActive++;
            (function (job) {
                var network = new Lampa.Reguest();
                var finish = function (card) {
                    tmdbActive--;
                    if (card) tmdbCache[job.key] = card;
                    job.done(card || null);
                    pumpTmdb();
                };
                network.silent(tmdbUrl(job.type, job.id), function (json) {
                    if (json && json.id) {
                        json.source = 'tmdb';
                        finish(json);
                    } else finish(null);
                }, function () { finish(null); });
            })(job);
        }
    }

    function tmdbCard(type, id, done) {
        var key = type + ':' + id;
        if (tmdbCache[key]) return done(tmdbCache[key]);
        tmdbQueue.push({ key: key, type: type, id: id, done: done });
        pumpTmdb();
    }

    function toCards(items, done) {
        var list = (items || []).slice(0, ROW_LIMIT);
        var cards = new Array(list.length);
        var left = list.length;
        if (!left) return done([]);
        list.forEach(function (item, index) {
            tmdbCard(item.type === 'show' ? 'tv' : 'movie', item.tmdb, function (card) {
                cards[index] = card;
                left--;
                if (!left) done(cards.filter(Boolean));
            });
        });
    }

    function loadRecommendations(type, done) {
        request('GET', '/recommendations?type=' + type + '&shuffle=1', function (json) {
            if (!json || !json.connected || !json.items || !json.items.length) return done([]);
            toCards(json.items, done);
        });
    }

    function loadGenreRecommendations(method, slugs, exclude, done) {
        var path = '/recommendations?type=' + (method === 'tv' ? 'shows' : 'movies') + '&genres=' + slugs.join(',') + '&exclude=' + exclude;
        request('GET', path, function (json) {
            if (!json || !json.connected || !json.items || !json.items.length) return done([]);
            toCards(json.items, done);
        });
    }

    function loadRelated(type, tmdb, done) {
        request('GET', '/related?type=' + type + '&tmdb=' + tmdb, function (json) {
            if (!json || !json.items || !json.items.length) return done([]);
            toCards(json.items, done);
        });
    }

    function loadTrending(type, done) {
        request('GET', '/trending?type=' + type, function (json) {
            if (!json || !json.items || !json.items.length) return done([]);
            toCards(json.items, done);
        });
    }

    function loadList(path, done) {
        request('GET', path, function (json) {
            if (!json || !json.connected || !json.items || !json.items.length) return done([], json);
            toCards(json.items, function (cards) { done(cards, json); });
        });
    }

    function refreshWatchlist(done) {
        request('GET', '/watchlist', function (json) {
            var keys = {};
            if (json && json.items) json.items.forEach(function (item) { keys[item.type + ':' + item.tmdb] = true; });
            if (json && json.connected) watchKeys = keys;
            if (done) done();
        });
    }

    function addRows() {
        if (!Lampa.ContentRows || typeof Lampa.ContentRows.add !== 'function') {
            console.warn(NAME, 'ContentRows not available');
            return;
        }
        var rows = [
            { name: 'trakt_trending_movies', list: '/trending?type=movies&limit=100', title: 'Фільми в тренді · Trakt', index: 2, icon: 'fire', bg: '#fff', color: FIRE_ORANGE, load: function (cb) { loadTrending('movies', cb); } },
            { name: 'trakt_trending_shows', list: '/trending?type=shows&limit=100', title: 'Серіали в тренді · Trakt', index: 3, icon: 'fire', bg: '#fff', color: FIRE_ORANGE, load: function (cb) { loadTrending('shows', cb); } },
            { name: 'trakt_watchlist', list: '/watchlist', title: 'Мій список Trakt', index: 4, icon: 'favorite', bg: BRAND_RED, color: '#fff', load: function (cb) { loadList('/watchlist', cb); } },
            { name: 'trakt_movies', list: '/recommendations?type=movies&limit=100', title: 'Фільми для вас · Trakt', index: 5, icon: 'star', bg: BRAND_RED, color: '#fff', load: function (cb) { loadRecommendations('movies', cb); } },
            { name: 'trakt_shows', list: '/recommendations?type=shows&limit=100', title: 'Серіали для вас · Trakt', index: 6, icon: 'tv', bg: BRAND_RED, color: '#fff', load: function (cb) { loadRecommendations('shows', cb); } },
            { name: 'trakt_rewatch', list: '/rewatch', title: 'Дивитися ще раз · Trakt', index: 7, svg: REPLAY_ICON, bg: BRAND_RED, color: '#fff', load: function (cb) { loadList('/rewatch', cb); } },
            { name: 'trakt_calendar', list: '/calendar', title: 'Нові серії ваших серіалів · Trakt', index: 8, icon: 'calendar', bg: BRAND_RED, color: '#fff', load: function (cb) { loadList('/calendar', cb); } }
        ];
        rows.forEach(function (row) {
            Lampa.ContentRows.add({
                name: row.name,
                title: row.title,
                index: row.index,
                screen: ['main'],
                call: function () {
                    return function (call) {
                        try {
                            row.load(function (results) {
                                if (results && results.length) {
                                    call({
                                        title: row.title,
                                        results: results,
                                        total_pages: 2,
                                        uat_more: { path: row.list },
                                        icon_svg: row.svg || sprite(row.icon),
                                        icon_bgcolor: row.bg,
                                        icon_color: row.color,
                                        params: { module: ICON_MODULE }
                                    });
                                } else call();
                            });
                        } catch (e) {
                            console.error(NAME, 'row error', e);
                            call();
                        }
                    };
                }
            });
        });
    }

    function openList(data) {
        Lampa.Activity.push({
            url: '',
            title: data.title,
            component: 'trakt_list',
            page: 1,
            uat_path: data.uat_more.path
        });
    }

    function patchRouter() {
        var router = Lampa.Router;
        if (!router || typeof router.call !== 'function' || router._uatTrakt) return;
        var original = router.call;
        router.call = function (name, data) {
            if (name === 'category_full' && data && data.uat_more && data.uat_more.path) {
                try {
                    openList(data);
                    return undefined;
                } catch (e) {
                    console.error(NAME, 'list open error', e);
                }
            }
            return original.apply(this, arguments);
        };
        router._uatTrakt = true;
    }

    function TraktList(object) {
        var comp = new Lampa.InteractionCategory(object);
        var items = null;
        var pages = function () { return Math.max(1, Math.ceil(items.length / ROW_LIMIT)); };
        var slice = function (page, done) {
            toCards(items.slice((page - 1) * ROW_LIMIT, page * ROW_LIMIT), done);
        };
        var next = function (obj, resolve, reject) {
            var page = (obj && obj.page) || 2;
            if (!items || page > pages()) return reject();
            slice(page, function (cards) {
                if (!cards.length) return reject();
                resolve({ results: cards, total_pages: pages(), total_results: items.length });
            });
        };
        comp.create = function () {
            var self = this;
            this.activity.loader(true);
            request('GET', object.uat_path, function (json) {
                items = (json && json.items) || [];
                if (!items.length) {
                    self.build({ page: 1, results: [], total_pages: 1, total_results: 0 });
                    self.activity.loader(false);
                    return;
                }
                slice(1, function (cards) {
                    self.build({ page: 1, results: cards, total_pages: pages(), total_results: items.length });
                    self.activity.loader(false);
                });
            });
            return this.render();
        };
        comp.nextPageReuest = next;
        comp.nextPageRequest = next;
        return comp;
    }

    function hiddenLine(line) {
        if (!line) return false;
        var titles = HIDDEN_TITLES.concat(bridgeOk ? REPLACED_TITLES : []);
        for (var i = 0; i < titles.length; i++) {
            if (line.title === Lampa.Lang.translate(titles[i])) return true;
        }
        return false;
    }

    function dropSections(data) {
        return Array.isArray(data) ? data.filter(function (line) { return !hiddenLine(line); }) : data;
    }

    function patchMain() {
        var api = Lampa.Api;
        if (!api || typeof api.main !== 'function' || api._uatTraktMain) return;
        var original = api.main;
        api.main = function (params, oncomplite, onerror) {
            if (typeof oncomplite !== 'function') return original.apply(this, arguments);
            var next = original.call(this, params, function (data) {
                return oncomplite.call(this, dropSections(data));
            }, onerror);
            if (typeof next === 'function') {
                return function (ok, fail) {
                    return next(function (data) {
                        return ok.call(this, dropSections(data));
                    }, fail);
                };
            }
            return next;
        };
        api._uatTraktMain = true;
    }

    function genreInfo(movie) {
        var slugs = [];
        var names = [];
        ((movie && movie.genres) || []).forEach(function (g) {
            (GENRE_SLUGS[g.id] || []).forEach(function (slug) {
                if (slugs.indexOf(slug) === -1) slugs.push(slug);
            });
            if (g.name && names.length < 3) names.push(g.name);
        });
        return { slugs: slugs, names: names };
    }

    function fixTitle(target, title) {
        try {
            Object.defineProperty(target, 'title', { get: function () { return title; }, set: function () {}, configurable: true, enumerable: true });
        } catch (e) {
            target.title = title;
        }
    }

    function patchFull() {
        var api = Lampa.Api;
        if (!api || typeof api.full !== 'function' || api._uatTrakt) return;
        var original = api.full;
        api.full = function (params, oncomplite, onerror) {
            var method = params && params.method;
            var id = params && params.id;
            var source = params && params.source;
            if ((method !== 'movie' && method !== 'tv') || !/^\d{1,9}$/.test(String(id)) ||
                (source && source !== 'tmdb' && source !== 'cub') || typeof oncomplite !== 'function') {
                return original.apply(this, arguments);
            }
            var related = null;
            var genre = null;
            var held = null;
            var done = false;
            var timer = null;
            var ready = function () {
                return related !== null && genre !== null;
            };
            var finish = function () {
                if (done || !held) return;
                done = true;
                clearTimeout(timer);
                try {
                    if (held.data && held.data.movie) {
                        var relatedOk = related && related.length;
                        var relatedIds = {};
                        (related || []).forEach(function (card) { relatedIds[card.id] = true; });
                        var genreCards = genre ? genre.cards.filter(function (card) { return !relatedIds[card.id]; }) : [];
                        var genreOk = genreCards.length >= GENRE_MIN;
                        var genreRow = null;
                        if (genreOk) {
                            genreRow = { results: genreCards, total_pages: 1 };
                            fixTitle(genreRow, 'Для вас: ' + genre.names.join(' · '));
                        }
                        if (relatedOk) {
                            var relatedRow = { results: related, total_pages: 1 };
                            fixTitle(relatedRow, Lampa.Lang.translate('title_similar'));
                            held.data.recomend = relatedRow;
                            held.data.simular = genreRow || undefined;
                        } else if (genreRow) {
                            held.data.simular = genreRow;
                        }
                    }
                } catch (e) {
                    console.error(NAME, 'replace error', e);
                }
                oncomplite.call(held.ctx, held.data);
            };
            try {
                loadRelated(method === 'tv' ? 'show' : 'movie', id, function (results) {
                    related = results;
                    if (ready()) finish();
                });
            } catch (e) {
                related = [];
            }
            return original.call(this, params, function (data) {
                held = { ctx: this, data: data };
                var info = genreInfo(data && data.movie);
                if (!info.slugs.length) genre = { cards: [], names: [] };
                else {
                    try {
                        loadGenreRecommendations(method, info.slugs, id, function (cards) {
                            genre = { cards: cards, names: info.names };
                            if (ready()) finish();
                        });
                    } catch (e) {
                        genre = { cards: [], names: [] };
                    }
                }
                if (ready()) finish();
                else timer = setTimeout(finish, RELATED_TIMEOUT);
            }, onerror);
        };
        api._uatTrakt = true;
    }

    function scrobbleOn() {
        var v = Lampa.Storage.get(SCROBBLE_KEY, true);
        return v !== false && v !== 'false' && status.connected;
    }

    function parseCard(card, season, episode) {
        var m = /^(movie|tv)_(\d+)$/i.exec(String(card || ''));
        if (!m) return null;
        var kind = m[1].toLowerCase();
        var meta = { kind: kind, tmdb: parseInt(m[2], 10) };
        if (kind === 'tv') {
            meta.season = parseInt(season, 10);
            meta.episode = parseInt(episode, 10);
            if (isNaN(meta.season) || isNaN(meta.episode) || meta.season < 0 || meta.episode < 1) return null;
        }
        meta.key = kind + '_' + meta.tmdb + (kind === 'tv' ? '_' + meta.season + '_' + meta.episode : '');
        return meta;
    }

    function metaFromPlay(data) {
        if (!data) return null;
        var link = data.timeline || {};
        var season = link.season !== undefined ? link.season : data.season;
        var episode = link.episode !== undefined ? link.episode : data.episode;
        var meta = parseCard(link.card, season, episode);
        if (!meta) {
            var movie = data.movie || (data.card && typeof data.card === 'object' ? data.card : null);
            if (movie && movie.id && (!movie.source || movie.source === 'tmdb' || movie.source === 'cub')) {
                meta = parseCard((movie.original_name ? 'tv_' : 'movie_') + movie.id, season, episode);
            }
        }
        if (meta && link.hash) meta.hash = link.hash;
        return meta;
    }

    function scrobbleSend(action, meta, progress) {
        var pct = Math.max(0, Math.min(100, Math.round((progress || 0) * 10) / 10));
        var path = '/scrobble?action=' + action + '&type=' + (meta.kind === 'movie' ? 'movie' : 'episode') + '&tmdb=' + meta.tmdb + '&progress=' + pct;
        if (meta.kind === 'tv') path += '&season=' + meta.season + '&episode=' + meta.episode;
        debug('scrobble', action, meta.key, pct);
        request('POST', path, function () {});
    }

    function scrobbleBegin(meta, percent) {
        scrobble.current = meta;
        scrobble.percent = percent || 0;
        scrobble.paused = false;
        scrobbleSend('start', meta, scrobble.percent);
    }

    function scrobbleEnd() {
        var meta = scrobble.current;
        scrobble.current = null;
        if (meta) scrobbleSend('stop', meta, scrobble.percent);
    }

    function onTimeline(e) {
        if (!scrobble.playing || !scrobbleOn() || !e || e.target !== 'timeline' || e.reason !== 'update' || !e.data || !e.data.road) return;
        var road = e.data.road;
        var percent = Number(road.percent) || 0;
        var meta = road.card ? parseCard(road.card, road.season, road.episode) : null;
        if (scrobble.current) {
            if (meta && meta.key !== scrobble.current.key) {
                scrobbleEnd();
                scrobbleBegin(meta, percent);
            } else if (!scrobble.current.hash || scrobble.current.hash === e.data.hash || meta) {
                scrobble.percent = percent;
            }
        } else if (meta) {
            scrobbleBegin(meta, percent);
        }
    }

    function initScrobble() {
        if (Lampa.Player && Lampa.Player.listener) {
            Lampa.Player.listener.follow('start', function (data) {
                scrobble.playing = true;
                scrobble.current = null;
                scrobble.percent = 0;
                if (!scrobbleOn()) return;
                var meta = metaFromPlay(data);
                var link = (data && data.timeline) || {};
                if (meta) scrobbleBegin(meta, Number(link.percent) || 0);
            });
            Lampa.Player.listener.follow('destroy', function () {
                if (scrobble.playing) scrobbleEnd();
                scrobble.playing = false;
            });
        }
        if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
            Lampa.PlayerVideo.listener.follow('pause', function () {
                if (scrobble.playing && scrobble.current && !scrobble.paused) {
                    scrobble.paused = true;
                    scrobbleSend('pause', scrobble.current, scrobble.percent);
                }
            });
            Lampa.PlayerVideo.listener.follow('play', function () {
                if (scrobble.playing && scrobble.current && scrobble.paused) {
                    scrobble.paused = false;
                    scrobbleSend('start', scrobble.current, scrobble.percent);
                }
            });
        }
        Lampa.Listener.follow('state:changed', onTimeline);
    }

    function isoDate(value) {
        var t = Number(value);
        if (!t) return undefined;
        if (t < 100000000000) t *= 1000;
        if (t < 946684800000 || t > Date.now() + 86400000) return undefined;
        return new Date(t).toISOString();
    }

    function collectHistory() {
        var out = { movies: [], episodes: [] };
        var store = {};
        try { store = Lampa.Storage.get(Lampa.Timeline.filename(), '{}') || {}; } catch (e) {}
        if (typeof store === 'string') {
            try { store = JSON.parse(store); } catch (e) { store = {}; }
        }
        var seen = {};
        Object.keys(store).forEach(function (hash) {
            var road = store[hash];
            if (!road || typeof road !== 'object' || !road.card || (Number(road.percent) || 0) < IMPORT_PERCENT) return;
            var meta = parseCard(road.card, road.season, road.episode);
            if (!meta || seen[meta.key]) return;
            seen[meta.key] = true;
            if (meta.kind === 'movie') out.movies.push({ tmdb: meta.tmdb, watched_at: isoDate(road.updated) });
            else out.episodes.push({ tmdb: meta.tmdb, season: meta.season, episode: meta.episode, watched_at: isoDate(road.updated) });
        });
        return out;
    }

    function importHistory() {
        if (!status.connected) {
            Lampa.Noty.show('Спочатку увійдіть у Trakt');
            return;
        }
        var all = collectHistory();
        var parts = [];
        for (var i = 0; i < all.movies.length; i += IMPORT_CHUNK) parts.push({ movies: all.movies.slice(i, i + IMPORT_CHUNK), episodes: [] });
        for (var j = 0; j < all.episodes.length; j += IMPORT_CHUNK) parts.push({ movies: [], episodes: all.episodes.slice(j, j + IMPORT_CHUNK) });
        if (!parts.length) {
            Lampa.Noty.show('У Лампі немає переглянутого з прив\'язкою до карток (≥ ' + IMPORT_PERCENT + '%)');
            return;
        }
        Lampa.Noty.show('Імпорт у Trakt: ' + all.movies.length + ' фільмів, ' + all.episodes.length + ' серій…');
        var total = { movies: 0, episodes: 0, notFound: 0 };
        var step = function () {
            var part = parts.shift();
            if (!part) {
                Lampa.Noty.show('Додано в Trakt: ' + total.movies + ' фільмів, ' + total.episodes + ' серій' + (total.notFound ? ' (не знайдено: ' + total.notFound + ')' : ''));
                return;
            }
            request('POST', '/history/import', function (json) {
                if (!json || !json.ok) {
                    Lampa.Noty.show('Імпорт перервано: Trakt не відповів');
                    return;
                }
                total.movies += json.added.movies;
                total.episodes += json.added.episodes;
                total.notFound += json.added.notFound;
                step();
            }, part, 90000);
        };
        step();
    }

    function watchlistOption(e) {
        var movie = e && e.props && e.props.get ? e.props.get('movie') : null;
        if (!status.connected || !movie || !movie.id) return;
        var kind = movie.original_name ? 'show' : 'movie';
        var key = kind + ':' + movie.id;
        var inList = Boolean(watchKeys[key]);
        e.options.push({
            title: inList ? 'Прибрати зі списку Trakt' : 'Додати в список Trakt',
            onSelect: function () {
                request('POST', '/watchlist?action=' + (inList ? 'remove' : 'add') + '&type=' + kind + '&tmdb=' + movie.id, function (json) {
                    if (json && json.ok) {
                        if (inList) delete watchKeys[key];
                        else watchKeys[key] = true;
                        Lampa.Noty.show(inList ? 'Прибрано зі списку Trakt' : 'Додано в список Trakt');
                    } else Lampa.Noty.show('Не вдалося змінити список Trakt');
                    refreshWatchlist();
                });
            }
        });
    }

    var FAVORITE_WHERE = ['book', 'like', 'wath', 'history'];

    function isFavoriteItem(item) {
        return Boolean(item && item.checkbox && FAVORITE_WHERE.indexOf(item.where) !== -1);
    }

    function isStatusItem(item) {
        return Boolean(item && (item.collect || (item.separator && item.title === Lampa.Lang.translate('settings_cub_status'))));
    }

    function focusedCard() {
        var el = document.querySelector('.card.focus');
        return el && el.card_data ? el.card_data : null;
    }

    function cardKind(card) {
        return card.original_name ? 'show' : 'movie';
    }

    function usableCard(card) {
        return Boolean(card && /^\d{1,9}$/.test(String(card.id)) && (!card.source || card.source === 'tmdb' || card.source === 'cub'));
    }

    function traktAction(card, back, path, ok, fail, after) {
        request('POST', path, function (json) {
            Lampa.Noty.show(json && json.ok ? ok : (json && json.error === 'not_found' ? 'Trakt не знайшов цей тайтл' : fail));
            if (json && json.ok && after) after();
            Lampa.Controller.toggle(back);
        });
    }

    function traktMenuItems(card, back) {
        var kind = cardKind(card);
        var key = kind + ':' + card.id;
        var inList = Boolean(watchKeys[key]);
        var query = '&type=' + kind + '&tmdb=' + card.id;
        return [
            { title: 'Trakt', separator: true },
            {
                title: inList ? 'Прибрати зі списку Trakt' : 'Додати в список Trakt',
                onSelect: function () {
                    traktAction(card, back, '/watchlist?action=' + (inList ? 'remove' : 'add') + query,
                        inList ? 'Прибрано зі списку Trakt' : 'Додано в список Trakt', 'Не вдалося змінити список Trakt',
                        function () {
                            if (inList) delete watchKeys[key];
                            else watchKeys[key] = true;
                        });
                }
            },
            {
                title: 'Позначити як переглянуто',
                subtitle: kind === 'show' ? 'Усі серії серіалу' : '',
                onSelect: function () {
                    traktAction(card, back, '/watched?' + query.slice(1), 'Позначено переглянутим у Trakt', 'Не вдалося позначити в Trakt',
                        function () { delete watchKeys[key]; });
                }
            },
            {
                title: 'Не рекомендувати',
                onSelect: function () {
                    traktAction(card, back, '/hide?' + query.slice(1), 'Trakt більше не рекомендуватиме це', 'Не вдалося сховати рекомендацію');
                }
            }
        ];
    }

    function reshapeCardMenu(params) {
        if (!params || params.title !== Lampa.Lang.translate('title_action') || !Array.isArray(params.items)) return params;
        var items = params.items;
        var first = -1;
        var last = -1;
        var hasFavorite = false;
        items.forEach(function (item, i) {
            var fav = isFavoriteItem(item);
            if (fav) hasFavorite = true;
            if (fav || isStatusItem(item)) {
                if (first < 0) first = i;
                last = i;
            }
        });
        if (!hasFavorite) return params;
        var headerAt = first > 0 && items[first - 1] && items[first - 1].separator && !isStatusItem(items[first - 1]) ? first - 1 : first;
        var before = items.slice(0, headerAt);
        var block = items.slice(headerAt, last + 1).filter(function (item) { return !isStatusItem(item); });
        var after = items.slice(last + 1);
        var card = focusedCard();
        var back = Lampa.Controller.enabled ? Lampa.Controller.enabled().name : 'content';
        var trakt = status.connected && usableCard(card) ? traktMenuItems(card, back) : [];
        var out = {};
        for (var key in params) {
            if (Object.prototype.hasOwnProperty.call(params, key)) out[key] = params[key];
        }
        out.items = trakt.concat(before, block, after);
        return out;
    }

    function patchCardMenu() {
        var select = Lampa.Select;
        if (!select || typeof select.show !== 'function' || select._uatTraktMenu) return;
        var original = select.show;
        select.show = function (params) {
            var next = params;
            try {
                next = reshapeCardMenu(params);
            } catch (err) {
                console.error(NAME, 'card menu error', err);
            }
            return original.call(this, next);
        };
        select._uatTraktMenu = true;
    }

    function statusText(s) {
        if (!s.configured) return 'Не налаштовано: вкажіть Client ID вашого Trakt-додатка.';
        if (s.connected) return 'Підключено' + (s.user ? ': ' + s.user : '');
        return 'Не підключено';
    }

    function stopLogin() {
        if (loginTimer) clearInterval(loginTimer);
        loginTimer = null;
    }

    function backToSettings() {
        stopLogin();
        Lampa.Modal.close();
        Lampa.Controller.toggle('settings_component');
    }

    function openLogin() {
        request('POST', '/auth/start', function (json) {
            if (!json || !json.pending) {
                Lampa.Noty.show(json && !json.configured ? statusText(json) : 'Не вдалося почати вхід у Trakt.');
                return;
            }
            var p = json.pending;
            var html = $('<div class="about" style="text-align:center">' +
                '<div style="margin-bottom:1em">Відкрийте на телефоні чи комп\'ютері</div>' +
                '<div style="font-size:1.4em;margin-bottom:0.6em">' + p.verificationUrl + '</div>' +
                '<div style="margin-bottom:0.4em">і введіть код</div>' +
                '<div style="font-size:2.6em;font-weight:700;letter-spacing:0.15em;margin-bottom:1em">' + p.userCode + '</div>' +
                '<div class="trakt-qr" style="display:inline-block;background:#fff;padding:0.6em;border-radius:0.6em;width:12em;height:12em"></div>' +
                '<div class="trakt-login-status" style="margin-top:1em;opacity:0.7">Чекаю підтвердження…</div>' +
                '</div>');
            Lampa.Modal.open({ title: 'Вхід у Trakt', html: html, size: 'medium', onBack: backToSettings });
            setTimeout(function () {
                var box = html.find('.trakt-qr');
                if (Lampa.Utils && Lampa.Utils.qrcode) Lampa.Utils.qrcode(p.verificationUrl, box, function () { box.remove(); });
                else box.remove();
            }, 100);
            stopLogin();
            loginTimer = setInterval(function () {
                refreshStatus(function (s) {
                    if (s.connected) {
                        backToSettings();
                        Lampa.Noty.show(statusText(s));
                        refreshWatchlist();
                        if (Lampa.Settings && Lampa.Settings.update) Lampa.Settings.update();
                    } else if (!s.pending) {
                        stopLogin();
                        html.find('.trakt-login-status').text(ERRORS[s.lastError] || 'Вхід не завершено, спробуйте ще раз.');
                    }
                });
            }, 5000);
        });
    }

    function logout() {
        request('POST', '/auth/logout', function (json) {
            if (json) status = json;
            watchKeys = {};
            Lampa.Noty.show(json ? 'Ви вийшли з Trakt' : 'Не вдалося вийти з Trakt');
            if (Lampa.Settings && Lampa.Settings.update) Lampa.Settings.update();
        });
    }

    function addSettings() {
        if (!Lampa.SettingsApi || typeof Lampa.SettingsApi.addComponent !== 'function') return;
        var shared = Boolean(window.WatchPlugins);
        if (!shared) Lampa.SettingsApi.addComponent({ component: COMPONENT, name: 'Trakt', icon: ICON });
        var addParam = function (item) {
            if (shared) {
                window.WatchPlugins.settings('trakt', [item]);
            } else {
                item.component = COMPONENT;
                Lampa.SettingsApi.addParam(item);
            }
        };
        addParam({
            param: { name: KEY_CLIENT_ID, type: 'input', values: '', 'default': '' },
            field: { name: 'Client ID', description: 'Створіть власний додаток на trakt.tv/oauth/applications з redirect URI urn:ietf:wg:oauth:2.0:oob.' },
            onChange: credentialsChanged
        });
        addParam({
            param: { name: KEY_CLIENT_SECRET, type: 'input', values: '', 'default': '' },
            field: { name: 'Client Secret', description: 'Зберігається лише на цьому пристрої.' },
            onChange: credentialsChanged
        });
        addParam({
            param: { name: 'trakt_bridge_status', type: 'static' },
            field: { name: 'Статус', description: '…' },
            onRender: function (item) {
                refreshStatus(function (s) {
                    item.find('.settings-param__descr').text(statusText(s));
                });
            }
        });
        addParam({
            param: { name: 'trakt_bridge_login', type: 'button' },
            field: { name: 'Увійти в Trakt', description: 'Вхід через код підтвердження. Токени зберігаються лише на цьому пристрої.' },
            onChange: openLogin
        });
        addParam({
            param: { name: 'trakt_bridge_logout', type: 'button' },
            field: { name: 'Вийти з Trakt' },
            onChange: logout
        });
        addParam({
            param: { name: SCROBBLE_KEY, type: 'trigger', 'default': true },
            field: { name: 'Відстежувати перегляди', description: 'Надсилати в Trakt, що ви дивитесь, і відмічати переглянутим при виході з плеєра на 80% і більше.' }
        });
        addParam({
            param: { name: 'trakt_bridge_import', type: 'button' },
            field: { name: 'Імпортувати історію Лампи', description: 'Відправити в Trakt усе, що в Лампі переглянуто на 90% і більше.' },
            onChange: importHistory
        });
        addParam({
            param: { name: 'trakt_bridge_about', type: 'static' },
            field: { name: 'Про Trakt', description: ATTRIBUTION }
        });
    }

    function init() {
        try { addSettings(); } catch (e) { console.error(NAME, 'settings error', e); }
        try { addRows(); } catch (e) { console.error(NAME, 'rows error', e); }
        try { patchFull(); } catch (e) { console.error(NAME, 'full error', e); }
        try { patchMain(); } catch (e) { console.error(NAME, 'main error', e); }
        try { patchCardMenu(); } catch (e) { console.error(NAME, 'menu error', e); }
        try {
            Lampa.Component.add('trakt_list', TraktList);
            patchRouter();
        } catch (e) { console.error(NAME, 'list error', e); }
        try { initScrobble(); } catch (e) { console.error(NAME, 'scrobble error', e); }
        try {
            Lampa.Listener.follow('full', function (e) {
                if (e && e.type === 'options') {
                    try { watchlistOption(e); } catch (err) { console.error(NAME, 'watchlist option error', err); }
                }
            });
        } catch (e) { console.error(NAME, 'full listener error', e); }
        refreshStatus(function (s) { if (s.connected) refreshWatchlist(); });
        console.log(NAME, 'loaded');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
