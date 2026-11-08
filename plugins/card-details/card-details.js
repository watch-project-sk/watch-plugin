(function () {
    'use strict';

    if (typeof Lampa === 'undefined' || window.__uat_card_details) return;
    window.__uat_card_details = true;

    var NAME = 'Card Details';
    var DIRECTOR_JOB = 'Director';
    var REMOVED = '.full-descr__tags';
    var CSS = '.uat-block-start{margin-left:3em !important}' + REMOVED + '{display:none !important}' +
        '@media (min-width:700px){.full-descr__details{flex-wrap:nowrap !important}.full-descr__details > *{flex:0 1 auto}}';

    function copy(source) {
        var out = {};
        for (var key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
        }
        return out;
    }

    function directorsOf(crew) {
        var seen = {};
        var out = [];
        (crew || []).forEach(function (member) {
            if (!member || member.job !== DIRECTOR_JOB || seen[member.id]) return;
            seen[member.id] = true;
            var director = copy(member);
            director.character = Lampa.Lang.translate('title_producer');
            director.uat_director = true;
            out.push(director);
        });
        return out;
    }

    function reshape(data) {
        if (!data) return;
        data.discuss = undefined;
        var persons = data.persons;
        if (!persons || !Array.isArray(persons.crew)) return;
        var directors = directorsOf(persons.crew);
        if (!directors.length) return;
        var cast = Array.isArray(persons.cast) ? persons.cast.slice() : [];
        if (cast.length) cast[0] = (function (first) {
            var marked = copy(first);
            marked.uat_first_actor = true;
            return marked;
        })(cast[0]);
        persons.cast = directors.concat(cast);
        persons.crew = persons.crew.filter(function (member) { return member && member.job !== DIRECTOR_JOB; });
    }

    function patchFull() {
        var api = Lampa.Api;
        if (!api || typeof api.full !== 'function' || api._uatCardDetails) return;
        var original = api.full;
        api.full = function (params, oncomplite, onerror) {
            if (typeof oncomplite !== 'function') return original.apply(this, arguments);
            return original.call(this, params, function (data) {
                try {
                    reshape(data);
                } catch (err) {
                    console.error(NAME, 'reshape error', err);
                }
                return oncomplite.apply(this, arguments);
            }, onerror);
        };
        api._uatCardDetails = true;
    }

    function strip(root) {
        $(root).find(REMOVED).remove();
    }

    function stripDescription(e) {
        var body = $(e.body);
        strip(body);
        var holder = body.find('.full-descr')[0];
        if (!holder || !window.MutationObserver || holder._uatObserved) return;
        holder._uatObserved = true;
        new MutationObserver(function () { strip(holder); }).observe(holder, { childList: true, subtree: true });
    }

    function decorate(e) {
        var results = e && e.data && e.data.results;
        if (e.name !== 'persons' || !results || !results[0] || !results[0].uat_director) return;
        var line = $(e.item.render(true) || e.item.render());
        line.find('.items-line__title').text(Lampa.Lang.translate('title_producer') + ' · ' + Lampa.Lang.translate('title_actors'));
        (e.item.items || []).forEach(function (card) {
            if (card && card.data && card.data.uat_first_actor && card.render) {
                $(card.render(true) || card.render()).addClass('uat-block-start');
            }
        });
    }

    function init() {
        try {
            var style = document.createElement('style');
            style.setAttribute('data-uat-card', 'true');
            style.innerHTML = CSS;
            document.head.appendChild(style);
        } catch (err) {
            console.error(NAME, 'style error', err);
        }
        try { patchFull(); } catch (err) { console.error(NAME, 'full error', err); }
        Lampa.Listener.follow('full', function (e) {
            if (!e) return;
            try {
                if (e.type === 'build') {
                    if (e.name === 'description') stripDescription(e);
                    decorate(e);
                } else if (e.type === 'complite') {
                    stripDescription(e);
                }
            } catch (err) {
                console.error(NAME, 'full event error', err);
            }
        });
        console.log(NAME, 'loaded');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
