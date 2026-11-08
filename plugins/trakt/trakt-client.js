(function (root) {
    'use strict';

    var API = 'https://api.trakt.tv';
    var REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
    var REFRESH_MARGIN = 24 * 3600 * 1000;
    var REC_TTL = 2 * 3600 * 1000;
    var RELATED_TTL = 7 * 24 * 3600 * 1000;
    var EMPTY_TTL = 24 * 3600 * 1000;
    var WATCHLIST_TTL = 10 * 60 * 1000;
    var TRENDING_TTL = 3 * 3600 * 1000;
    var TRENDING_LIMIT = 30;
    var TRENDING_FETCH = 100;
    var MAX_LIST = 100;
    var REWATCH_MIN_RATING = 6;
    var REWATCH_TTL = 30 * 60 * 1000;
    var REWATCH_LIMIT = 200;
    var CALENDAR_TTL = 3600 * 1000;
    var CALENDAR_BACK = 7;
    var CALENDAR_AHEAD = 7;
    var REC_FETCH_LIMIT = 100;
    var GENRE_LIMIT = 20;
    var IMPORT_BATCH = 100;
    var IMPORT_MAX = 5000;
    var POST_GAP_MS = 1000;
    var CONCURRENCY = 2;
    var REC_LIMIT = 30;
    var RELATED_LIMIT = 20;
    var SHUFFLE_BIAS = 25;
    var CACHE_MAX_BYTES = 300000;
    var HARD_GENRES = ['animation', 'anime', 'documentary', 'children', 'reality', 'talk-show', 'news', 'soap'];

    function int(value, min, max) {
        var n = Number(value);
        return isFinite(n) && Math.floor(n) === n && n >= min && n <= max ? n : null;
    }

    function findBy(list, test) {
        for (var i = 0; i < list.length; i++) if (test(list[i])) return list[i];
        return null;
    }

    function chunk(list, size) {
        var out = [];
        for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
        return out;
    }

    function parsePath(path) {
        var at = path.indexOf('?');
        var name = at < 0 ? path : path.slice(0, at);
        var query = {};
        if (at >= 0) {
            path.slice(at + 1).split('&').forEach(function (pair) {
                if (!pair) return;
                var eq = pair.indexOf('=');
                var key = eq < 0 ? pair : pair.slice(0, eq);
                var value = eq < 0 ? '' : pair.slice(eq + 1);
                try {
                    query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
                } catch (e) {}
            });
        }
        return { name: name, query: query };
    }

    function create(env) {
        var http = env.http;
        var storage = env.storage;
        var sleep = env.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
        var now = env.now || function () { return new Date().getTime(); };
        var random = env.random || Math.random;

        var cache = {};
        var cacheTimer = null;
        var tokens = null;
        var pending = null;
        var lastError = null;
        var refreshing = null;
        var active = 0;
        var waiters = [];
        var postChain = Promise.resolve();

        function credentials() {
            var c = env.credentials ? env.credentials() : {};
            return { id: String((c && c.id) || '').replace(/^\s+|\s+$/g, ''), secret: String((c && c.secret) || '').replace(/^\s+|\s+$/g, '') };
        }

        function configured() {
            return Boolean(credentials().id);
        }

        function loadTokens() {
            var saved = storage.get('tokens');
            tokens = saved && saved.access_token && saved.client === credentials().id ? saved : null;
        }

        function saveTokens() {
            if (tokens) storage.set('tokens', tokens);
            else storage.remove('tokens');
        }

        function loadCache() {
            var saved = storage.get('cache');
            cache = saved && typeof saved === 'object' ? saved : {};
        }

        function saveCacheNow() {
            cacheTimer = null;
            var keys = Object.keys(cache);
            var text = JSON.stringify(cache);
            if (text.length > CACHE_MAX_BYTES) {
                keys.sort(function (a, b) { return cache[a].until - cache[b].until; });
                while (keys.length && JSON.stringify(cache).length > CACHE_MAX_BYTES) delete cache[keys.shift()];
            }
            storage.set('cache', cache);
        }

        function scheduleSave() {
            if (cacheTimer) return;
            cacheTimer = setTimeout(saveCacheNow, 2000);
        }

        function cacheGet(key) {
            var entry = cache[key];
            if (!entry || now() > entry.until) return null;
            return entry.value;
        }

        function cacheSet(key, value, ttl) {
            cache[key] = { value: value, until: now() + ttl };
            scheduleSave();
        }

        function cacheDrop(prefix) {
            Object.keys(cache).forEach(function (key) {
                if (key.indexOf(prefix) === 0) delete cache[key];
            });
            scheduleSave();
        }

        function slot() {
            if (active < CONCURRENCY) {
                active++;
                return Promise.resolve();
            }
            return new Promise(function (resolve) { waiters.push(resolve); });
        }

        function release() {
            var next = waiters.shift();
            if (next) next();
            else active--;
        }

        function withSecret(body) {
            var secret = credentials().secret;
            if (!secret) return body;
            var out = {};
            Object.keys(body).forEach(function (key) { out[key] = body[key]; });
            out.client_secret = secret;
            return out;
        }

        function trakt(method, route, options) {
            var opts = options || {};
            var attempt = 0;

            function run() {
                return slot().then(function () {
                    var headers = {
                        'Content-Type': 'application/json',
                        'trakt-api-version': '2',
                        'trakt-api-key': credentials().id
                    };
                    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
                    var body = opts.body ? JSON.stringify(opts.body) : undefined;
                    return http(method, API + route, headers, body).then(function (res) {
                        release();
                        return res;
                    }, function () {
                        release();
                        return { status: 0, text: '' };
                    });
                }).then(function (res) {
                    if (res.status === 429 && !opts.noRetry && attempt < 2) {
                        var wait = Math.min(Number(res.retryAfter) || Math.pow(2, attempt), 30);
                        attempt++;
                        return sleep(wait * 1000).then(run);
                    }
                    var json = null;
                    try { json = res.text ? JSON.parse(res.text) : null; } catch (e) {}
                    return { status: res.status, json: json };
                });
            }

            return run();
        }

        function storeTokens(json, user) {
            var created = Number(json.created_at) ? Number(json.created_at) * 1000 : now();
            tokens = {
                access_token: json.access_token,
                refresh_token: json.refresh_token,
                expires_at: created + Number(json.expires_in || 0) * 1000,
                user: user || (tokens && tokens.user) || null,
                client: credentials().id
            };
            saveTokens();
        }

        function refreshTokens() {
            if (!tokens) return Promise.resolve(null);
            if (refreshing) return refreshing;
            refreshing = trakt('POST', '/oauth/token', {
                noRetry: true,
                body: withSecret({
                    refresh_token: tokens.refresh_token,
                    client_id: credentials().id,
                    redirect_uri: REDIRECT_URI,
                    grant_type: 'refresh_token'
                })
            }).then(function (res) {
                if (res.status === 200 && res.json && res.json.access_token) {
                    storeTokens(res.json);
                } else if (res.status === 400 || res.status === 401) {
                    tokens = null;
                    saveTokens();
                    cacheDrop('rec:');
                }
                refreshing = null;
                return tokens;
            }, function () {
                refreshing = null;
                return tokens;
            });
            return refreshing;
        }

        function accessToken() {
            if (!tokens) return Promise.resolve(null);
            var step = tokens.expires_at - now() < REFRESH_MARGIN ? refreshTokens() : Promise.resolve();
            return step.then(function () { return tokens ? tokens.access_token : null; });
        }

        function fetchUser(token) {
            return trakt('GET', '/users/settings', { token: token }).then(function (res) {
                var user = res.json && res.json.user;
                return user ? (user.username || (user.ids && user.ids.slug) || null) : null;
            });
        }

        function pollDevice(state) {
            var interval = state.interval;

            function tick() {
                if (pending !== state) return Promise.resolve();
                return sleep(interval * 1000).then(function () {
                    if (pending !== state) return null;
                    if (now() > state.expiresAt) {
                        pending = null;
                        lastError = 'expired';
                        return null;
                    }
                    return trakt('POST', '/oauth/device/token', {
                        noRetry: true,
                        body: withSecret({ code: state.deviceCode, client_id: credentials().id })
                    }).then(function (res) {
                        if (pending !== state) return null;
                        if (res.status === 200 && res.json && res.json.access_token) {
                            return fetchUser(res.json.access_token).then(function (user) {
                                storeTokens(res.json, user);
                                cacheDrop('rec:');
                                pending = null;
                                lastError = null;
                            });
                        }
                        if (res.status === 400 || res.status === 0) return tick();
                        if (res.status === 429) {
                            interval += 1;
                            return tick();
                        }
                        var reasons = { 404: 'invalid_code', 409: 'already_used', 410: 'expired', 418: 'denied' };
                        pending = null;
                        lastError = reasons[res.status] || 'http_' + res.status;
                        return null;
                    });
                });
            }

            return tick();
        }

        function startDevice() {
            if (pending && now() < pending.expiresAt) return Promise.resolve({ ok: true });
            return trakt('POST', '/oauth/device/code', { body: { client_id: credentials().id } }).then(function (res) {
                if (res.status !== 200 || !res.json || !res.json.device_code) {
                    lastError = 'device_code_' + res.status;
                    return { ok: false, error: lastError };
                }
                var state = {
                    deviceCode: res.json.device_code,
                    userCode: res.json.user_code,
                    verificationUrl: res.json.verification_url,
                    expiresAt: now() + Number(res.json.expires_in || 600) * 1000,
                    interval: Number(res.json.interval || 5)
                };
                pending = state;
                lastError = null;
                pollDevice(state).then(null, function () {
                    if (pending === state) pending = null;
                    lastError = 'poll_failed';
                });
                return { ok: true };
            });
        }

        function logout() {
            pending = null;
            var done = tokens ? trakt('POST', '/oauth/revoke', {
                noRetry: true,
                body: withSecret({ token: tokens.access_token, client_id: credentials().id })
            }) : Promise.resolve();
            return done.then(function () {
                tokens = null;
                saveTokens();
                cacheDrop('rec:');
            });
        }

        function status() {
            return {
                configured: configured(),
                connected: Boolean(tokens),
                user: tokens ? tokens.user : null,
                expiresAt: tokens ? tokens.expires_at : null,
                pending: pending ? { userCode: pending.userCode, verificationUrl: pending.verificationUrl, expiresAt: pending.expiresAt } : null,
                lastError: lastError
            };
        }

        function mapItems(list, kind, type) {
            if (!Array.isArray(list)) return [];
            var out = [];
            list.forEach(function (raw) {
                var item = raw && kind && raw[kind] ? raw[kind] : raw;
                var tmdb = item && item.ids && Number(item.ids.tmdb);
                if (tmdb && !findBy(out, function (x) { return x.tmdb === tmdb; })) {
                    var mapped = { tmdb: tmdb, type: type, title: item.title || '', year: item.year || null };
                    if (Array.isArray(item.genres)) mapped.genres = item.genres.map(function (g) { return String(g).toLowerCase(); });
                    out.push(mapped);
                }
            });
            return out;
        }

        function plain(items) {
            return items.map(function (x) { return { tmdb: x.tmdb, type: x.type, title: x.title, year: x.year }; });
        }

        function authedRequest(method, route, body) {
            return accessToken().then(function (token) {
                if (!token) return { connected: false, res: null };
                return trakt(method, route, { token: token, body: body }).then(function (res) {
                    if (res.status !== 401) return { connected: true, res: res };
                    return refreshTokens().then(function () {
                        var again = tokens ? tokens.access_token : null;
                        if (!again) return { connected: false, res: null };
                        return trakt(method, route, { token: again, body: body }).then(function (second) {
                            return { connected: true, res: second };
                        });
                    });
                });
            });
        }

        function authedGet(route) {
            return authedRequest('GET', route);
        }

        function authedPost(route, body, method) {
            var run = postChain.then(function () { return authedRequest(method || 'POST', route, body); });
            var gap = function () { return sleep(POST_GAP_MS); };
            postChain = run.then(gap, gap);
            return run;
        }

        function weightedSample(list, count) {
            return list
                .map(function (item, index) { return { item: item, key: Math.pow(random(), 1 + index / SHUFFLE_BIAS) }; })
                .sort(function (a, b) { return b.key - a.key; })
                .slice(0, count)
                .map(function (x) { return x.item; });
        }

        function recommendationPool(type, genres) {
            var key = 'rec:' + (genres.length ? 'genre:' + type + ':' + genres.slice().sort().join(',') : 'full:' + type);
            var pool = cacheGet(key);
            if (pool) return Promise.resolve({ pool: pool });
            var filter = genres.length ? '&genres=' + genres.join(',') : '';
            var route = '/recommendations/' + type + '?limit=' + REC_FETCH_LIMIT + '&extended=full&ignore_collected=true&ignore_watchlisted=true' + filter;
            return authedGet(route).then(function (got) {
                if (!got.connected) return { connected: false };
                if (got.res.status !== 200) return { error: 'http_' + got.res.status };
                var list = mapItems(got.res.json, null, type === 'movies' ? 'movie' : 'show');
                cacheSet(key, list, list.length ? REC_TTL : EMPTY_TTL / 4);
                return { pool: list };
            });
        }

        function genreMatches(pool, wanted, exclude) {
            var hard = wanted.filter(function (g) { return HARD_GENRES.indexOf(g) !== -1; });
            var soft = wanted.filter(function (g) { return HARD_GENRES.indexOf(g) === -1; });
            var need = Math.min(2, soft.length);
            var scored = [];
            pool.forEach(function (item, index) {
                if (item.tmdb === exclude) return;
                var genres = item.genres || [];
                if (hard.some(function (g) { return genres.indexOf(g) === -1; })) return;
                if (!hard.length && genres.some(function (g) { return HARD_GENRES.indexOf(g) !== -1; })) return;
                var shared = soft.filter(function (g) { return genres.indexOf(g) !== -1; }).length;
                if (shared < need) return;
                scored.push({ item: item, shared: shared, index: index });
            });
            scored.sort(function (a, b) { return b.shared - a.shared || a.index - b.index; });
            return scored.map(function (x) { return x.item; });
        }

        function recommendations(type, opts) {
            var options = opts || {};
            var wanted = options.genres || [];
            var hard = wanted.filter(function (g) { return HARD_GENRES.indexOf(g) !== -1; });
            var queryGenres = wanted.length ? (hard.length ? hard : wanted) : [];
            return recommendationPool(type, queryGenres).then(function (got) {
                if (got.connected === false) return { connected: false, items: [] };
                if (got.error) return { connected: Boolean(tokens), items: [], error: got.error };
                if (!wanted.length) {
                    var count = options.limit || REC_LIMIT;
                    return { connected: true, items: plain(options.shuffle ? weightedSample(got.pool, count) : got.pool.slice(0, count)) };
                }
                return { connected: true, items: plain(genreMatches(got.pool, wanted, options.exclude)).slice(0, options.limit || GENRE_LIMIT) };
            });
        }

        function errorOf(a, b) {
            return 'http_' + (a.res.status !== 200 ? a.res.status : b.res && b.res.status);
        }

        function rewatch() {
            var key = 'rec:rewatch';
            var cached = cacheGet(key);
            if (cached) return Promise.resolve({ connected: true, items: cached });
            return Promise.all([authedGet('/sync/ratings/movies'), authedGet('/sync/ratings/shows')]).then(function (pair) {
                var rm = pair[0];
                var rs = pair[1];
                if (!rm.connected) return { connected: false, items: [] };
                if (rm.res.status !== 200 || !rs.res || rs.res.status !== 200) return { connected: true, items: [], error: errorOf(rm, rs) };
                var rows = [];
                [['movie', rm.res.json], ['show', rs.res.json]].forEach(function (entry) {
                    var type = entry[0];
                    (Array.isArray(entry[1]) ? entry[1] : []).forEach(function (row) {
                        var item = row && row[type];
                        var tmdb = item && item.ids && Number(item.ids.tmdb);
                        var rating = Number(row && row.rating);
                        if (!tmdb || !(rating >= REWATCH_MIN_RATING)) return;
                        rows.push({ tmdb: tmdb, type: type, title: item.title || '', year: item.year || null, rating: rating, at: String(row.rated_at || '') });
                    });
                });
                rows.sort(function (a, b) { return b.rating - a.rating || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0); });
                var seen = {};
                var unique = rows.filter(function (x) {
                    var k = x.type + ':' + x.tmdb;
                    if (seen[k]) return false;
                    seen[k] = true;
                    return true;
                });
                var ordered = [];
                for (var i = 0; i < unique.length;) {
                    var j = i;
                    while (j < unique.length && unique[j].rating === unique[i].rating) j++;
                    var group = unique.slice(i, j);
                    var lanes = {
                        movie: group.filter(function (x) { return x.type === 'movie'; }),
                        show: group.filter(function (x) { return x.type === 'show'; })
                    };
                    var turn = group[0].type;
                    while (lanes.movie.length || lanes.show.length) {
                        var lane = lanes[turn].length ? turn : (turn === 'movie' ? 'show' : 'movie');
                        ordered.push(lanes[lane].shift());
                        turn = lane === 'movie' ? 'show' : 'movie';
                    }
                    i = j;
                }
                var items = ordered.slice(0, REWATCH_LIMIT).map(function (x) { return { tmdb: x.tmdb, type: x.type, title: x.title, year: x.year }; });
                cacheSet(key, items, items.length ? REWATCH_TTL : REWATCH_TTL / 3);
                return { connected: true, items: items };
            });
        }

        function scrobble(action, kind, tmdb, season, episode, progress) {
            var body = kind === 'movie'
                ? { movie: { ids: { tmdb: tmdb } }, progress: progress }
                : { show: { ids: { tmdb: tmdb } }, episode: { season: season, number: episode }, progress: progress };
            return authedPost('/scrobble/' + action, body).then(function (got) {
                if (!got.connected) return { ok: false, connected: false };
                var code = got.res.status;
                if (code === 200 || code === 201 || code === 409) {
                    if (action === 'stop' && progress >= 80) {
                        cacheDrop('rec:');
                        cacheDrop('cal:');
                        cacheDrop('wl:');
                    }
                    return { ok: true, connected: true };
                }
                return { ok: false, connected: true, error: code === 404 ? 'not_found' : 'http_' + code };
            });
        }

        function watchedAt(value) {
            var t = Date.parse(value);
            return isFinite(t) ? new Date(t).toISOString() : undefined;
        }

        function importHistory(input) {
            var movies = (input.movies || []).map(function (m) { return { ids: { tmdb: m.tmdb }, watched_at: watchedAt(m.watched_at) }; });
            var episodes = input.episodes || [];
            var total = { movies: 0, episodes: 0, notFound: 0, batches: 0 };
            var batches = [];
            chunk(movies, IMPORT_BATCH).forEach(function (part) { batches.push({ movies: part }); });
            chunk(episodes, IMPORT_BATCH).forEach(function (part) {
                var shows = {};
                part.forEach(function (e) {
                    var show = shows[e.tmdb] || (shows[e.tmdb] = { ids: { tmdb: e.tmdb }, seasons: {} });
                    var season = show.seasons[e.season] || (show.seasons[e.season] = { number: e.season, episodes: [] });
                    season.episodes.push({ number: e.episode, watched_at: watchedAt(e.watched_at) });
                });
                batches.push({
                    shows: Object.keys(shows).map(function (id) {
                        return { ids: shows[id].ids, seasons: Object.keys(shows[id].seasons).map(function (n) { return shows[id].seasons[n]; }) };
                    })
                });
            });
            var index = 0;

            function next() {
                if (index >= batches.length) {
                    cacheDrop('rec:');
                    cacheDrop('cal:');
                    return Promise.resolve({ ok: true, connected: true, added: total });
                }
                return authedPost('/sync/history', batches[index++]).then(function (got) {
                    if (!got.connected) return { ok: false, connected: false };
                    if (got.res.status !== 201 && got.res.status !== 200) return { ok: false, connected: true, error: 'http_' + got.res.status, added: total };
                    var json = got.res.json || {};
                    total.batches++;
                    total.movies += Number(json.added && json.added.movies) || 0;
                    total.episodes += Number(json.added && json.added.episodes) || 0;
                    var nf = json.not_found || {};
                    ['movies', 'shows', 'seasons', 'episodes'].forEach(function (k) { total.notFound += Array.isArray(nf[k]) ? nf[k].length : 0; });
                    return next();
                });
            }

            return next();
        }

        function watchlist() {
            var cached = cacheGet('wl:all');
            if (cached) return Promise.resolve({ connected: true, items: cached });
            return Promise.all([authedGet('/sync/watchlist/movies/added'), authedGet('/sync/watchlist/shows/added')]).then(function (pair) {
                var m = pair[0];
                var s = pair[1];
                if (!m.connected) return { connected: false, items: [] };
                if (m.res.status !== 200 || !s.res || s.res.status !== 200) return { connected: true, items: [], error: errorOf(m, s) };
                var rows = [];
                (Array.isArray(m.res.json) ? m.res.json : []).forEach(function (r) { rows.push({ at: r.listed_at, item: r.movie, type: 'movie' }); });
                (Array.isArray(s.res.json) ? s.res.json : []).forEach(function (r) { rows.push({ at: r.listed_at, item: r.show, type: 'show' }); });
                rows.sort(function (a, b) { var x = String(a.at); var y = String(b.at); return x < y ? 1 : x > y ? -1 : 0; });
                var typed = [];
                rows.forEach(function (r) {
                    var tmdb = r.item && r.item.ids && Number(r.item.ids.tmdb);
                    if (tmdb && !findBy(typed, function (x) { return x.tmdb === tmdb && x.type === r.type; })) {
                        typed.push({ tmdb: tmdb, type: r.type, title: r.item.title || '', year: r.item.year || null });
                    }
                });
                cacheSet('wl:all', typed, WATCHLIST_TTL);
                return { connected: true, items: typed };
            });
        }

        function watchlistChange(action, kind, tmdb) {
            var key = kind === 'movie' ? 'movies' : 'shows';
            var body = {};
            body[key] = [{ ids: { tmdb: tmdb } }];
            return authedPost(action === 'add' ? '/sync/watchlist' : '/sync/watchlist/remove', body).then(function (got) {
                if (!got.connected) return { ok: false, connected: false };
                if (got.res.status !== 200 && got.res.status !== 201) return { ok: false, connected: true, error: 'http_' + got.res.status };
                cacheDrop('wl:');
                cacheDrop('rec:');
                var json = got.res.json || {};
                var nf = json.not_found && json.not_found[key];
                var missing = Array.isArray(nf) && nf.length;
                return { ok: !missing, connected: true, error: missing ? 'not_found' : undefined };
            });
        }

        function dayString(offsetDays) {
            return new Date(now() + offsetDays * 86400000).toISOString().slice(0, 10);
        }

        function calendar() {
            var cached = cacheGet('cal:all');
            if (cached) return Promise.resolve({ connected: true, items: cached });
            return authedGet('/calendars/my/shows/' + dayString(-CALENDAR_BACK) + '/' + (CALENDAR_BACK + CALENDAR_AHEAD)).then(function (got) {
                if (!got.connected) return { connected: false, items: [] };
                if (got.res.status !== 200) return { connected: true, items: [], error: 'http_' + got.res.status };
                var rows = (Array.isArray(got.res.json) ? got.res.json : []).slice();
                rows.sort(function (a, b) { var x = String(a.first_aired); var y = String(b.first_aired); return x < y ? 1 : x > y ? -1 : 0; });
                var items = [];
                rows.forEach(function (r) {
                    var tmdb = r.show && r.show.ids && Number(r.show.ids.tmdb);
                    if (!tmdb || findBy(items, function (x) { return x.tmdb === tmdb; })) return;
                    items.push({ tmdb: tmdb, type: 'show', title: r.show.title || '', season: r.episode && r.episode.season, episode: r.episode && r.episode.number, airedAt: r.first_aired || null });
                });
                var out = items.slice(0, 30);
                cacheSet('cal:all', out, CALENDAR_TTL);
                return { connected: true, items: out };
            });
        }

        function trending(type, limit) {
            var key = 'trend:' + type;
            var cached = cacheGet(key);
            if (cached) return Promise.resolve({ items: cached.slice(0, limit || TRENDING_LIMIT) });
            var kind = type === 'movies' ? 'movie' : 'show';
            return trakt('GET', '/' + type + '/trending?limit=' + TRENDING_FETCH).then(function (res) {
                if (res.status !== 200) return { items: [], error: 'http_' + res.status };
                var items = plain(mapItems(res.json, kind, kind));
                cacheSet(key, items, items.length ? TRENDING_TTL : EMPTY_TTL / 4);
                return { items: items.slice(0, limit || TRENDING_LIMIT) };
            });
        }

        function traktIdFor(type, tmdb) {
            var key = 'tid:' + type + ':' + tmdb;
            var cached = cacheGet(key);
            if (cached) return Promise.resolve(cached);
            return trakt('GET', '/search/tmdb/' + tmdb + '?type=' + type).then(function (lookup) {
                if (lookup.status !== 200) return null;
                var hit = Array.isArray(lookup.json) ? findBy(lookup.json, function (x) { return x && x.type === type && x[type]; }) : null;
                var id = hit && hit[type].ids && (hit[type].ids.trakt || hit[type].ids.slug);
                if (id) cacheSet(key, String(id), RELATED_TTL);
                return id ? String(id) : null;
            });
        }

        function markWatched(type, tmdb) {
            var key = type === 'movie' ? 'movies' : 'shows';
            var body = {};
            body[key] = [{ ids: { tmdb: tmdb } }];
            return authedPost('/sync/history', body).then(function (got) {
                if (!got.connected) return { ok: false, connected: false };
                if (got.res.status !== 200 && got.res.status !== 201) return { ok: false, connected: true, error: 'http_' + got.res.status };
                var json = got.res.json || {};
                var nf = json.not_found && json.not_found[key];
                if (Array.isArray(nf) && nf.length) return { ok: false, connected: true, error: 'not_found' };
                cacheDrop('rec:');
                cacheDrop('cal:');
                cacheDrop('wl:');
                var added = json.added || {};
                return { ok: true, connected: true, added: type === 'movie' ? Number(added.movies) || 0 : Number(added.episodes) || 0 };
            });
        }

        function hideRecommendation(type, tmdb) {
            return traktIdFor(type, tmdb).then(function (id) {
                if (!id) return { ok: false, connected: Boolean(tokens), error: 'not_found' };
                return authedPost('/recommendations/' + type + 's/' + encodeURIComponent(id), undefined, 'DELETE').then(function (got) {
                    if (!got.connected) return { ok: false, connected: false };
                    if (got.res.status !== 204 && got.res.status !== 200) return { ok: false, connected: true, error: got.res.status === 404 ? 'not_found' : 'http_' + got.res.status };
                    cacheDrop('rec:');
                    return { ok: true, connected: true };
                });
            });
        }

        function related(type, tmdb) {
            var key = 'rel:' + type + ':' + tmdb;
            var cached = cacheGet(key);
            if (cached) return Promise.resolve({ items: cached });
            return trakt('GET', '/search/tmdb/' + tmdb + '?type=' + type).then(function (lookup) {
                if (lookup.status !== 200) return { items: [], error: 'http_' + lookup.status };
                var hit = Array.isArray(lookup.json) ? findBy(lookup.json, function (x) { return x && x.type === type && x[type]; }) : null;
                var id = hit && hit[type].ids && (hit[type].ids.trakt || hit[type].ids.slug);
                if (!id) {
                    cacheSet(key, [], EMPTY_TTL);
                    return { items: [] };
                }
                return trakt('GET', '/' + type + 's/' + id + '/related?limit=' + RELATED_LIMIT).then(function (res) {
                    if (res.status !== 200) return { items: [], error: 'http_' + res.status };
                    var items = mapItems(res.json, null, type).filter(function (x) { return x.tmdb !== Number(tmdb); });
                    cacheSet(key, items, items.length ? RELATED_TTL : EMPTY_TTL);
                    return { items: items };
                });
            });
        }

        function cleanImport(body) {
            if (!body || typeof body !== 'object') return null;
            var movies = [];
            var episodes = [];
            (Array.isArray(body.movies) ? body.movies : []).forEach(function (m) {
                var tmdb = int(m && m.tmdb, 1, 999999999);
                if (tmdb) movies.push({ tmdb: tmdb, watched_at: m.watched_at });
            });
            (Array.isArray(body.episodes) ? body.episodes : []).forEach(function (e) {
                var tmdb = int(e && e.tmdb, 1, 999999999);
                var season = int(e && e.season, 0, 99);
                var episode = int(e && e.episode, 1, 9999);
                if (tmdb && season !== null && episode) episodes.push({ tmdb: tmdb, season: season, episode: episode, watched_at: e.watched_at });
            });
            if (movies.length + episodes.length > IMPORT_MAX) return null;
            return { movies: movies, episodes: episodes };
        }

        function reply(code, body) {
            return Promise.resolve({ code: code, body: body });
        }

        function ok(promise) {
            return promise.then(function (body) { return { code: 200, body: body }; });
        }

        function handle(method, path, body) {
            var parsed = parsePath(path);
            var q = parsed.query;
            var route = method + ' ' + parsed.name;

            if (route === 'GET /auth/status') return reply(200, status());
            if (!configured()) {
                if (route === 'GET /recommendations') return reply(200, { connected: false, items: [] });
                if (route === 'GET /related' || route === 'GET /trending') return reply(200, { items: [] });
                if (route === 'GET /watchlist' || route === 'GET /calendar' || route === 'GET /rewatch') return reply(200, { connected: false, items: [] });
                return reply(503, { error: 'not_configured' });
            }
            if (route === 'POST /auth/start') {
                return startDevice().then(function (result) {
                    var merged = status();
                    if (!result.ok) merged.error = result.error;
                    return { code: result.ok ? 200 : 502, body: merged };
                });
            }
            if (route === 'POST /auth/logout') return logout().then(function () { return { code: 200, body: status() }; });
            if (route === 'GET /recommendations') {
                var type = q.type;
                if (type !== 'movies' && type !== 'shows') return reply(400, { error: 'type must be movies or shows' });
                var genres = (q.genres || '').split(',').map(function (g) { return g.trim().toLowerCase(); }).filter(Boolean);
                if (genres.length > 8 || genres.some(function (g) { return !/^[a-z-]{2,30}$/.test(g); })) return reply(400, { error: 'invalid genres' });
                if (q.exclude && !/^\d{1,9}$/.test(q.exclude)) return reply(400, { error: 'invalid exclude' });
                if (q.limit && int(q.limit, 1, MAX_LIST) === null) return reply(400, { error: 'invalid limit' });
                return ok(recommendations(type, { genres: genres, exclude: q.exclude ? Number(q.exclude) : null, limit: q.limit ? Number(q.limit) : null, shuffle: q.shuffle === '1' }));
            }
            if (route === 'POST /scrobble') {
                var action = q.action;
                var kind = q.type;
                var tmdb = int(q.tmdb, 1, 999999999);
                var progress = Number(q.progress);
                var season = kind === 'episode' ? int(q.season, 0, 99) : null;
                var episode = kind === 'episode' ? int(q.episode, 1, 9999) : null;
                var okKind = kind === 'movie' || (kind === 'episode' && season !== null && episode);
                if (['start', 'pause', 'stop'].indexOf(action) === -1 || !okKind || !tmdb || !(progress >= 0 && progress <= 100)) {
                    return reply(400, { error: 'invalid scrobble parameters' });
                }
                return ok(scrobble(action, kind, tmdb, season, episode, progress));
            }
            if (route === 'POST /history/import') {
                var clean = cleanImport(body);
                if (!clean) return reply(400, { error: 'invalid import body' });
                if (!clean.movies.length && !clean.episodes.length) return reply(200, { ok: true, connected: Boolean(tokens), added: { movies: 0, episodes: 0, notFound: 0, batches: 0 } });
                return ok(importHistory(clean));
            }
            if (route === 'GET /trending') {
                if (q.type !== 'movies' && q.type !== 'shows') return reply(400, { error: 'type must be movies or shows' });
                if (q.limit && int(q.limit, 1, MAX_LIST) === null) return reply(400, { error: 'invalid limit' });
                return ok(trending(q.type, q.limit ? Number(q.limit) : null));
            }
            if (route === 'GET /watchlist') return ok(watchlist());
            if (route === 'POST /watchlist') {
                var wAction = q.action;
                var wKind = q.type;
                var wTmdb = int(q.tmdb, 1, 999999999);
                if ((wAction !== 'add' && wAction !== 'remove') || (wKind !== 'movie' && wKind !== 'show') || !wTmdb) {
                    return reply(400, { error: 'invalid watchlist parameters' });
                }
                return ok(watchlistChange(wAction, wKind, wTmdb));
            }
            if (route === 'POST /watched' || route === 'POST /hide') {
                var mKind = q.type;
                var mTmdb = int(q.tmdb, 1, 999999999);
                if ((mKind !== 'movie' && mKind !== 'show') || !mTmdb) return reply(400, { error: 'invalid parameters' });
                return ok(route === 'POST /watched' ? markWatched(mKind, mTmdb) : hideRecommendation(mKind, mTmdb));
            }
            if (route === 'GET /calendar') return ok(calendar());
            if (route === 'GET /rewatch') return ok(rewatch());
            if (route === 'GET /related') {
                var rType = q.type;
                var rTmdb = q.tmdb || '';
                if ((rType !== 'movie' && rType !== 'show') || !/^\d{1,9}$/.test(rTmdb)) {
                    return reply(400, { error: 'type must be movie or show, tmdb must be numeric' });
                }
                return ok(related(rType, rTmdb));
            }
            return reply(404, { error: 'not found' });
        }

        loadTokens();
        loadCache();

        return {
            handle: handle,
            status: status,
            reload: loadTokens,
            flush: saveCacheNow
        };
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = create;
    else root.WatchTraktClient = create;
})(typeof window !== 'undefined' ? window : this);
