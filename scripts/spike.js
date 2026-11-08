'use strict';

const { parseRelease, isLoggedIn } = require('./toloka-parse');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function main() {
    const cookie = String(process.env.TOLOKA_COOKIE || '').trim();
    const id = String(process.env.SPIKE_ID || '687211');
    if (!cookie) {
        console.error('TOLOKA_COOKIE is not set');
        process.exit(1);
    }
    const res = await fetch('https://toloka.to/t' + id, { headers: { Cookie: cookie, 'User-Agent': UA, 'Accept-Language': 'uk,en;q=0.8' } });
    const html = await res.text();
    console.log('http status', res.status);
    console.log('logged in', isLoggedIn(html));
    if (res.status !== 200) process.exit(3);
    if (!isLoggedIn(html)) process.exit(2);
    const parsed = parseRelease(html);
    console.log('voices', parsed.voices.join(' · '), '| bitrate', parsed.videoBitrate);
    if (!parsed.voices.length) process.exit(4);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
