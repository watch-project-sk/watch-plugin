'use strict';

const assert = require('assert');
const createClient = require('../plugins/trakt/trakt-client.js');

function memoryStorage() {
    const data = {};
    return {
        get: (k) => (k in data ? JSON.parse(data[k]) : null),
        set: (k, v) => { data[k] = JSON.stringify(v); },
        remove: (k) => { delete data[k]; },
        raw: data
    };
}

function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

async function until(test) {
    for (let i = 0; i < 200; i++) {
        if (test()) return;
        await settle();
    }
    throw new Error('condition not reached');
}

function fakeTrakt() {
    const state = { calls: {}, log: [], tokenPolls: 0, validAccess: 'access-1', refreshCount: 0, throttle: 0, scrobbles: [], history: [], watchlist: [] };
    const key = (m, u) => m + ' ' + u.replace('https://api.trakt.tv', '').split('?')[0];
    const http = async (method, url, headers, body) => {
        const k = key(method, url);
        state.calls[k] = (state.calls[k] || 0) + 1;
        state.log.push({ method, url, headers, body: body ? JSON.parse(body) : undefined });
        const json = (status, value, extra) => Object.assign({ status, text: value === undefined ? '' : JSON.stringify(value) }, extra || {});
        if (headers['trakt-api-key'] !== 'cid' || headers['trakt-api-version'] !== '2') return json(403, {});
        const parsed = body ? JSON.parse(body) : {};
        if (k === 'POST /oauth/device/code') return json(200, { device_code: 'dc', user_code: 'ABCD1234', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 5 });
        if (k === 'POST /oauth/device/token') {
            if (parsed.client_secret !== 'secret') return json(401, {});
            state.tokenPolls++;
            if (state.tokenPolls <= 2) return json(400, {});
            return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 7776000, created_at: Math.floor(Date.now() / 1000) });
        }
        if (k === 'POST /oauth/token') {
            if (parsed.refresh_token !== 'refresh-1' || parsed.client_secret !== 'secret' || parsed.redirect_uri !== 'urn:ietf:wg:oauth:2.0:oob') return json(400, {});
            state.refreshCount++;
            state.validAccess = 'access-2';
            return json(200, { access_token: 'access-2', refresh_token: 'refresh-1', expires_in: 7776000, created_at: Math.floor(Date.now() / 1000) });
        }
        if (k === 'POST /oauth/revoke') return json(200, {});
        if (k === 'GET /users/settings') return json(200, { user: { username: 'tester' } });
        if (k === 'GET /movies/trending') {
            if (state.throttle > 0) {
                state.throttle--;
                return json(429, {}, { retryAfter: 1 });
            }
            return json(200, [{ movie: { title: 'A', year: 2020, ids: { tmdb: 1 } } }, { movie: { title: 'B', year: 2021, ids: { tmdb: 2 } } }, { movie: { title: 'NoId', ids: {} } }]);
        }
        const auth = headers.Authorization || '';
        if (k.indexOf('/oauth') !== 0 && k !== 'GET /movies/trending' && k.indexOf('/search') === -1 && k.indexOf('/related') === -1) {
            if (auth !== 'Bearer ' + state.validAccess) return json(401, {});
        }
        if (k === 'GET /recommendations/movies') {
            return json(200, [
                { title: 'Space', year: 2019, ids: { tmdb: 10 }, genres: ['science-fiction', 'adventure'] },
                { title: 'Cartoon', year: 2018, ids: { tmdb: 11 }, genres: ['animation', 'family'] },
                { title: 'Drama', year: 2017, ids: { tmdb: 12 }, genres: ['drama'] }
            ]);
        }
        if (k === 'POST /scrobble/stop') {
            state.scrobbles.push(parsed);
            return json(201, {});
        }
        if (k === 'POST /sync/history') {
            state.history.push(parsed);
            const movies = parsed.movies ? parsed.movies.length : 0;
            const episodes = parsed.shows ? parsed.shows.reduce((n, s) => n + s.seasons.reduce((m, se) => m + se.episodes.length, 0), 0) : 0;
            return json(201, { added: { movies, episodes }, not_found: { movies: [], shows: [] } });
        }
        if (k === 'GET /sync/watchlist/movies/added') return json(200, state.watchlist.map((id) => ({ listed_at: '2026-10-01T00:00:00.000Z', movie: { title: 'W' + id, ids: { tmdb: id } } })));
        if (k === 'GET /sync/watchlist/shows/added') return json(200, []);
        if (k === 'POST /sync/watchlist') {
            parsed.movies.forEach((m) => state.watchlist.push(m.ids.tmdb));
            return json(201, { not_found: { movies: [] } });
        }
        if (k === 'GET /search/tmdb/603') return json(200, [{ type: 'movie', movie: { ids: { trakt: 99, tmdb: 603 } } }]);
        if (k === 'GET /movies/99/related') return json(200, [{ title: 'R', ids: { tmdb: 604 } }, { title: 'Self', ids: { tmdb: 603 } }]);
        return json(404, {});
    };
    return { http, state };
}

function build(options) {
    const opts = options || {};
    const fake = fakeTrakt();
    const storage = opts.storage || memoryStorage();
    const creds = opts.credentials || { id: 'cid', secret: 'secret' };
    const client = createClient({
        http: fake.http,
        storage,
        sleep: () => Promise.resolve(),
        credentials: () => creds,
        random: () => 0.5
    });
    return { client, fake, storage, creds };
}

async function call(client, method, path, body) {
    const res = await client.handle(method, path, body);
    return res;
}

async function login(ctx) {
    const started = await call(ctx.client, 'POST', '/auth/start');
    assert.strictEqual(started.code, 200);
    assert.ok(started.body.pending, 'pending after start');
    assert.strictEqual(started.body.pending.userCode, 'ABCD1234');
    await until(() => ctx.client.status().connected);
}

const tests = {
    async 'unconfigured returns empty results and 503 on writes'() {
        const ctx = build({ credentials: { id: '', secret: '' } });
        assert.deepStrictEqual((await call(ctx.client, 'GET', '/auth/status')).body.configured, false);
        assert.deepStrictEqual((await call(ctx.client, 'GET', '/recommendations?type=movies')).body, { connected: false, items: [] });
        assert.strictEqual((await call(ctx.client, 'POST', '/auth/start')).code, 503);
        assert.strictEqual(Object.keys(ctx.fake.state.calls).length, 0);
    },

    async 'device flow connects with the personal secret and stores tokens'() {
        const ctx = build();
        await login(ctx);
        const status = ctx.client.status();
        assert.strictEqual(status.user, 'tester');
        assert.strictEqual(status.pending, null);
        const saved = ctx.storage.get('tokens');
        assert.strictEqual(saved.access_token, 'access-1');
        assert.strictEqual(saved.client, 'cid');
        assert.strictEqual(ctx.fake.state.tokenPolls, 3);
    },

    async 'tokens belong to the client id they were issued for'() {
        const ctx = build();
        await login(ctx);
        ctx.creds.id = 'other';
        ctx.client.reload();
        assert.strictEqual(ctx.client.status().connected, false);
    },

    async 'recommendations are mapped, cached and filtered by genre'() {
        const ctx = build();
        await login(ctx);
        const first = await call(ctx.client, 'GET', '/recommendations?type=movies');
        assert.deepStrictEqual(first.body.items.map((x) => x.tmdb), [10, 11, 12]);
        assert.deepStrictEqual(Object.keys(first.body.items[0]).sort(), ['title', 'tmdb', 'type', 'year']);
        await call(ctx.client, 'GET', '/recommendations?type=movies');
        assert.strictEqual(ctx.fake.state.calls['GET /recommendations/movies'], 1);
        const hard = await call(ctx.client, 'GET', '/recommendations?type=movies&genres=animation');
        assert.deepStrictEqual(hard.body.items.map((x) => x.tmdb), [11]);
        assert.strictEqual((await call(ctx.client, 'GET', '/recommendations?type=books')).code, 400);
        assert.strictEqual((await call(ctx.client, 'GET', '/recommendations?type=movies&genres=BAD!')).code, 400);
    },

    async 'expired access token is refreshed once and the request retried'() {
        const ctx = build();
        await login(ctx);
        ctx.fake.state.validAccess = 'rotated';
        const res = await call(ctx.client, 'GET', '/watchlist');
        assert.strictEqual(res.code, 200);
        assert.strictEqual(ctx.fake.state.refreshCount, 1);
        assert.strictEqual(ctx.storage.get('tokens').access_token, 'access-2');
    },

    async 'rejected refresh disconnects'() {
        const ctx = build();
        await login(ctx);
        const saved = ctx.storage.get('tokens');
        saved.refresh_token = 'wrong';
        ctx.storage.set('tokens', saved);
        ctx.client.reload();
        ctx.fake.state.validAccess = 'rotated';
        const res = await call(ctx.client, 'GET', '/watchlist');
        assert.deepStrictEqual(res.body, { connected: false, items: [] });
        assert.strictEqual(ctx.client.status().connected, false);
    },

    async 'trending works without login and retries after 429'() {
        const ctx = build();
        ctx.fake.state.throttle = 1;
        const res = await call(ctx.client, 'GET', '/trending?type=movies');
        assert.deepStrictEqual(res.body.items.map((x) => x.tmdb), [1, 2]);
        assert.strictEqual(ctx.fake.state.calls['GET /movies/trending'], 2);
    },

    async 'scrobble validates input and posts the expected body'() {
        const ctx = build();
        await login(ctx);
        assert.strictEqual((await call(ctx.client, 'POST', '/scrobble?action=stop&type=movie&tmdb=1&progress=150')).code, 400);
        const ok = await call(ctx.client, 'POST', '/scrobble?action=stop&type=episode&tmdb=1399&season=1&episode=2&progress=90');
        assert.deepStrictEqual(ok.body, { ok: true, connected: true });
        assert.deepStrictEqual(ctx.fake.state.scrobbles[0], { show: { ids: { tmdb: 1399 } }, episode: { season: 1, number: 2 }, progress: 90 });
    },

    async 'history import batches movies and episodes'() {
        const ctx = build();
        await login(ctx);
        const movies = [];
        for (let i = 1; i <= 120; i++) movies.push({ tmdb: i });
        const body = { movies, episodes: [{ tmdb: 1399, season: 1, episode: 1 }, { tmdb: 1399, season: 1, episode: 2 }, { tmdb: 1399, season: 2, episode: 1 }, { tmdb: 0, season: 1, episode: 1 }] };
        const res = await call(ctx.client, 'POST', '/history/import', body);
        assert.strictEqual(res.body.ok, true);
        assert.strictEqual(res.body.added.movies, 120);
        assert.strictEqual(res.body.added.episodes, 3);
        assert.strictEqual(res.body.added.batches, 3);
        assert.strictEqual((await call(ctx.client, 'POST', '/history/import', 'bad')).code, 400);
    },

    async 'watchlist add refreshes the list'() {
        const ctx = build();
        await login(ctx);
        assert.deepStrictEqual((await call(ctx.client, 'GET', '/watchlist')).body.items, []);
        const added = await call(ctx.client, 'POST', '/watchlist?action=add&type=movie&tmdb=603');
        assert.strictEqual(added.body.ok, true);
        const list = await call(ctx.client, 'GET', '/watchlist');
        assert.deepStrictEqual(list.body.items.map((x) => x.tmdb), [603]);
    },

    async 'related resolves the trakt id and drops the item itself'() {
        const ctx = build();
        const res = await call(ctx.client, 'GET', '/related?type=movie&tmdb=603');
        assert.deepStrictEqual(res.body.items.map((x) => x.tmdb), [604]);
        await call(ctx.client, 'GET', '/related?type=movie&tmdb=603');
        assert.strictEqual(ctx.fake.state.calls['GET /movies/99/related'], 1);
    },

    async 'logout revokes and clears tokens'() {
        const ctx = build();
        await login(ctx);
        const res = await call(ctx.client, 'POST', '/auth/logout');
        assert.strictEqual(res.body.connected, false);
        assert.strictEqual(ctx.storage.get('tokens'), null);
        assert.strictEqual(ctx.fake.state.calls['POST /oauth/revoke'], 1);
    },

    async 'cache survives a new client instance'() {
        const storage = memoryStorage();
        const first = build({ storage });
        await call(first.client, 'GET', '/trending?type=movies');
        first.client.flush();
        const second = build({ storage });
        await call(second.client, 'GET', '/trending?type=movies');
        assert.strictEqual(second.fake.state.calls['GET /movies/trending'] || 0, 0);
    }
};

async function run() {
    let failed = 0;
    for (const name of Object.keys(tests)) {
        try {
            await tests[name]();
            console.log('ok  ', 'trakt-client:', name);
        } catch (e) {
            failed++;
            console.log('FAIL', 'trakt-client:', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     '));
        }
    }
    return failed;
}

module.exports = run;
