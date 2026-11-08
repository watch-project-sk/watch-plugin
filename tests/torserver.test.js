'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'torserver-address', 'torserver-address.js'), 'utf8');

function load(initial, withManager) {
    const data = Object.assign({}, initial);
    const registered = [];
    const sandbox = { console: { log() {}, error() {} } };
    sandbox.window = sandbox;
    sandbox.appready = true;
    sandbox.Lampa = {
        Storage: {
            get(key, fallback) { return key in data ? data[key] : fallback; },
            set(key, value) { data[key] = value; }
        },
        Listener: { follow() {} },
        SettingsApi: { addComponent() {}, addParam(p) { registered.push(p); } },
        Settings: { update() {} }
    };
    if (withManager) sandbox.WatchPlugins = { settings(id, params) { registered.push({ id, params }); } };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return { Lampa: sandbox.Lampa, data, registered };
}

const tests = {
    'empty address changes nothing'() {
        const env = load({ torrserver_url: 'my.host:8090' });
        assert.strictEqual(env.Lampa.Storage.get('torrserver_url'), 'my.host:8090');
        assert.strictEqual(env.data.torrserver_url_dop, undefined);
        assert.strictEqual(env.Lampa.Storage.get('torrserver_use_link', 'x'), 'x');
    },

    'saved address overrides both keys and survives later writes'() {
        const env = load({ wp_torserver_address: 'http://10.0.0.5:8090/' });
        assert.strictEqual(env.data.torrserver_url, '10.0.0.5:8090');
        assert.strictEqual(env.data.torrserver_url_dop, '10.0.0.5:8090');
        env.Lampa.Storage.set('torrserver_url', 'other:1');
        assert.strictEqual(env.data.torrserver_url, '10.0.0.5:8090');
        assert.strictEqual(env.Lampa.Storage.get('torrserver_use_link'), 'one');
    },

    'address entered at runtime applies without reload'() {
        const env = load({});
        env.Lampa.Storage.set('wp_torserver_address', '10.0.0.6:8090');
        const trigger = env.registered.find((p) => p.param.name === 'wp_torserver_address');
        trigger.onChange();
        assert.strictEqual(env.data.torrserver_url, '10.0.0.6:8090');
    },

    'disabling stops the override'() {
        const env = load({ wp_torserver_address: '10.0.0.5:8090', wp_torserver_enabled: false, torrserver_url: 'keep:1' });
        assert.strictEqual(env.data.torrserver_url, 'keep:1');
        env.Lampa.Storage.set('torrserver_url', 'new:2');
        assert.strictEqual(env.data.torrserver_url, 'new:2');
    },

    'one-link can be turned off separately'() {
        const env = load({ wp_torserver_address: '10.0.0.5:8090', wp_torserver_one_link: false });
        assert.strictEqual(env.Lampa.Storage.get('torrserver_use_link', 'x'), 'x');
    },

    'settings go through the manager when present'() {
        const env = load({}, true);
        assert.strictEqual(env.registered[0].id, 'torserver-address');
        assert.deepStrictEqual(Array.from(env.registered[0].params.map((p) => p.param.name)), ['wp_torserver_enabled', 'wp_torserver_address', 'wp_torserver_one_link']);
        assert.strictEqual(env.registered[0].params[1].param.default, '');
    }
};

async function run() {
    let failed = 0;
    Object.keys(tests).forEach((name) => {
        try {
            tests[name]();
            console.log('ok  ', 'torserver-address:', name);
        } catch (e) {
            failed++;
            console.log('FAIL', 'torserver-address:', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     '));
        }
    });
    return failed;
}

module.exports = run;
