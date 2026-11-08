(function () {
    'use strict';

    if (typeof Lampa === 'undefined' || window.WatchPlugins) return;

    var NAME = 'Watch Plugins';
    var VERSION = '1.0.1';
    var COMPONENT = 'watch_plugins';
    var DEFAULT_BASE = 'https://watch-project-sk.github.io/watch-plugin/';
    var KEY_BASE = 'watch_plugins_base';
    var KEY_EXTRA = 'watch_plugins_extra';
    var KEY_ON = 'watch_plugins_on_';
    var LOAD_TIMEOUT = 15000;
    var MANIFEST_TIMEOUT = 10000;
    var ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M10 8.5v3l3-1.5z" fill="currentColor"/></svg>';
    var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';

    var queued = {};
    var statuses = {};
    var manifest = null;
    var settingsDone = false;

    function dirOf(url) {
        return url.replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
    }

    function readKey(key, fallback) {
        try {
            var value = Lampa.Storage.get(key, fallback);
            return value === undefined || value === null ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }

    function baseUrl() {
        var custom = String(readKey(KEY_BASE, '') || '').replace(/^\s+|\s+$/g, '');
        var base = custom || (SCRIPT_SRC ? dirOf(SCRIPT_SRC) : DEFAULT_BASE);
        return base.charAt(base.length - 1) === '/' ? base : base + '/';
    }

    function isOn(plugin) {
        var value = readKey(KEY_ON + plugin.id, '__unset__');
        if (value === '__unset__' || value === '') return Boolean(plugin.default);
        return value === true || value === 'true';
    }

    function resolve(path, version) {
        if (/^https?:\/\//i.test(path)) return path;
        return baseUrl() + path + (version ? '?v=' + encodeURIComponent(version) : '');
    }

    function request(url, ok, fail) {
        var xhr;
        try {
            xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = MANIFEST_TIMEOUT;
        } catch (e) {
            fail();
            return;
        }
        xhr.onload = function () {
            var json = null;
            try { json = JSON.parse(xhr.responseText); } catch (e) {}
            if (xhr.status >= 200 && xhr.status < 300 && json) ok(json);
            else fail();
        };
        xhr.onerror = xhr.ontimeout = fail;
        xhr.send();
    }

    function loadScript(url, done) {
        var el = document.createElement('script');
        var finished = false;
        var timer = setTimeout(function () { finish(false); }, LOAD_TIMEOUT);

        function finish(ok) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            el.onload = el.onerror = null;
            done(ok);
        }

        el.onload = function () { finish(true); };
        el.onerror = function () { finish(false); };
        el.async = false;
        el.src = url;
        document.head.appendChild(el);
    }

    function loadAll(urls, done) {
        var index = 0;
        var ok = true;
        (function next() {
            if (index >= urls.length) return done(ok);
            loadScript(urls[index++], function (success) {
                if (!success) ok = false;
                next();
            });
        })();
    }

    function byId(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function filesOf(plugin) {
        var files = plugin.files && plugin.files.length ? plugin.files : [plugin.path];
        return files.map(function (file) { return resolve(file, plugin.version); });
    }

    function loadPlugin(plugin, list, seen, done) {
        if (seen[plugin.id]) return done();
        seen[plugin.id] = true;
        var needs = (plugin.requires || []).map(function (id) { return byId(list, id); }).filter(Boolean);
        var index = 0;
        (function next() {
            if (index < needs.length) {
                var dep = needs[index++];
                return loadPlugin(dep, list, seen, next);
            }
            statuses[plugin.id] = 'loading';
            loadAll(filesOf(plugin), function (ok) {
                statuses[plugin.id] = ok ? 'ok' : 'error';
                if (!ok) console.error(NAME, 'failed to load', plugin.id);
                done();
            });
        })();
    }

    function extraUrls() {
        return String(readKey(KEY_EXTRA, '') || '').split(/[\s,]+/).filter(function (u) { return /^https?:\/\//i.test(u); });
    }

    function statusText(plugin) {
        var state = statuses[plugin.id];
        var label = !isOn(plugin) && !state ? 'вимкнено' : state === 'ok' ? 'працює' : state === 'error' ? 'помилка завантаження' : state === 'loading' ? 'завантажується' : 'очікує перезавантаження';
        return 'v' + (plugin.version || '?') + ' · ' + label;
    }

    function reload() {
        window.location.reload();
    }

    function notifyRestart() {
        if (Lampa.Noty) Lampa.Noty.show('Перезавантажте застосунок, щоб застосувати зміни');
    }

    function addParam(param) {
        param.component = COMPONENT;
        Lampa.SettingsApi.addParam(param);
    }

    function registerSettings(list) {
        if (settingsDone) return;
        settingsDone = true;
        Lampa.SettingsApi.addComponent({ component: COMPONENT, name: NAME, icon: ICON });
        addParam({
            param: { name: 'watch_plugins_about', type: 'static' },
            field: { name: 'Watch Plugins', description: 'Менеджер плагінів v' + VERSION + '. Зміни вмикання діють після перезавантаження.' }
        });
        addParam({
            param: { name: KEY_BASE, type: 'input', values: '', 'default': '' },
            field: { name: 'Адреса репозиторію', description: 'Порожньо: тека, звідки завантажено менеджер.' }
        });
        addParam({
            param: { name: KEY_EXTRA, type: 'input', values: '', 'default': '' },
            field: { name: 'Додаткові плагіни (URL)', description: 'Адреси скриптів через пробіл або кому.' }
        });
        addParam({
            param: { name: 'watch_plugins_reload', type: 'button' },
            field: { name: 'Перезавантажити застосунок' },
            onChange: reload
        });
        list.forEach(function (plugin) {
            addParam({
                param: { name: 'watch_plugins_title_' + plugin.id, type: 'title' },
                field: { name: plugin.name }
            });
            addParam({
                param: { name: KEY_ON + plugin.id, type: 'trigger', 'default': Boolean(plugin.default) },
                field: { name: 'Увімкнено', description: plugin.description || '' },
                onChange: notifyRestart
            });
            addParam({
                param: { name: 'watch_plugins_state_' + plugin.id, type: 'static' },
                field: { name: 'Стан', description: '…' },
                onRender: function (item) {
                    item.find('.settings-param__descr').text(statusText(plugin));
                }
            });
            (queued[plugin.id] || []).forEach(addParam);
        });
    }

    function addMenuItem() {
        try {
            var list = $('.menu .menu__list').eq(0);
            if (!list.length || list.find('[data-watch-plugins]').length) return;
            var item = $('<li class="menu__item selector" data-watch-plugins="true"><div class="menu__ico"></div><div class="menu__text"></div></li>');
            item.find('.menu__ico').html(ICON);
            item.find('.menu__text').text(NAME);
            item.on('hover:enter', function () {
                try {
                    Lampa.Settings.create(COMPONENT, {
                        onBack: function () { Lampa.Controller.toggle('menu'); }
                    });
                } catch (e) {
                    console.error(NAME, 'open settings error', e);
                }
            });
            list.append(item);
        } catch (e) {
            console.error(NAME, 'menu error', e);
        }
    }

    function settings(id, params) {
        queued[id] = (queued[id] || []).concat(params || []);
        if (settingsDone) {
            (params || []).forEach(addParam);
        }
    }

    function start() {
        request(resolve('manifest.json') + '?t=' + new Date().getTime(), function (data) {
            manifest = data;
            var list = data.plugins || [];
            var seen = {};
            var index = 0;
            (function next() {
                while (index < list.length && !isOn(list[index])) index++;
                if (index >= list.length) return loadExtra();
                var plugin = list[index++];
                loadPlugin(plugin, list, seen, next);
            })();

            function loadExtra() {
                var extra = extraUrls();
                var step = 0;
                (function more() {
                    if (step >= extra.length) return finish();
                    loadScript(extra[step++], more);
                })();
            }

            function finish() {
                try { registerSettings(list); } catch (e) { console.error(NAME, 'settings error', e); }
                addMenuItem();
                console.log(NAME, 'loaded', VERSION);
            }
        }, function () {
            try { registerSettings([]); } catch (e) { console.error(NAME, 'settings error', e); }
            addMenuItem();
            if (Lampa.Noty) Lampa.Noty.show('Watch Plugins: не вдалося завантажити список плагінів');
        });
    }

    window.WatchPlugins = {
        version: VERSION,
        settings: settings,
        baseUrl: baseUrl
    };

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
