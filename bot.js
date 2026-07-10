// bot.js
const http = require('http');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { deobfuscate } = require('./deobfuscator');

const BOT_TOKEN = process.env.BOT_TOKEN; // Lấy từ biến môi trường

if (!BOT_TOKEN) {
    console.error('Thiếu BOT_TOKEN trong biến môi trường!');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.on('ready', () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!deobf')) {
        const attachment = message.attachments.first();
        let code = null;

        if (attachment && attachment.name.endsWith('.lua')) {
            const res = await fetch(attachment.url);
            code = await res.text();
        } else {
            const linkMatch = message.content.match(/(https?:\/\/\S+\.lua(?:\?\S*)?)/);
            if (linkMatch) {
                const res = await fetch(linkMatch[0]);
                code = await res.text();
            }
        }

        if (!code) {
            return message.reply('❌ Đính kèm file .lua hoặc link raw .lua.');
        }

        if (!code.includes('XHider') && !code.includes('local u,V')) {
            return message.reply('⚠️ File không phải XHider obfuscated.');
        }

        try {
            const clean = deobfuscate(code);
            const buffer = Buffer.from(clean, 'utf-8');
            const file = new AttachmentBuilder(buffer, { name: 'deobfuscated.lua' });
            await message.reply({ content: '✅ Deobfuscate thành công!', files: [file] });
        } catch (err) {
            await message.reply(`❌ Lỗi: ${err.message}`);
        }
    }
});

// HTTP server để Render giữ process sống
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
}).listen(process.env.PORT || 3000);

client.login(BOT_TOKEN); 
