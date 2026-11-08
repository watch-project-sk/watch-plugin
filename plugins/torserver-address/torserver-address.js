(function () {
    'use strict';

    if (typeof Lampa === 'undefined' || window.__wp_torserver_address) return;
    window.__wp_torserver_address = true;

    var NAME = 'TorrServer Address';
    var KEY_ENABLED = 'wp_torserver_enabled';
    var KEY_ADDRESS = 'wp_torserver_address';
    var KEY_ONE_LINK = 'wp_torserver_one_link';
    var TARGET_KEYS = ['torrserver_url', 'torrserver_url_dop'];
    var ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><path d="M7 7h.01M7 17h.01"/></svg>';

    var originalGet = null;
    var originalSet = null;

    function stored(key, fallback) {
        try {
            var value = originalGet.call(Lampa.Storage, key, fallback);
            return value === undefined || value === null ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }

    function isTrue(value, fallback) {
        if (value === undefined || value === null || value === '') return fallback;
        return value === true || value === 'true';
    }

    function enabled() {
        return isTrue(stored(KEY_ENABLED, true), true);
    }

    function oneLink() {
        return isTrue(stored(KEY_ONE_LINK, true), true);
    }

    function address() {
        return String(stored(KEY_ADDRESS, '') || '').replace(/^\s+|\s+$/g, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }

    function target() {
        return enabled() && address() ? address() : '';
    }

    function apply() {
        var value = target();
        if (value) {
            TARGET_KEYS.forEach(function (key) { originalSet.call(Lampa.Storage, key, value); });
        }
        if (value && oneLink()) originalSet.call(Lampa.Storage, 'torrserver_use_link', 'one');
        if (Lampa.Settings && Lampa.Settings.update) {
            try { Lampa.Settings.update(); } catch (e) {}
        }
    }

    function patchStorage() {
        originalSet = Lampa.Storage.set;
        originalGet = Lampa.Storage.get;

        Lampa.Storage.set = function (key, value) {
            var forced = target();
            if (forced && TARGET_KEYS.indexOf(key) !== -1) value = forced;
            return originalSet.call(this, key, value);
        };

        Lampa.Storage.get = function (key, defaultValue) {
            if (key === 'torrserver_use_link' && target() && oneLink()) return 'one';
            return originalGet.call(this, key, defaultValue);
        };
    }

    function addSettings() {
        var params = [
            {
                param: { name: KEY_ENABLED, type: 'trigger', 'default': true },
                field: { name: 'Підміняти адресу', description: 'Lampa завжди використовуватиме адресу нижче, навіть якщо в профілі інша.' },
                onChange: apply
            },
            {
                param: { name: KEY_ADDRESS, type: 'input', values: '', 'default': '' },
                field: { name: 'Адреса TorrServer', description: 'Формат адреса:порт. Порожньо — нічого не підміняється.' },
                onChange: apply
            },
            {
                param: { name: KEY_ONE_LINK, type: 'trigger', 'default': true },
                field: { name: 'Режим «одне посилання»', description: 'Примусово вмикає в Lampa режим однієї спільної адреси TorrServer.' },
                onChange: apply
            }
        ];
        if (window.WatchPlugins) return window.WatchPlugins.settings('torserver-address', params);
        if (!Lampa.SettingsApi) return;
        Lampa.SettingsApi.addComponent({ component: 'wp_torserver_address', name: NAME, icon: ICON });
        params.forEach(function (item) {
            item.component = 'wp_torserver_address';
            Lampa.SettingsApi.addParam(item);
        });
    }

    function init() {
        try {
            patchStorage();
            apply();
        } catch (err) {
            console.error(NAME, 'patch error', err);
        }
        try { addSettings(); } catch (err) { console.error(NAME, 'settings error', err); }
        console.log(NAME, 'loaded');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
