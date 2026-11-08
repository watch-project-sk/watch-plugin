'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'watch-plugins.js'), 'utf8');
const realManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const BASE = 'https://example.test/wp/';

function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

function makeEnv(options) {
    const opts = options || {};
    const storage = Object.assign({}, opts.storage || {});
    const manifest = opts.manifest === undefined ? realManifest : opts.manifest;
    const loaded = [];
    const params = [];
    const components = [];
    const noty = [];
    const menu = [];
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.appready = true;
    sandbox.console = { log() {}, error() {}, warn() {} };
    sandbox.setTimeout = setTimeout;
    sandbox.clearTimeout = clearTimeout;
    sandbox.Promise = Promise;
    sandbox.encodeURIComponent = encodeURIComponent;
    sandbox.Lampa = {
        Storage: { get: (key, fallback) => (key in storage ? storage[key] : fallback) },
        Listener: { follow() {} },
        SettingsApi: {
            addComponent: (c) => components.push(c),
            addParam: (p) => params.push(p)
        },
        Noty: { show: (t) => noty.push(t) },
        Settings: { create() {} },
        Controller: { toggle() {} }
    };
    const menuList = {
        length: 1,
        eq() { return menuList; },
        find() { return { length: menu.length }; },
        append(item) { menu.push(item); }
    };
    sandbox.$ = (arg) => {
        if (typeof arg === 'string' && arg.charAt(0) !== '<') return menuList;
        const item = { find() { return { html() {}, text() {} }; }, on() {} };
        return item;
    };
    sandbox.document = {
        currentScript: { src: BASE + 'watch-plugins.js' },
        head: {
            appendChild(el) {
                setImmediate(() => {
                    loaded.push(el.src);
                    if (opts.onScript) opts.onScript(el.src, sandbox);
                    if (opts.broken && opts.broken.some((part) => el.src.indexOf(part) !== -1)) el.onerror();
                    else el.onload();
                });
            }
        },
        createElement() { return {}; }
    };
    sandbox.XMLHttpRequest = function () {
        const xhr = this;
        xhr.open = function (method, url) { xhr.url = url; };
        xhr.send = function () {
            setImmediate(() => {
                if (manifest === null) {
                    xhr.status = 500;
                    xhr.responseText = '';
                } else {
                    xhr.status = 200;
                    xhr.responseText = JSON.stringify(manifest);
                }
                xhr.onload();
            });
        };
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return { sandbox, loaded, params, components, noty, menu, storage };
}

async function boot(options) {
    const env = makeEnv(options);
    for (let i = 0; i < 50; i++) await settle();
    return env;
}

function names(env) {
    return env.params.map((p) => p.param.name);
}

const tests = {
    async 'loads default-on plugins in order, dependencies first, versioned urls'() {
        const env = await boot();
        assert.deepStrictEqual(env.loaded, [
            'https://darkestclouds.github.io/plugins/applecation/applecation.min.js',
            BASE + 'plugins/card-details/card-details.js?v=1.0.0',
            BASE + 'plugins/streaming-tabs/streaming-tabs.js?v=1.0.0',
            BASE + 'plugins/ua-torrent-flow/ua-torrent-flow.js?v=2.1.1'
        ]);
    },

    async 'toggle off removes a plugin, toggle on adds multi-file plugins in file order'() {
        const env = await boot({ storage: { watch_plugins_on_streaming_tabs_x: true, 'watch_plugins_on_streaming-tabs': false, watch_plugins_on_trakt: 'true', 'watch_plugins_on_ua-torrent-flow': false, 'watch_plugins_on_card-details': false } });
        assert.deepStrictEqual(env.loaded, [
            BASE + 'plugins/trakt/trakt-client.js?v=1.0.1',
            BASE + 'plugins/trakt/trakt.js?v=1.0.1'
        ]);
    },

    async 'a broken script does not stop the others and is reported as an error'() {
        const env = await boot({ broken: ['card-details'] });
        assert.ok(env.loaded.some((u) => u.indexOf('streaming-tabs') !== -1));
        assert.ok(env.loaded.some((u) => u.indexOf('ua-torrent-flow') !== -1));
        const trigger = env.params.find((p) => p.param.name === 'watch_plugins_on_card-details');
        const item = { find: () => ({ text: (t) => { item.text = t; } }) };
        trigger.onRender(item);
        assert.ok(/помилка/.test(item.text));
    },

    async 'settings are grouped by category with plugin settings under their switch'() {
        const env = await boot({
            onScript(src, sandbox) {
                if (src.indexOf('streaming-tabs') !== -1) sandbox.WatchPlugins.settings('streaming-tabs', [{ param: { name: 'region_param', type: 'select' }, field: { name: 'Region' } }]);
            }
        });
        assert.strictEqual(env.components.length, 1);
        assert.strictEqual(env.components[0].component, 'watch_plugins');
        env.params.forEach((p) => assert.strictEqual(p.component, 'watch_plugins'));
        const layout = env.params.map((p) => (p.param.type === 'title' ? '# ' + p.field.name : p.param.name));
        const at = (name) => layout.indexOf(name);
        assert.strictEqual(layout[0], '# Картка фільму');
        assert.ok(at('# Картка фільму') < at('watch_plugins_on_card-details'));
        assert.ok(at('watch_plugins_on_card-details') < at('# Головна сторінка'));
        assert.deepStrictEqual(layout.slice(at('# Головна сторінка'), at('# Головна сторінка') + 3), ['# Головна сторінка', 'watch_plugins_on_streaming-tabs', 'region_param']);
        assert.ok(at('# Торенти та плеєр') < at('watch_plugins_on_ua-torrent-flow'));
        assert.ok(at('watch_plugins_on_torserver-address') < at('# Сервіси та облікові записи'));
        assert.ok(at('watch_plugins_on_trakt') > at('# Сервіси та облікові записи'));
        assert.strictEqual(layout[layout.length - 5], '# Керування Watch Plugins');
        const trigger = env.params.find((p) => p.param.name === 'watch_plugins_on_torserver-address');
        assert.strictEqual(trigger.param.default, false);
        assert.strictEqual(trigger.field.name, 'Адреса TorrServer');
    },

    async 'plugins without a known category land in a fallback section'() {
        const manifest = JSON.parse(JSON.stringify(realManifest));
        manifest.plugins[1].category = 'unknown';
        const env = await boot({ manifest });
        const titles = env.params.filter((p) => p.param.type === 'title').map((p) => p.field.name);
        assert.strictEqual(titles[titles.length - 2], 'Інше');
    },

    async 'input params declare string values, as Lampa requires'() {
        const env = await boot();
        const inputs = env.params.filter((p) => p.param.type === 'input');
        assert.ok(inputs.length >= 2);
        inputs.forEach((p) => assert.strictEqual(p.param.values, ''));
    },

    async 'settings for disabled plugins are still listed so they can be switched on'() {
        const env = await boot();
        assert.ok(names(env).indexOf('watch_plugins_on_trakt') !== -1);
        assert.ok(names(env).indexOf('watch_plugins_on_torserver-address') !== -1);
    },

    async 'extra urls from settings are loaded after plugins'() {
        const env = await boot({ storage: { watch_plugins_extra: 'https://home.test/a.js, https://home.test/b.js nonsense' } });
        assert.deepStrictEqual(env.loaded.slice(-2), ['https://home.test/a.js', 'https://home.test/b.js']);
    },

    async 'custom base url is used for manifest-relative files'() {
        const env = await boot({ storage: { watch_plugins_base: 'https://fork.test/repo' } });
        assert.ok(env.loaded.indexOf('https://fork.test/repo/plugins/streaming-tabs/streaming-tabs.js?v=1.0.0') !== -1);
    },

    async 'manifest failure still registers settings and tells the user'() {
        const env = await boot({ manifest: null });
        assert.strictEqual(env.components.length, 1);
        assert.strictEqual(env.loaded.length, 0);
        assert.ok(env.noty.length === 1);
        assert.strictEqual(env.menu.length, 1);
    },

    async 'menu item is added once'() {
        const env = await boot();
        assert.strictEqual(env.menu.length, 1);
    },

    async 'a second copy of the manager does nothing'() {
        const env = makeEnv();
        const first = env.sandbox.WatchPlugins;
        vm.runInContext(source, env.sandbox);
        assert.strictEqual(env.sandbox.WatchPlugins, first);
    }
};

async function run() {
    let failed = 0;
    for (const name of Object.keys(tests)) {
        try {
            await tests[name]();
            console.log('ok  ', 'manager:', name);
        } catch (e) {
            failed++;
            console.log('FAIL', 'manager:', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     '));
        }
    }
    return failed;
}

module.exports = run;
