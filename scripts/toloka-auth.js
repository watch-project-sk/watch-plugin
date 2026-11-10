'use strict';

const { isLoggedIn } = require('./toloka-parse');

const BASE = 'https://toloka.to/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function parseSetCookies(lines) {
    const jar = {};
    (lines || []).forEach((line) => {
        const parts = String(line).split(';');
        const eq = parts[0].indexOf('=');
        if (eq < 1) return;
        const name = parts[0].slice(0, eq).trim();
        const value = parts[0].slice(eq + 1).trim();
        const expired = parts.slice(1).some((attr) => {
            const m = attr.trim().match(/^expires=(.+)$/i);
            return m && Date.parse(m[1]) < Date.now();
        });
        if (!value || value === 'deleted' || expired) delete jar[name];
        else jar[name] = value;
    });
    return jar;
}

function mergeJars(base, extra) {
    return Object.assign({}, base, extra);
}

function jarToHeader(jar) {
    return Object.keys(jar).map((name) => name + '=' + jar[name]).join('; ');
}

function setCookieLines(res) {
    if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
    const raw = res.headers.get('set-cookie');
    return raw ? raw.split(/,(?=\s*[^;,\s]+=)/) : [];
}

async function request(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
    try {
        return await fetch(url, Object.assign({ signal: controller.signal, redirect: 'manual' }, options));
    } finally {
        clearTimeout(timer);
    }
}

async function login(user, pass) {
    const baseHeaders = { 'User-Agent': UA, 'Accept-Language': 'uk,en;q=0.8' };
    const first = await request(BASE + 'login.php', { headers: baseHeaders });
    await first.text();
    let jar = parseSetCookies(setCookieLines(first));
    const body = new URLSearchParams({
        username: user,
        password: pass,
        autologin: 'on',
        redirect: '',
        login: 'Вхід'
    });
    const res = await request(BASE + 'login.php', {
        method: 'POST',
        headers: Object.assign({}, baseHeaders, {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: BASE + 'login.php',
            Cookie: jarToHeader(jar)
        }),
        body: body.toString()
    });
    await res.text();
    jar = mergeJars(jar, parseSetCookies(setCookieLines(res)));
    const header = jarToHeader(jar);
    const check = await request(BASE, { headers: Object.assign({}, baseHeaders, { Cookie: header }) });
    const html = await check.text();
    if (check.status !== 200 || !isLoggedIn(html)) {
        const err = new Error('Toloka login failed');
        err.code = 'LOGIN_FAILED';
        throw err;
    }
    return header;
}

async function getCookie(env) {
    const user = String(env.TOLOKA_USER || '').trim();
    const pass = String(env.TOLOKA_PASS || '');
    if (user && pass) return login(user, pass);
    return String(env.TOLOKA_COOKIE || '').trim();
}

module.exports = { parseSetCookies, mergeJars, jarToHeader, login, getCookie };
