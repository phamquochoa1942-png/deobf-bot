// bot.js
const http = require('http');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { deobfuscate } = require('./deobfuscator_v5');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('Missing BOT_TOKEN');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.on('ready', () => console.log(`✅ ${client.user.tag}`));

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!deobf')) {
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

        if (!code) return message.reply('❌ Cần file .lua hoặc link raw.');

        // Kiểm tra XHider
        if (!code.includes('local u,V') && !code.includes('XHider')) {
            return message.reply('⚠️ Không phải XHider.');
        }

        try {
            const clean = deobfuscate(code);
            const buf = Buffer.from(clean, 'utf-8');
            const file = new AttachmentBuilder(buf, { name: 'deobfuscated.lua' });
            await message.reply({ content: '✅ Thành công!', files: [file] });
        } catch (e) {
            await message.reply(`❌ Lỗi: ${e.message}`);
        }
    }
});

http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(process.env.PORT || 3000);

client.login(BOT_TOKEN);
