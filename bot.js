// bot.js - Tích hợp sẵn deobfuscator, không cần require file ngoài
const http = require('http');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('Missing BOT_TOKEN'); process.exit(1); }

// ==================== DEOBFUSCATOR XHIDER v1.2 ====================
const floor = Math.floor;
const char = String.fromCharCode;
const byte = (s, i) => i === undefined ? s.charCodeAt(0) : s.charCodeAt(i - 1);
function xor(a, b) { let r = 0; for (let i = 0; i < 8; i++) r |= ((a >> i) & 1) ^ ((b >> i) & 1) << i; return r; }

function extractConstants(code) {
    const m = code.match(/local u,V\s*=\s*"([^"]*)",\s*"([^"]*)"/);
    if (!m) throw new Error('Không tìm thấy u, V');
    const u = m[1], V = m[2];
    let I = 0x41, R = 0x7F4, p = false;
    const i = code.match(/local I\s*=\s*(0x[0-9a-fA-F]+)/);
    if (i) I = parseInt(i[1], 16);
    const r = code.match(/local R\s*=\s*(0x[0-9a-fA-F]+)/);
    if (r) R = parseInt(r[1], 16);
    const pp = code.match(/local p\s*=\s*(true|false)/);
    if (pp) p = pp[1] === 'true';
    return { u, V, I, R, p };
}

function extractXTable(code) {
    const start = code.indexOf('local X={');
    if (start === -1) throw new Error('Không tìm thấy bảng X');
    let brace = 0, end = start;
    for (let i = start; i < code.length; i++) {
        if (code[i] === '{') brace++;
        else if (code[i] === '}') { brace--; if (brace === 0) { end = i + 1; break; } }
    }
    const table = code.slice(start, end);
    const X = [];
    const re = /\{([^{}]+)\}/g;
    let m;
    while ((m = re.exec(table))) {
        const parts = m[1].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
        const all = [];
        parts.forEach(p => all.push(...p.split(';')));
        if (all.length < 2) continue;
        const p1 = all[0].trim().replace(/^"(.*)"$/, '$1');
        const p2 = all[1].trim().replace(/^"(.*)"$/, '$1');
        let num, str;
        if (/^0x[0-9a-fA-F]+$/.test(p1)) { num = parseInt(p1, 16); str = p2; }
        else if (/^0x[0-9a-fA-F]+$/.test(p2)) { num = parseInt(p2, 16); str = p1; }
        else continue;
        X.push([num, str]);
    }
    return X;
}

function decode(enc, u, V, I, R, p) {
    const L = [];
    for (let i = 0; i < enc.length; i += 5) {
        const b = [];
        for (let j = 0; j < 5; j++) b.push(i + j < enc.length ? byte(enc, i + j + 1) : 0x23);
        const B = (b[0]-0x23)*0x31C84B1 + (b[1]-0x23)*0x95EED + (b[2]-0x23)*0x1C39 + (b[3]-0x23)*0x55 + (b[4]-0x23);
        L.push(floor(B/0x1000000)%0x100, floor(B/0x10000)%0x100, floor(B/0x100)%0x100, B%0x100);
    }
    const H = [0,0,0,0,0];
    for (let j = 0; j < 4; j++) {
        let h = ((L[j] - R) + 0x100) % 0x100;
        h = xor(h, byte(u, (j%0x10)+1));
        h = xor(h, byte(V, (j%I)+1));
        H[j+1] = h;
    }
    const len = H[1] + H[2]*0x100 + H[3]*0x10000 + H[4]*0x1000000;
    const res = [];
    for (let k = 1; k <= len; k++) {
        let h = L[k+3];
        if (p && k%2===0) h = (h%0x10)*0x10 + floor(h/0x10);
        h = ((h - R) + 0x100) % 0x100;
        h = xor(h, byte(u, (k-1)%0x10+1));
        h = xor(h, byte(V, (k-1)%I+1));
        res.push(h);
    }
    return char(...res);
}

function buildMapping(X, u, V, I, R, p) {
    const map = {};
    for (const [num, enc] of X) { try { map[num] = decode(enc, u, V, I, R, p); } catch {} }
    return map;
}

function replaceStrings(code, map) {
    code = code.replace(/h\s*\[\s*n\s*\(\s*(0x[0-9a-fA-F]+)\s*\)\s*\]/g, (m, hex) => {
        const num = parseInt(hex, 16);
        return map[num] ? JSON.stringify(map[num]) : m;
    });
    code = code.replace(/h\s*\[\s*(0x[0-9a-fA-F]+)\s*\]/g, (m, hex) => {
        const num = parseInt(hex, 16);
        return map[num] ? JSON.stringify(map[num]) : m;
    });
    return code;
}

function removeDead(code) {
    code = code.replace(/local u,V\s*=\s*"[^"]*",\s*"[^"]*"/g, '');
    code = code.replace(/local I\s*=\s*0x[0-9a-fA-F]+;?\s*local R\s*=\s*0x[0-9a-fA-F]+;?\s*local p\s*=\s*(true|false);?/g, '');
    code = code.replace(/local X\s*=\s*\{[\s\S]*?\};?/g, '');
    code = code.replace(/local function g\([^)]*\)[\s\S]*?end;?/g, '');
    code = code.replace(/function n\([^)]*\)[\s\S]*?end;?/g, '');
    code = code.replace(/h\s*=\s*setmetatable\s*\(\s*\{\s*\}\s*,\s*\{[\s\S]*?\}\s*\)/g, '');
    code = code.replace(/local B\s*=\s*\{\s*\};?/g, '');
    return code;
}

function flattenCF(code) {
    const whileRe = /while\s+U\s+do\s*([\s\S]*?)\nend\s*$/;
    const match = code.match(whileRe);
    if (!match) return code;
    const body = match[1];
    const initU = code.match(/U\s*=\s*(0x[0-9a-fA-F]+)/);
    let cur = initU ? parseInt(initU[1], 16) : null;
    if (cur === null) return code;
    const blocks = [];
    const ifRe = /if\s+U\s*<\s*(0x[0-9a-fA-F]+)\s+then\s+([\s\S]*?)(?=\n\s*elseif|\n\s*else|\n\s*end)/g;
    let m;
    while ((m = ifRe.exec(body))) {
        const threshold = parseInt(m[1], 16);
        const block = m[2];
        const nextU = block.match(/U\s*=\s*(0x[0-9a-fA-F]+)/);
        blocks.push({ threshold, next: nextU ? parseInt(nextU[1], 16) : null, code: block });
    }
    if (!blocks.length) return code;
    blocks.sort((a, b) => b.threshold - a.threshold);
    const order = [];
    const visited = new Set();
    while (cur !== null && !visited.has(cur)) {
        visited.add(cur);
        const block = blocks.find(b => cur < b.threshold);
        if (!block) break;
        order.push(block);
        cur = block.next;
    }
    const newBody = order.map(b => b.code.trim()).join('\n');
    code = code.replace(whileRe, newBody);
    code = code.replace(/U\s*=\s*0x[0-9a-fA-F]+;?\s*/g, '');
    return code;
}

function deobfuscate(code) {
    const { u, V, I, R, p } = extractConstants(code);
    const X = extractXTable(code);
    const map = buildMapping(X, u, V, I, R, p);
    code = replaceStrings(code, map);
    code = removeDead(code);
    code = flattenCF(code);
    return code.trim();
}
// ==================== END DEOBFUSCATOR ====================

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on('ready', () => console.log(`✅ Bot online: ${client.user.tag}`));

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!deobf')) return;

    const attachment = message.attachments.first();
    let code = null;

    if (attachment && attachment.name.endsWith('.lua')) {
        const res = await fetch(attachment.url);
        code = await res.text();
    } else {
        const link = message.content.match(/(https?:\/\/\S+\.lua(?:\?\S*)?)/);
        if (link) {
            const res = await fetch(link[0]);
            code = await res.text();
        }
    }

    if (!code) return message.reply('❌ Đính kèm file .lua hoặc link raw.');

    // Kiểm tra XHider
    if (!code.includes('local u,V') && !code.includes('XHider')) {
        return message.reply('⚠️ File không phải XHider obfuscated.');
    }

    try {
        const clean = deobfuscate(code);
        const buf = Buffer.from(clean, 'utf-8');
        const file = new AttachmentBuilder(buf, { name: 'deobfuscated.lua' });
        await message.reply({ content: '✅ Deobfuscate thành công!', files: [file] });
    } catch (e) {
        await message.reply(`❌ Lỗi: ${e.message}`);
    }
});

// HTTP server giữ Render alive
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 3000);
client.login(BOT_TOKEN);
