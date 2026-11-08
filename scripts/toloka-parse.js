'use strict';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
        if (code[0] === '#') {
            const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return ENTITIES[code.toLowerCase()] !== undefined ? ENTITIES[code.toLowerCase()] : m;
    });
}

function firstPostText(html) {
    const starts = [];
    const re = /class="postbody"/g;
    let m;
    while ((m = re.exec(html)) !== null && starts.length < 2) starts.push(m.index);
    if (!starts.length) return '';
    const body = html.slice(starts[0], starts[1] || starts[0] + 120000);
    const text = body
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:div|p|li|tr|span)>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    return decodeEntities(text).replace(/\r/g, '').replace(/[ \t ]+/g, ' ');
}

function cleanStudio(studio) {
    return studio
        .replace(/^\s*(?:студія|студия|студії|studio)\s+/i, '')
        .replace(/[«»"“”„]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function labelFor(type, studio) {
    const t = (type || '').toLowerCase();
    if (/commentary|коментар|описов/.test(t)) return '';
    if (studio) return studio;
    if (/оригінал|original/.test(t)) return 'Оригінал';
    if (/дубльов|дубляж/.test(t)) return 'Дубляж';
    if (/багатоголос/.test(t)) return 'Багатоголосий';
    if (/двоголос/.test(t)) return 'Двоголосий';
    if (/одноголос|авторськ/.test(t)) return 'Одноголосий';
    return '';
}

function splitTranslation(value) {
    const parts = value.split('|');
    const type = parts[0].trim();
    const studio = parts.length > 1 ? cleanStudio(parts.slice(1).join('|')) : '';
    return { type, studio };
}

function field(block, names) {
    const m = new RegExp('(?:^|\\n)\\s*(?:' + names + ')\\s*:\\s*([^\\n]+)', 'i').exec(block);
    return m ? m[1].trim() : '';
}

function toMbps(value, unit) {
    const n = parseFloat(value.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return 0;
    const mbps = /^[кk]/i.test(unit) ? n / 1000 : n;
    return Math.round(mbps * 10) / 10;
}

function videoBitrateOf(text) {
    const start = text.search(/(?:^|\n)\s*Відео\s*:/i);
    if (start < 0) return 0;
    const rest = text.slice(start);
    const end = rest.search(/Аудіо\s*#/i);
    const section = end > 0 ? rest.slice(0, end) : rest.slice(0, 600);
    const m = /бітрейт\s*:\s*([\d][\d\s.,]*)\s*(мб|mb|кб|kb)/i.exec(section);
    return m ? toMbps(m[1], m[2]) : 0;
}

function parseRelease(html) {
    let text = firstPostText(html);
    const mediaInfo = text.search(/MediaInfo/i);
    if (mediaInfo > 0) text = text.slice(0, mediaInfo);

    const tracks = [];
    const header = /Аудіо\s*#\s*\d+(?:\s*[-–]\s*\d+)?\s*:/gi;
    const heads = [];
    let m;
    while ((m = header.exec(text)) !== null) heads.push({ at: m.index, end: header.lastIndex });

    for (let i = 0; i < heads.length; i++) {
        let block = text.slice(heads[i].end, i + 1 < heads.length ? heads[i + 1].at : undefined);
        const stop = block.search(/Субтитри|Джерело озвуч/i);
        if (stop >= 0) block = block.slice(0, stop);
        const lang = field(block, 'мова');
        const translation = field(block, 'переклад|озвучення|озвучування');
        const codec = field(block, 'кодек');
        const split = splitTranslation(translation);
        tracks.push({ lang, type: split.type, studio: split.studio, codec });
    }

    if (!tracks.length) {
        const line = field(text, 'озвучення|озвучування|переклад');
        if (line) {
            line.split(/[,;]/).forEach((part) => {
                const split = splitTranslation(part);
                tracks.push({ lang: '', type: split.type, studio: split.studio, codec: '' });
            });
        }
    }

    const voices = [];
    tracks.forEach((t) => {
        const label = labelFor(t.type, t.studio);
        if (label && voices.indexOf(label) === -1) voices.push(label);
    });

    return { tracks, voices, videoBitrate: videoBitrateOf(text) };
}

function isLoggedIn(html) {
    return /login\.php\?logout=true/.test(html);
}

module.exports = { parseRelease, isLoggedIn, decodeEntities };
