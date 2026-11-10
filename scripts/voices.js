'use strict';

const fs = require('fs');
const path = require('path');
const { parseRelease, isLoggedIn } = require('./toloka-parse');
const { getCookie } = require('./toloka-auth');

const SHARD_SIZE = 1000;
const OK_TTL_MS = 14 * 24 * 3600 * 1000;
const ERROR_TTL_MS = 24 * 3600 * 1000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const RSS_URL = 'https://toloka.to/rss.php?t=1';

function shardNumber(id) {
    return Math.floor(Number(id) / SHARD_SIZE);
}

function extractIds(text) {
    const ids = [];
    const seen = {};
    const re = /toloka\.to\/t(\d{4,9})\b|href="(?:\.\/|\/)?t(\d{4,9})"/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const id = m[1] || m[2];
        if (!seen[id]) {
            seen[id] = true;
            ids.push(id);
        }
    }
    return ids;
}

function readSeed(file) {
    try {
        return extractIds(fs.readFileSync(file, 'utf8').split(/\s+/).map((x) => (/^\d+$/.test(x) ? 'https://toloka.to/t' + x : '')).join('\n'));
    } catch (e) {
        return [];
    }
}

function isFresh(entry, now) {
    if (!entry || !entry.at) return false;
    const ttl = entry.status === 'error' ? ERROR_TTL_MS : OK_TTL_MS;
    return now - entry.at < ttl;
}

function pickIds(candidates, lookup, now, limit) {
    const unique = [];
    const seen = {};
    candidates.forEach((id) => {
        if (!seen[id]) {
            seen[id] = true;
            unique.push(id);
        }
    });
    unique.sort((a, b) => Number(b) - Number(a));
    return unique.filter((id) => !isFresh(lookup(id), now)).slice(0, limit);
}

function shardFile(dir, number) {
    return path.join(dir, 'voices-' + number + '.json');
}

function loadShard(dir, number) {
    try {
        return JSON.parse(fs.readFileSync(shardFile(dir, number), 'utf8'));
    } catch (e) {
        return {};
    }
}

function createStore(dir) {
    const loaded = {};
    const touched = {};
    return {
        get(id) {
            const n = shardNumber(id);
            if (!loaded[n]) loaded[n] = loadShard(dir, n);
            return loaded[n][id];
        },
        set(id, entry) {
            const n = shardNumber(id);
            if (!loaded[n]) loaded[n] = loadShard(dir, n);
            loaded[n][id] = entry;
            touched[n] = true;
        },
        save() {
            fs.mkdirSync(dir, { recursive: true });
            Object.keys(touched).forEach((n) => {
                const data = loaded[n];
                const sorted = {};
                Object.keys(data).sort((a, b) => Number(a) - Number(b)).forEach((id) => { sorted[id] = data[id]; });
                fs.writeFileSync(shardFile(dir, n), JSON.stringify(sorted));
            });
            return Object.keys(touched).length;
        }
    };
}

function toEntry(parsed, now) {
    if (!parsed.voices.length) return { status: 'none', at: now };
    return { status: 'ok', voices: parsed.voices, tracks: parsed.tracks, videoBitrate: parsed.videoBitrate || 0, at: now };
}

async function fetchText(url, cookie) {
    const headers = { 'User-Agent': UA, 'Accept-Language': 'uk,en;q=0.8' };
    if (cookie) headers.Cookie = cookie;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(url, { headers, signal: controller.signal });
        const text = await res.text();
        return { status: res.status, text };
    } catch (e) {
        return { status: 0, text: '', error: e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
        clearTimeout(timer);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discover(cookie, listUrls, seedFile) {
    const found = [];
    const rss = await fetchText(RSS_URL, '');
    if (rss.status === 200) extractIds(rss.text).forEach((id) => found.push(id));
    for (const url of listUrls) {
        const page = await fetchText(url, cookie);
        if (page.status === 200) extractIds(page.text).forEach((id) => found.push(id));
        else console.log('list page failed', url, page.status || page.error);
        await sleep(700);
    }
    readSeed(seedFile).forEach((id) => found.push(id));
    return found;
}

async function main() {
    let cookie;
    try {
        cookie = await getCookie(process.env);
    } catch (e) {
        console.error(e.code === 'LOGIN_FAILED' ? 'Toloka login failed: check TOLOKA_USER and TOLOKA_PASS' : 'Toloka login error: ' + e.message);
        process.exit(e.code === 'LOGIN_FAILED' ? 2 : 3);
    }
    const dir = process.env.VOICES_DIR || path.join(__dirname, '..', 'data', 'voices');
    const seedFile = process.env.VOICES_SEED || path.join(__dirname, '..', 'data', 'seed-ids.txt');
    const limit = Number(process.env.VOICES_LIMIT || 150);
    const delay = Number(process.env.VOICES_DELAY_MS || 700);
    const listUrls = String(process.env.TOLOKA_LIST_URLS || '').split(/\s+/).filter(Boolean);
    if (!cookie) {
        console.error('TOLOKA_USER and TOLOKA_PASS (or TOLOKA_COOKIE) are not set');
        process.exit(1);
    }
    const store = createStore(dir);
    const now = Date.now();
    const candidates = await discover(cookie, listUrls, seedFile);
    const ids = pickIds(candidates, (id) => store.get(id), now, limit);
    console.log('candidates', candidates.length, 'to fetch', ids.length);
    let ok = 0;
    for (const id of ids) {
        const res = await fetchText('https://toloka.to/t' + id, cookie);
        if (res.status === 200 && !isLoggedIn(res.text)) {
            console.error('Toloka session cookie is not valid anymore');
            store.save();
            process.exit(2);
        }
        if (res.status === 200) {
            store.set(id, toEntry(parseRelease(res.text), Date.now()));
            ok++;
        } else if (res.status === 403 || res.status === 429 || res.status === 503) {
            console.error('Blocked by Toloka, status', res.status);
            store.save();
            process.exit(3);
        } else {
            store.set(id, { status: 'error', reason: 'http_' + res.status, at: Date.now() });
        }
        await sleep(delay);
    }
    const files = store.save();
    console.log('parsed', ok, 'shards written', files);
}

if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = { extractIds, pickIds, shardNumber, createStore, toEntry, isFresh, readSeed };
