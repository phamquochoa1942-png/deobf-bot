// deobfuscator.js
const luaFloor = Math.floor;
const luaChar = String.fromCharCode;
const luaByte = (s, i) => i === undefined ? s.charCodeAt(0) : s.charCodeAt(i - 1);

function luaXor(a, b) {
    let r = 0;
    for (let i = 0; i < 8; i++) {
        r |= (((a >> i) & 1) ^ ((b >> i) & 1)) << i;
    }
    return r;
}

function extractConstants(code) {
    const uvMatch = code.match(/local u,V\s*=\s*"([^"]*)",\s*"([^"]*)"/);
    if (!uvMatch) throw new Error("Không tìm thấy u, V");
    const u = uvMatch[1], V = uvMatch[2];
    let I = 0x41, R = 0x7F4, p = false;
    const iMatch = code.match(/local I\s*=\s*(0x[0-9a-fA-F]+)/);
    if (iMatch) I = parseInt(iMatch[1], 16);
    const rMatch = code.match(/local R\s*=\s*(0x[0-9a-fA-F]+)/);
    if (rMatch) R = parseInt(rMatch[1], 16);
    const pMatch = code.match(/local p\s*=\s*(true|false)/);
    if (pMatch) p = pMatch[1] === 'true';
    return { u, V, I, R, p };
}

function extractXTable(code) {
    const start = code.indexOf('local X={');
    if (start === -1) throw new Error("Không tìm thấy bảng X");
    let brace = 0, endPos = start;
    for (let i = start; i < code.length; i++) {
        if (code[i] === '{') brace++;
        else if (code[i] === '}') {
            brace--;
            if (brace === 0) { endPos = i + 1; break; }
        }
    }
    const table = code.substring(start, endPos);
    const X = [];
    const pairRegex = /\{([^{}]+)\}/g;
    let match;
    while ((match = pairRegex.exec(table)) !== null) {
        const content = match[1].trim();
        const parts = content.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
        const allParts = [];
        parts.forEach(p => allParts.push(...p.split(';')));
        if (allParts.length < 2) continue;
        const p1 = allParts[0].trim().replace(/^"(.*)"$/, '$1');
        const p2 = allParts[1].trim().replace(/^"(.*)"$/, '$1');
        let num, str;
        if (/^0x[0-9a-fA-F]+$/.test(p1)) {
            num = parseInt(p1, 16);
            str = p2;
        } else if (/^0x[0-9a-fA-F]+$/.test(p2)) {
            num = parseInt(p2, 16);
            str = p1;
        } else continue;
        X.push([num, str]);
    }
    return X;
}

function decodeString(enc, u, V, I, R, p) {
    const L = [];
    for (let i = 0; i < enc.length; i += 5) {
        const bytes = [];
        for (let j = 0; j < 5; j++) {
            bytes.push(i + j < enc.length ? luaByte(enc, i + j + 1) : 0x23);
        }
        const B = (bytes[0]-0x23)*0x31C84B1 + (bytes[1]-0x23)*0x95EED + (bytes[2]-0x23)*0x1C39 + (bytes[3]-0x23)*0x55 + (bytes[4]-0x23);
        L.push(luaFloor(B/0x1000000)%0x100, luaFloor(B/0x10000)%0x100, luaFloor(B/0x100)%0x100, B%0x100);
    }
    const H = [0,0,0,0,0];
    for (let j = 0; j < 4; j++) {
        let h = ((L[j] - R) + 0x100) % 0x100;
        h = luaXor(h, luaByte(u, (j%0x10)+1));
        h = luaXor(h, luaByte(V, (j%I)+1));
        H[j+1] = h;
    }
    const length = H[1] + H[2]*0x100 + H[3]*0x10000 + H[4]*0x1000000;
    const result = [];
    for (let k = 1; k <= length; k++) {
        let h = L[k+3];
        if (p && k%2===0) h = (h%0x10)*0x10 + luaFloor(h/0x10);
        h = ((h - R) + 0x100) % 0x100;
        h = luaXor(h, luaByte(u, (k-1)%0x10+1));
        h = luaXor(h, luaByte(V, (k-1)%I+1));
        result.push(h);
    }
    return luaChar(...result);
}

function buildMapping(X, u, V, I, R, p) {
    const map = {};
    for (const [num, enc] of X) {
        try { map[num] = decodeString(enc, u, V, I, R, p); } catch {}
    }
    return map;
}

function replaceAllH(code, mapping) {
    code = code.replace(/h\s*\[\s*n\s*\(\s*(0x[0-9a-fA-F]+)\s*\)\s*\]/g, (m, hex) => {
        const num = parseInt(hex, 16);
        return mapping[num] ? `"${mapping[num].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : m;
    });
    code = code.replace(/h\s*\[\s*(0x[0-9a-fA-F]+)\s*\]/g, (m, hex) => {
        const num = parseInt(hex, 16);
        return mapping[num] ? `"${mapping[num].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : m;
    });
    return code;
}

function removeDeadCode(code) {
    code = code.replace(/local u,V\s*=\s*"[^"]*",\s*"[^"]*"/g, '');
    code = code.replace(/local I\s*=\s*0x[0-9a-fA-F]+;?\s*local R\s*=\s*0x[0-9a-fA-F]+;?\s*local p\s*=\s*(true|false);?/g, '');
    code = code.replace(/local X\s*=\s*\{[\s\S]*?\};?/g, '');
    code = code.replace(/local function g\([^)]*\)[\s\S]*?end;?/g, '');
    code = code.replace(/function n\([^)]*\)[\s\S]*?end;?/g, '');
    code = code.replace(/h\s*=\s*setmetatable\s*\(\s*\{\s*\}\s*,\s*\{[\s\S]*?\}\s*\)/g, '');
    code = code.replace(/local B\s*=\s*\{\s*\};?/g, '');
    code = code.replace(/\n\s*\n/g, '\n');
    return code;
}

function flattenControlFlow(code) {
    const whileRegex = /while\s+U\s+do\s*([\s\S]*?)\nend\s*$/;
    const match = code.match(whileRegex);
    if (!match) return code;
    const body = match[1];
    const initUMatch = code.match(/U\s*=\s*(0x[0-9a-fA-F]+)/);
    let currentU = initUMatch ? parseInt(initUMatch[1], 16) : null;
    if (currentU === null) return code;
    const blockList = [];
    const ifRegex = /if\s+U\s*<\s*(0x[0-9a-fA-F]+)\s+then\s+([\s\S]*?)(?=\n\s*elseif|\n\s*else|\n\s*end)/g;
    let m;
    while ((m = ifRegex.exec(body)) !== null) {
        const threshold = parseInt(m[1], 16);
        const blockCode = m[2];
        const nextUMatch = blockCode.match(/U\s*=\s*(0x[0-9a-fA-F]+)/);
        const nextU = nextUMatch ? parseInt(nextUMatch[1], 16) : null;
        blockList.push({ threshold, nextU, code: blockCode });
    }
    if (!blockList.length) return code;
    blockList.sort((a,b) => b.threshold - a.threshold);
    const order = [];
    const visited = new Set();
    while (currentU !== null && !visited.has(currentU)) {
        visited.add(currentU);
        let chosen = null;
        for (const blk of blockList) {
            if (currentU < blk.threshold) { chosen = blk; break; }
        }
        if (!chosen) break;
        order.push(chosen);
        currentU = chosen.nextU;
    }
    const newBody = order.map(b => b.code).join('\n');
    code = code.replace(whileRegex, newBody.trim());
    code = code.replace(/U\s*=\s*0x[0-9a-fA-F]+;?\s*/g, '');
    return code;
}

function deobfuscate(code) {
    const { u, V, I, R, p } = extractConstants(code);
    const X = extractXTable(code);
    const mapping = buildMapping(X, u, V, I, R, p);
    code = replaceAllH(code, mapping);
    code = removeDeadCode(code);
    code = flattenControlFlow(code);
    return code.trim();
}

module.exports = { deobfuscate }; 
