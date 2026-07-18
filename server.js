const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

const users = new Map();
const onlineUsers = new Set();

// Файл для хранения сообщений
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// Загрузка сообщений
let messagesDB = {};
if (fs.existsSync(MESSAGES_FILE)) {
    try {
        messagesDB = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
        console.log('📁 История загружена');
    } catch(e) {
        console.log('📁 Новая база сообщений');
    }
}

// Сохранение в файл
function saveMessages() {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messagesDB, null, 2));
}

// Ключ чата: сортированные коды пользователей
function getChatKey(code1, code2) {
    return [code1, code2].sort().join('-');
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', users: users.size, messages: Object.keys(messagesDB).length });
});

io.on('connection', (socket) => {
    console.log(`✅ Подключился: ${socket.id}`);
    socket.emit('connected', { socketId: socket.id });

    // Регистрация
    socket.on('register', (userData) => {
        if (!userData || !userData.name || !userData.code) return;

        const userInfo = {
            id: socket.id,
            code: userData.code,
            name: userData.name,
            avatar: userData.name.charAt(0).toUpperCase()
        };
        
        users.set(socket.id, userInfo);
        onlineUsers.add(socket.id);
        console.log(`🟢 ${userInfo.name} (${userInfo.code}) вошел`);
        
        // Список других пользователей
        const usersList = [];
        users.forEach((user, id) => {
            if (id !== socket.id) usersList.push(user);
        });
        
        socket.emit('registrationComplete', { user: userInfo, usersList });
        socket.broadcast.emit('userOnline', userInfo);
    });

    // Запрос ВСЕХ чатов пользователя
    socket.on('getAllChats', (data) => {
		const userCode = data.code;
		const allChats = {};
		
		// Проходим по ВСЕМ чатам в базе
		Object.keys(messagesDB).forEach(key => {
			const codes = key.split('-');
			if (codes.includes(userCode)) {
				const otherCode = codes.find(c => c !== userCode);
				
				// Ищем пользователя среди всех зарегистрированных
				let otherName = otherCode;
				let otherAvatar = otherCode.charAt(0).toUpperCase();
				let isOnline = false;
				
				users.forEach(u => {
					if (u.code === otherCode) {
						otherName = u.name;
						otherAvatar = u.avatar;
						isOnline = onlineUsers.has(u.id);
					}
				});
				
				allChats[otherCode] = {
					code: otherCode,
					name: otherName,
					avatar: otherAvatar,
					online: isOnline,
					messages: messagesDB[key]
				};
			}
		});
		
		socket.emit('allChats', allChats);
	});

    // Запрос истории с конкретным пользователем
    socket.on('getHistory', (data) => {
        if (!data.with) return;
        const user = users.get(socket.id);
        if (!user) return;
        const chatKey = getChatKey(user.code, data.with);
        const history = messagesDB[chatKey] || [];
        socket.emit('messageHistory', history);
    });

    // Отправка сообщения
    socket.on('privateMessage', (data) => {
        if (!data.to || !data.text) return;
        const sender = users.get(socket.id);
        if (!sender) return;

        // Находим получателя по ID
        let receiverCode = null;
        users.forEach((u, id) => {
            if (id === data.to) receiverCode = u.code;
        });
        if (!receiverCode) return;

        const chatKey = getChatKey(sender.code, receiverCode);
        
        const messageData = {
            id: Date.now().toString(),
            from: socket.id,
            fromName: sender.name,
            fromCode: sender.code,
            text: data.text,
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };

        // Сохраняем
        if (!messagesDB[chatKey]) messagesDB[chatKey] = [];
        messagesDB[chatKey].push(messageData);
        saveMessages();
        
        console.log(`💬 ${sender.name} → ${receiverCode}: ${data.text.substring(0, 20)}`);

        // Отправляем получателю и отправителю
        if (onlineUsers.has(data.to)) {
            io.to(data.to).emit('privateMessage', messageData);
        }
        socket.emit('messageSent', messageData);
    });

    // Звонки
    socket.on('callUser', (data) => {
        const caller = users.get(socket.id);
        if (!caller) return;
        io.to(data.userToCall).emit('incomingCall', {
            from: socket.id,
            fromName: caller.name,
            signal: data.signalData
        });
    });

    socket.on('acceptCall', (data) => {
        if (!data.to) return;
        io.to(data.to).emit('callAccepted', data.signal);
    });

    socket.on('rejectCall', (data) => {
        if (!data.to) return;
        io.to(data.to).emit('callRejected');
    });

    socket.on('endCall', (data) => {
        if (!data.to) return;
        io.to(data.to).emit('callEnded');
    });

    // Отключение
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            console.log(`🔴 ${user.name} вышел`);
            users.delete(socket.id);
            onlineUsers.delete(socket.id);
            io.emit('userOffline', { id: socket.id, name: user.name });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 LUMEN ЗАПУЩЕН, порт:', PORT);
    console.log('💾 Файл сообщений:', MESSAGES_FILE);
});