(function () {
    'use strict';

    if (typeof Lampa === 'undefined' || window.__uat_torrent_files) return;
    window.__uat_torrent_files = true;

    var NAME = 'UA Torrent Files';
    var SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
    var ICONS = SCRIPT_SRC.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') + 'icons/';
    var COMPONENT = 'uat_torrent_files';
    var VIEWED_PERCENT = 80;
    var REFRESH_MS = 1500;
    var session = null;
    var flow = null;
    var preload = null;
    var pageActive = false;
    var originalOpen = null;
    var CSS = '.uat-eps{display:flex;flex-direction:column;height:100%;min-height:0;padding:0 1.5em}' +
        '.uat-eps>.scroll{flex:1 1 0;height:auto;min-height:0}' +
        '.uat-tabs{display:flex;flex-shrink:0;gap:.7em;padding:.5em .4em 1em;overflow:hidden;white-space:nowrap;scroll-behavior:smooth}' +
        '.uat-tab{flex-shrink:0;padding:.75em 1.5em;border-radius:100em;background:#292b2b;font-size:.89em;font-weight:600;line-height:1.2}' +
        '.uat-tab--active{background:#fff;color:#1d1f20}' +
        '.uat-tab.focus{box-shadow:0 0 0 .15em #1d1f20,0 0 0 .3em #fff}' +
        '.uat-ep{position:relative;display:flex;align-items:center;height:11.134em;margin:.4em .4em 1.113em}' +
        '.uat-ep::after{content:"";position:absolute;left:-.334em;right:-.334em;top:-.334em;bottom:-.334em;border:.223em solid #fff;border-radius:.89em;opacity:0;pointer-events:none}' +
        '.uat-ep.focus::after{opacity:1}' +
        '.uat-ep-season{display:flex;align-items:center;gap:1.5em;padding-top:.75em;margin:0 .4em 1.25em;font-size:.89em;font-weight:600;line-height:1.2;text-transform:uppercase;color:rgba(255,255,255,.6)}' +
        '.uat-ep-season::after{content:"";flex:1;height:1px;background:#292b2b}' +
        '.uat-ep__media{position:relative;width:19.762em;height:11.134em;flex-shrink:0;border-radius:.668em;overflow:hidden;background:rgba(0,0,0,.3)}' +
        '.uat-ep__img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s}' +
        '.uat-ep__img--loaded{opacity:1}' +
        '.uat-ep__shade{position:absolute;left:0;right:0;bottom:0;padding:.445em .668em;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.8) 100%)}' +
        '.uat-ep__row{display:flex;align-items:center;gap:.75em;min-height:1.2em;font-size:.89em;font-weight:600;line-height:1.2;white-space:nowrap}' +
        '.uat-ep__icon{width:1em;height:1em;flex-shrink:0}' +
        '.uat-ep--loading .uat-ep__icon{width:1.5em;height:1.5em}' +
        '.uat-ep__bar{flex-shrink:0;width:3em;height:.5em;border-radius:100em;background:rgba(255,255,255,.25);overflow:hidden}' +
        '.uat-ep__fill{display:block;height:100%;background:#fff}' +
        '.uat-ep__body{flex:1;min-width:0;height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:.445em;padding:1.113em 2.227em;overflow:hidden}' +
        '.uat-ep__body>*{flex-shrink:0}' +
        '.uat-ep__num{font-size:.89em;font-weight:600;line-height:1.2;opacity:.6;text-transform:uppercase}' +
        '.uat-ep__title{font-size:1.336em;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.uat-ep__descr{height:4.5em;font-size:.89em;font-weight:400;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}' +
        '.uat-ep__meta{display:flex;align-items:center;gap:.75em;font-size:.89em;font-weight:600;line-height:1;opacity:.5}' +
        '.uat-ep__rate{display:flex;align-items:center;gap:.5em}' +
        '.uat-ep__rate img{width:1em;height:1em}' +
        '.uat-eps-empty{padding:3em 1.5em;text-align:center;opacity:.7}' +
        '.uat-eps-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4em 1.5em;text-align:center}' +
        '.uat-eps-loader .modal-loading{width:8em}' +
        '.uat-eps-loader__text{margin-top:1em;opacity:.7}';

    Lampa.Lang.add({
        uat_tf_episode: { en: 'Episode', uk: 'Серія' },
        uat_tf_season: { en: 'Season', uk: 'Сезон' },
        uat_tf_files: { en: 'Files', uk: 'Файли' },
        uat_tf_empty: { en: 'No files', uk: 'Немає файлів' },
        uat_tf_loading: { en: 'Loading torrent…', uk: 'Завантаження торента…' }
    });

    function minutesText(minutes) {
        var m = Math.max(1, Math.round(minutes));
        if (m >= 60) return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
        return m + ' m';
    }

    function etaText(seconds) {
        if (seconds < 90) return '~ ' + Math.max(1, Math.ceil(seconds)) + 's';
        return '~ ' + Math.ceil(seconds / 60) + 'm';
    }

    function dateText(value) {
        if (!value) return '';
        var date = new Date(value);
        if (isNaN(date.getTime())) return '';
        try {
            return date.toLocaleDateString('uk-UA', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (err) {
            return value;
        }
    }

    function groupOf(element) {
        return element.season > 0 && element.episode > 0 ? element.season : 0;
    }

    function episodeMeta(params, element) {
        var season = params.seasons && params.seasons[element.season];
        if (!season || !season.episodes || !element.episode) return null;
        for (var i = 0; i < season.episodes.length; i++) {
            if (season.episodes[i].episode_number == element.episode) return season.episodes[i];
        }
        return null;
    }

    function buildEntries(data) {
        var entries = data.items.map(function (element, index) {
            return { element: element, index: index, group: groupOf(element), meta: episodeMeta(data.params, element), node: null, sig: '', loading: null };
        });
        entries.sort(function (a, b) {
            if (a.group !== b.group) return (a.group || 9999) - (b.group || 9999);
            return (a.element.episode - b.element.episode) || (a.index - b.index);
        });
        return entries;
    }

    function rawStore() {
        var raw = window.localStorage.getItem(Lampa.Timeline.filename());
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    }

    function primeModal() {
        try {
            Lampa.Modal.close();
        } catch (err) {
            originalOpen.call(Lampa.Modal, { title: '', html: $('<div></div>'), size: 'small', onBack: function () {} });
            Lampa.Modal.close();
        }
    }

    function TorrentFiles(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var myFlow = flow;
        var data = null;
        var card = object.movie || {};
        var mode = 'loading';
        var wrapper = $('<div class="uat-eps"><div class="uat-tabs"></div></div>');
        var tabsBox = wrapper.find('.uat-tabs');
        var cards = [];
        var tabs = [];
        var zone = 'list';
        var ci = 0;
        var ti = 0;
        var destroyed = false;
        var timer = null;
        var onVisible = null;
        var lastRaw = null;

        function progressOf(entry) {
            var view = entry.element.timeline;
            if (!view) return null;
            var runtime = entry.meta && entry.meta.runtime ? entry.meta.runtime * 60 : 0;
            var time = Number(view.time) || 0;
            var duration = Number(view.duration) || runtime;
            var percent = Number(view.percent) || 0;
            var rest = 0;
            if (time > 0 && view.duration > 0) rest = view.duration - time;
            else if (percent > 0 && duration) rest = duration * (1 - percent / 100);
            return { percent: percent, duration: duration, rest: rest };
        }

        function stateOf(progress) {
            if (progress && progress.percent >= VIEWED_PERCENT) return 'viewed';
            if (progress && progress.percent > 0) return 'partial';
            return 'new';
        }

        function paint(entry) {
            if (!entry.node) return;
            var progress = progressOf(entry);
            var state = entry.loading ? 'loading' : stateOf(progress);
            var runtime = entry.meta && entry.meta.runtime ? entry.meta.runtime * 60 : 0;
            var duration = (progress && progress.duration) || runtime;
            var icon = 'play.svg';
            var text = '';
            var bar = null;
            if (state === 'loading') {
                icon = 'downloading-loop.svg';
                bar = entry.loading.percent;
                text = entry.loading.percent + '%' + (entry.loading.eta ? ' · ' + entry.loading.eta : '');
            } else if (state === 'viewed') {
                icon = 'replay.svg';
                text = duration ? minutesText(duration / 60) : '';
            } else if (state === 'partial') {
                bar = Math.max(2, Math.min(100, Math.round(progress.percent)));
                text = progress.rest > 0 ? minutesText(progress.rest / 60) : '';
            } else {
                text = duration ? minutesText(duration / 60) : '';
            }
            var sig = state + '|' + text + '|' + (bar === null ? '' : bar);
            if (entry.sig === sig) return;
            entry.sig = sig;
            entry.node.toggleClass('uat-ep--loading', state === 'loading');
            var iconNode = entry.node.find('.uat-ep__icon');
            if (iconNode.attr('data-icon') !== icon) iconNode.attr('data-icon', icon).attr('src', ICONS + icon);
            entry.node.find('.uat-ep__bar').css('display', bar === null ? 'none' : '').find('.uat-ep__fill').css('width', (bar || 0) + '%');
            entry.node.find('.uat-ep__text').text(text);
        }

        function paintAll() {
            cards.forEach(paint);
        }

        function syncViews() {
            try {
                var fresh = rawStore();
                if (fresh) {
                    Lampa.Storage.set(Lampa.Timeline.filename(), fresh);
                    Lampa.Timeline.read(true);
                }
                cards.forEach(function (entry) {
                    var view = entry.element.timeline;
                    if (!view || !view.hash) return;
                    var meta = view.card ? { card: view.card, season: view.season, episode: view.episode } : undefined;
                    var latest = Lampa.Timeline.view(view.hash, meta);
                    view.percent = latest.percent;
                    view.time = latest.time;
                    if (latest.duration) view.duration = latest.duration;
                });
                lastRaw = window.localStorage.getItem(Lampa.Timeline.filename());
            } catch (err) {
                console.error(NAME, 'timeline sync error', err);
            }
            paintAll();
        }

        function markFocus(el) {
            wrapper.find('.focus').removeClass('focus');
            $(el).addClass('focus');
        }

        function focusEl(el) {
            Lampa.Controller.collectionFocus(el, wrapper[0]);
        }

        function firstOfTab(index) {
            for (var i = 0; i < cards.length; i++) if (cards[i].tab === index) return i;
            return 0;
        }

        function activateTab(index) {
            ti = index;
            tabs.forEach(function (tab, i) { tab.node.toggleClass('uat-tab--active', i === index); });
            var node = tabs[index] && tabs[index].node[0];
            if (node) tabsBox[0].scrollLeft = Math.max(0, node.offsetLeft - tabs[0].node[0].offsetLeft);
        }

        function focusCard(index) {
            ci = index;
            zone = 'list';
            focusEl(cards[index].node[0]);
        }

        function focusTab(index) {
            ti = index;
            zone = 'tabs';
            focusEl(tabs[index].node[0]);
        }

        function play(entry) {
            if (preload) return;
            var item = data.nodes[entry.index];
            if (!item) return;
            syncViews();
            preload = { entry: entry, active: false, cancel: null, started: Date.now() };
            item.trigger('hover:enter');
            if (preload && !preload.active) preload = null;
        }

        function menu(entry) {
            if (preload) return;
            var item = data.nodes[entry.index];
            if (item) item.trigger('hover:long');
        }

        function titleOf(entry) {
            if (entry.meta && entry.meta.name) return entry.meta.name;
            return String(entry.element.fname || entry.element.path_human || entry.element.title || '').replace(/^\d+\s\/\s/, '');
        }

        function renderCard(entry, index) {
            var element = entry.element;
            var ep = entry.meta || {};
            var node = $('<div class="uat-ep selector">' +
                '<div class="uat-ep__media"><img class="uat-ep__img" alt="">' +
                '<div class="uat-ep__shade"><div class="uat-ep__row"><img class="uat-ep__icon" alt="">' +
                '<div class="uat-ep__bar"><div class="uat-ep__fill"></div></div><div class="uat-ep__text"></div></div></div></div>' +
                '<div class="uat-ep__body"><div class="uat-ep__num"></div><div class="uat-ep__title"></div>' +
                '<div class="uat-ep__descr"></div><div class="uat-ep__meta"></div></div></div>');
            node.find('.uat-ep__num').text(element.episode > 0 ? Lampa.Lang.translate('uat_tf_episode') + ' ' + element.episode : (element.size || ''));
            node.find('.uat-ep__title').text(titleOf(entry));
            node.find('.uat-ep__descr').text(ep.overview || (element.episode > 0 ? '' : card.overview || ''));
            var meta = node.find('.uat-ep__meta');
            var add = function (part) {
                if (meta.children().length) meta.append('<span>·</span>');
                meta.append(part);
            };
            if (ep.vote_average > 0) add($('<span class="uat-ep__rate"><img alt="" src="' + ICONS + 'star.svg"><span></span></span>').find('span').text(ep.vote_average.toFixed(1)).end());
            var date = dateText(ep.air_date);
            if (date) add($('<span></span>').text(date));
            if (element.episode > 0 && element.size) add($('<span></span>').text(element.size));
            var image = node.find('.uat-ep__img')[0];
            var still = ep.still_path || card.backdrop_path;
            if (still) {
                image.onload = function () { $(image).addClass('uat-ep__img--loaded'); };
                image.src = Lampa.Api.sources.tmdb.img(still, 'w500');
            } else if (element.img && element.img.indexOf('img_broken') === -1) {
                image.onload = function () { $(image).addClass('uat-ep__img--loaded'); };
                image.src = element.img;
            }
            node.on('hover:focus', function () {
                ci = index;
                zone = 'list';
                markFocus(node[0]);
                if (tabs.length && entry.tab !== ti) activateTab(entry.tab);
                scroll.update(node, true);
            });
            node.on('hover:hover hover:touch', function () { focusEl(node[0]); });
            node.on('hover:enter', function () { play(entry); });
            node.on('hover:long', function () { menu(entry); });
            entry.node = node;
            entry.repaint = function () { paint(entry); };
            paint(entry);
            return node;
        }

        function groupTitle(group) {
            return group > 0 ? Lampa.Lang.translate('uat_tf_season') + ' ' + group : Lampa.Lang.translate('uat_tf_files');
        }

        function resetLists() {
            tabsBox.empty();
            scroll.clear();
            cards = [];
            tabs = [];
            ci = 0;
            ti = 0;
            zone = 'list';
        }

        function showLoader() {
            mode = 'loading';
            resetLists();
            tabsBox.css('display', 'none');
            scroll.append($('<div class="uat-eps-loader"><div class="modal-loading"></div><div class="uat-eps-loader__text"></div></div>'));
            wrapper.find('.uat-eps-loader__text').text(Lampa.Lang.translate('uat_tf_loading'));
        }

        function showMessage(text) {
            resetLists();
            tabsBox.css('display', 'none');
            scroll.append($('<div class="uat-eps-empty"></div>').text(text));
        }

        function build() {
            mode = 'files';
            resetLists();
            var entries = buildEntries(data);
            if (!entries.length) return showMessage(Lampa.Lang.translate('uat_tf_empty'));
            var groups = [];
            entries.forEach(function (entry) {
                if (groups.indexOf(entry.group) === -1) groups.push(entry.group);
            });
            var hasTabs = groups.length > 1 || groups[0] > 0;
            tabsBox.css('display', hasTabs ? '' : 'none');
            tabs = hasTabs ? groups.map(function (group, index) {
                var node = $('<div class="uat-tab selector"></div>').text(groupTitle(group));
                node.on('hover:focus', function () {
                    zone = 'tabs';
                    markFocus(node[0]);
                    activateTab(index);
                    ci = firstOfTab(index);
                    scroll.update(cards[ci].node, true);
                });
                node.on('hover:hover hover:touch', function () { focusEl(node[0]); });
                node.on('hover:enter', function () { focusCard(firstOfTab(index)); });
                tabsBox.append(node);
                return { group: group, node: node };
            }) : [];
            cards = entries;
            cards.forEach(function (entry, index) {
                entry.tab = groups.indexOf(entry.group);
                var node = renderCard(entry, index);
                if (hasTabs && (index === 0 || entry.tab !== cards[index - 1].tab)) {
                    scroll.append($('<div class="uat-ep-season"></div>').text(groupTitle(entry.group)));
                }
                scroll.append(node);
            });
            for (var i = 0; i < cards.length; i++) {
                if (stateOf(progressOf(cards[i])) !== 'viewed') {
                    ci = i;
                    break;
                }
            }
            ti = hasTabs ? cards[ci].tab : 0;
            if (hasTabs) activateTab(ti);
            zone = 'list';
        }

        function refocus() {
            if (pageActive && !destroyed) Lampa.Controller.toggle('content');
        }

        function tick() {
            if (destroyed || !cards.length) return;
            var active = Lampa.Controller.enabled ? Lampa.Controller.enabled().name : 'content';
            if (active !== 'content') return;
            if (mode === 'files' && window.localStorage.getItem(Lampa.Timeline.filename()) !== lastRaw) syncViews();
            else paintAll();
        }

        function startTimer() {
            if (!timer) timer = setInterval(tick, REFRESH_MS);
        }

        function stopTimer() {
            if (timer) clearInterval(timer);
            timer = null;
        }

        function cleanup() {
            try {
                if (mode === 'files') {
                    var hash = data && data.items.length && data.items[0].torrent_hash;
                    if (hash) Lampa.Torserver.drop(hash);
                    Lampa.Torserver.clear();
                    Lampa.Listener.send('torrent_file', { type: 'list_close' });
                } else if (myFlow && myFlow.opts && typeof myFlow.opts.onBack === 'function') {
                    var before = Lampa.Controller.enabled ? Lampa.Controller.enabled().name : 'content';
                    primeModal();
                    myFlow.opts.onBack();
                    Lampa.Controller.toggle(before);
                }
            } catch (err) {
                console.error(NAME, 'cleanup error', err);
            }
        }

        this.receive = function (html, snapshot) {
            if (destroyed) return;
            if (html && html.hasClass && html.hasClass('torrent-files') && snapshot) {
                data = snapshot;
                card = data.params.movie || card;
                build();
                if (pageActive) {
                    refocus();
                    paintAll();
                }
            } else {
                mode = 'error';
                var text = html && html.text ? $.trim(html.text().replace(/\s+/g, ' ')) : '';
                showMessage(text || Lampa.Lang.translate('uat_tf_empty'));
                if (pageActive) refocus();
            }
        };

        this.create = function () {
            onVisible = function () {
                if (!destroyed && mode === 'files' && document.visibilityState !== 'hidden') syncViews();
            };
            document.addEventListener('visibilitychange', onVisible);
            window.addEventListener('focus', onVisible);
            files.appendFiles(wrapper);
            wrapper.append(scroll.render());
            showLoader();
            if (myFlow) {
                myFlow.page = self;
                if (myFlow.received) self.receive(myFlow.received.html, myFlow.received.session);
            }
            return this.render();
        };

        this.start = function () {
            pageActive = true;
            if (Lampa.Background && Lampa.Background.immediately && Lampa.Utils.cardImgBackgroundBlur) {
                Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(card));
            }
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(wrapper);
                    if (!cards.length) return Lampa.Controller.collectionFocus(false, wrapper[0]);
                    if (zone === 'tabs' && tabs[ti]) focusEl(tabs[ti].node[0]);
                    else focusEl(cards[ci].node[0]);
                },
                up: function () {
                    if (zone === 'tabs' || !cards.length) return Lampa.Controller.toggle('head');
                    if (ci > 0) focusCard(ci - 1);
                    else if (tabs.length) focusTab(ti);
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (!cards.length) return;
                    if (zone === 'tabs') focusCard(ci);
                    else if (ci < cards.length - 1) focusCard(ci + 1);
                },
                left: function () {
                    if (!cards.length) return Lampa.Controller.toggle('menu');
                    if (ti > 0 && tabs.length) {
                        if (zone === 'tabs') focusTab(ti - 1);
                        else focusCard(firstOfTab(ti - 1));
                    } else {
                        Lampa.Controller.toggle('menu');
                    }
                },
                right: function () {
                    if (!cards.length || !tabs.length || ti >= tabs.length - 1) return;
                    if (zone === 'tabs') focusTab(ti + 1);
                    else focusCard(firstOfTab(ti + 1));
                },
                back: function () {
                    if (preload && preload.cancel) return preload.cancel();
                    Lampa.Activity.backward();
                }
            });
            Lampa.Controller.toggle('content');
            syncViews();
            startTimer();
        };

        this.pause = function () {
            pageActive = false;
            stopTimer();
        };
        this.stop = function () {
            pageActive = false;
            stopTimer();
        };
        this.render = function () { return files.render(); };
        this.destroy = function () {
            if (destroyed) return;
            destroyed = true;
            pageActive = false;
            stopTimer();
            if (onVisible) {
                document.removeEventListener('visibilitychange', onVisible);
                window.removeEventListener('focus', onVisible);
            }
            if (preload && preload.cancel) {
                try { preload.cancel(); } catch (err) { console.error(NAME, 'preload cancel error', err); }
            }
            preload = null;
            cleanup();
            if (flow === myFlow) flow = null;
            scroll.destroy();
            files.destroy();
        };
    }

    function openPage(current) {
        var movie = current.movie || {};
        Lampa.Activity.push({
            url: '',
            title: movie.name || movie.title || '',
            component: COMPONENT,
            movie: movie,
            page: 1
        });
    }

    function hookTorrent() {
        ['start', 'open'].forEach(function (name) {
            var original = Lampa.Torrent[name];
            Lampa.Torrent[name] = function (first, second) {
                flow = { armed: true, opts: null, page: null, received: null, movie: second };
                return original.apply(this, arguments);
            };
        });
    }

    function hookModal() {
        originalOpen = Lampa.Modal.open;
        Lampa.Modal.open = function (params) {
            if (flow && flow.armed) {
                flow.armed = false;
                if (params && params.html && params.html.hasClass && params.html.hasClass('modal-loading')) {
                    flow.opts = params;
                    openPage(flow);
                    return;
                }
            }
            return originalOpen.apply(this, arguments);
        };
        var originalUpdate = Lampa.Modal.update;
        Lampa.Modal.update = function (html) {
            if (flow && flow.opts && !Lampa.Modal.opened()) {
                var snapshot = session;
                if (flow.page) flow.page.receive(html, snapshot);
                else flow.received = { html: html, session: snapshot };
                return;
            }
            return originalUpdate.apply(this, arguments);
        };
    }

    function hookLoading() {
        var loading = Lampa.Loading;
        var start = loading.start;
        var stop = loading.stop;
        var setProgress = loading.setProgress;
        var setText = loading.setText;
        var entryOf = function () { return preload && preload.entry; };
        loading.start = function (cancel, text, opts) {
            if (preload && opts && opts.media) {
                preload.active = true;
                preload.cancel = cancel;
                preload.started = Date.now();
                preload.entry.loading = { percent: 0, eta: '' };
                preload.entry.sig = '';
                repaint(preload.entry);
                return;
            }
            return start.apply(this, arguments);
        };
        loading.stop = function () {
            if (preload && preload.active) {
                var entry = entryOf();
                entry.loading = null;
                entry.sig = '';
                preload = null;
                repaint(entry);
                return;
            }
            return stop.apply(this, arguments);
        };
        loading.setProgress = function (progress) {
            if (preload && preload.active) {
                var entry = entryOf();
                var percent = Math.max(0, Math.min(100, Math.round(progress || 0)));
                var elapsed = (Date.now() - preload.started) / 1000;
                entry.loading = { percent: percent, eta: percent >= 2 && elapsed > 1 ? etaText(elapsed * (100 - percent) / percent) : '' };
                repaint(entry);
                return;
            }
            return setProgress.apply(this, arguments);
        };
        loading.setText = function () {
            if (preload && preload.active) return;
            return setText.apply(this, arguments);
        };
    }

    function repaint(entry) {
        if (entry && entry.repaint) entry.repaint();
    }

    function init() {
        try {
            var style = document.createElement('style');
            style.setAttribute('data-uat-torrent-files', 'true');
            style.innerHTML = CSS;
            document.head.appendChild(style);
        } catch (err) {
            console.error(NAME, 'style error', err);
        }
        Lampa.Component.add(COMPONENT, TorrentFiles);
        hookModal();
        hookTorrent();
        hookLoading();
        Lampa.Listener.follow('torrent_file', function (e) {
            if (!e) return;
            if (e.type === 'list_open') {
                session = { items: e.items || [], params: e.params || {}, nodes: [] };
            } else if (e.type === 'render' && session && e.item) {
                var index = session.items.indexOf(e.element);
                if (index !== -1) session.nodes[index] = e.item;
            } else if (e.type === 'onenter' && pageActive) {
                Lampa.Player.callback(function () { Lampa.Controller.toggle('content'); });
            }
        });
        console.log(NAME, 'loaded');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
