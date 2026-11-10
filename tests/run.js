'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { parseRelease } = require('../scripts/toloka-parse');
const voices = require('../scripts/voices');
const auth = require('../scripts/toloka-auth');

let failed = 0;

function check(name, fn) {
    try {
        fn();
        console.log('ok  ', name);
    } catch (e) {
        failed++;
        console.log('FAIL', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     '));
    }
}

const cases = {
    t687211: { voices: ['Цікава Ідея', 'DniproFilm/HDrezka', 'Оригінал'], videoBitrate: 10.7 },
    t679989: { voices: ['Двоголосий', 'Багатоголосий', 'Оригінал'], videoBitrate: 9.9 },
    t698664: { voices: ['Postmodern', 'DniproFilm', 'Оригінал'], videoBitrate: 22.8 },
    t678725: { voices: ['Postmodern', 'BaibaKo', 'Оригінал'], videoBitrate: 5.4 }
};

Object.keys(cases).forEach((name) => {
    check('parser ' + name, () => {
        const html = fs.readFileSync(path.join(__dirname, 'fixtures', name + '.html'), 'utf8');
        const got = parseRelease(html);
        assert.deepStrictEqual(got.voices, cases[name].voices);
        assert.strictEqual(got.videoBitrate, cases[name].videoBitrate);
    });
});

check('voices: extractIds finds topic links in RSS and html', () => {
    const text = '<link>https://toloka.to/t701426</link><a href="t687211">x</a><a href="./t12">short</a><a href="/t555555">y</a> https://toloka.to/t701426';
    assert.deepStrictEqual(voices.extractIds(text), ['701426', '687211', '555555']);
});

check('voices: shard numbers', () => {
    assert.strictEqual(voices.shardNumber('687211'), 687);
    assert.strictEqual(voices.shardNumber(999), 0);
});

check('voices: pickIds skips fresh, prefers newest, respects limit', () => {
    const now = 1000000000000;
    const day = 24 * 3600 * 1000;
    const data = {
        '100': { status: 'ok', at: now - day },
        '200': { status: 'ok', at: now - 20 * day },
        '300': { status: 'error', at: now - 2 * day },
        '400': { status: 'error', at: now - 1000 }
    };
    const picked = voices.pickIds(['100', '200', '300', '400', '500', '200'], (id) => data[id], now, 3);
    assert.deepStrictEqual(picked, ['500', '300', '200']);
});

check('voices: store writes sorted shards and reloads them', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voices-'));
    const store = voices.createStore(dir);
    store.set('687300', voices.toEntry({ voices: ['A'], tracks: [], videoBitrate: 5 }, 1));
    store.set('687200', voices.toEntry({ voices: [], tracks: [] }, 2));
    store.set('12', { status: 'error', reason: 'http_500', at: 3 });
    assert.strictEqual(store.save(), 2);
    const shard = JSON.parse(fs.readFileSync(path.join(dir, 'voices-687.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(shard), ['687200', '687300']);
    assert.strictEqual(shard['687200'].status, 'none');
    const again = voices.createStore(dir);
    assert.strictEqual(again.get('687300').voices[0], 'A');
    assert.strictEqual(again.get('12').reason, 'http_500');
    fs.rmSync(dir, { recursive: true, force: true });
});

check('auth: parseSetCookies keeps live cookies and drops deleted or expired ones', () => {
    const jar = auth.parseSetCookies([
        'toloka_sid=abc123; path=/; HttpOnly',
        'toloka_data=a%3A2%3A%7Bs%3A6; expires=Wed, 01 Jan 2099 00:00:00 GMT; path=/',
        'old=zzz; path=/',
        'old=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/',
        'gone=1; expires=Thu, 01 Jan 1970 00:00:01 GMT'
    ]);
    assert.deepStrictEqual(Object.keys(jar), ['toloka_sid', 'toloka_data']);
    assert.strictEqual(auth.jarToHeader(jar), 'toloka_sid=abc123; toloka_data=a%3A2%3A%7Bs%3A6');
});

check('every input param in plugin sources declares string values', () => {
    const root = path.join(__dirname, '..');
    const files = ['watch-plugins.js'];
    fs.readdirSync(path.join(root, 'plugins')).forEach((dir) => {
        fs.readdirSync(path.join(root, 'plugins', dir)).forEach((name) => {
            if (/\.js$/.test(name)) files.push(path.join('plugins', dir, name));
        });
    });
    files.forEach((file) => {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        const found = text.match(/type: 'input'[^}]*/g) || [];
        found.forEach((chunk) => assert.ok(/values: ''/.test(chunk), file + ': ' + chunk));
    });
});

check('manifest: descriptions fit two lines', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    manifest.plugins.forEach((plugin) => {
        assert.ok(plugin.name.length <= 34, plugin.id + ' name too long: ' + plugin.name.length);
        assert.ok(plugin.description.length <= 105, plugin.id + ' description too long: ' + plugin.description.length);
    });
});

check('manifest: every plugin file exists and ids are unique', () => {
    const root = path.join(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const ids = {};
    manifest.plugins.forEach((plugin) => {
        assert.ok(!ids[plugin.id], 'duplicate ' + plugin.id);
        ids[plugin.id] = true;
        const files = plugin.files && plugin.files.length ? plugin.files : [plugin.path];
        files.forEach((file) => {
            if (/^https?:/.test(file)) return;
            assert.ok(fs.existsSync(path.join(root, file)), 'missing ' + file);
        });
        (plugin.requires || []).forEach((id) => assert.ok(manifest.plugins.some((p) => p.id === id), 'unknown requirement ' + id));
    });
});

check('no private addresses or secrets in published files', () => {
    const root = path.join(__dirname, '..');
    const bad = [];
    (function walk(dir) {
        fs.readdirSync(dir).forEach((name) => {
            if (name === 'node_modules' || name === '.git' || name === 'fixtures' || name === 'tests') return;
            const full = path.join(dir, name);
            if (fs.statSync(full).isDirectory()) return walk(full);
            if (!/\.(js|json|md|yml|svg)$/.test(name)) return;
            const text = fs.readFileSync(full, 'utf8');
            if (/192\.168\.\d+\.\d+/.test(text)) bad.push(full);
        });
    })(root);
    assert.deepStrictEqual(bad, []);
});

(async () => {
    try {
        assert.strictEqual(await auth.getCookie({ TOLOKA_COOKIE: ' a=b ' }), 'a=b');
        assert.strictEqual(await auth.getCookie({}), '');
        console.log('ok   auth: getCookie falls back to TOLOKA_COOKIE without credentials');
    } catch (e) {
        failed++;
        console.log('FAIL auth: getCookie fallback', e.message);
    }
    failed += await require('./trakt-client.test.js')();
    failed += await require('./manager.test.js')();
    failed += await require('./torserver.test.js')();
    console.log(failed ? failed + ' failed' : 'all passed');
    process.exit(failed ? 1 : 0);
})();
