const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// Хранение пользователей
const users = new Map();
const onlineUsers = new Set();

// Файл для хранения сообщений
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// Загрузка сообщений из файла
let messagesDB = {};
if (fs.existsSync(MESSAGES_FILE)) {
    try {
        messagesDB = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
        console.log('📁 История сообщений загружена');
    } catch (e) {
        console.log('📁 Создана новая база сообщений');
    }
}

// Функция сохранения сообщений
function saveMessages() {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messagesDB, null, 2));
}

// Функция получения ключа чата
function getChatKey(user1, user2) {
    return [user1, user2].sort().join('-');
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        users: users.size,
        online: onlineUsers.size
    });
});

io.on('connection', (socket) => {
    console.log(`✅ Пользователь подключился: ${socket.id}`);

    socket.emit('connected', { socketId: socket.id });

    // Регистрация пользователя
    socket.on('register', (userData) => {
        if (!userData || !userData.name || !userData.code) {
            socket.emit('error', { message: 'Неверные данные' });
            return;
        }

        const userInfo = {
            id: socket.id,
            code: userData.code,
            name: userData.name,
            avatar: userData.name.charAt(0).toUpperCase()
        };
        
        users.set(socket.id, userInfo);
        onlineUsers.add(socket.id);
        
        console.log(`🟢 ${userInfo.name} вошел в сеть`);
        
        const usersList = [];
        users.forEach((user, id) => {
            if (id !== socket.id) {
                usersList.push(user);
            }
        });
        
        socket.emit('registrationComplete', {
            user: userInfo,
            usersList: usersList
        });
        
        socket.broadcast.emit('userOnline', userInfo);
    });

    // Запрос истории сообщений
    socket.on('getHistory', (data) => {
        if (!data.with) return;
        const chatKey = getChatKey(socket.id, data.with);
        const history = messagesDB[chatKey] || [];
        socket.emit('messageHistory', history);
    });

    // Отправка сообщения
    socket.on('privateMessage', (data) => {
        if (!data.to || !data.text) return;

        const sender = users.get(socket.id);
        if (!sender) return;

        const messageData = {
            id: Date.now().toString(),
            from: socket.id,
            fromName: sender.name,
            fromCode: sender.code,
            text: data.text,
            time: new Date().toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })
        };

        // Сохраняем сообщение в базу
        const chatKey = getChatKey(socket.id, data.to);
        if (!messagesDB[chatKey]) {
            messagesDB[chatKey] = [];
        }
        messagesDB[chatKey].push(messageData);
        saveMessages();
        
        console.log(`💬 ${sender.name} → сообщение сохранено`);

        if (onlineUsers.has(data.to)) {
            io.to(data.to).emit('privateMessage', messageData);
        }
        socket.emit('messageSent', messageData);
    });

    // WebRTC сигналинг
    socket.on('callUser', (data) => {
        const caller = users.get(socket.id);
        if (!caller || !data.userToCall) return;
        console.log(`📞 ${caller.name} вызывает абонента`);
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
        io.to(data.to).emit('callRejected', {
            from: socket.id,
            message: 'Звонок отклонен'
        });
    });

    socket.on('endCall', (data) => {
        if (!data.to) return;
        io.to(data.to).emit('callEnded');
    });

    // Отключение
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            console.log(`🔴 ${user.name} вышел из сети`);
            users.delete(socket.id);
            onlineUsers.delete(socket.id);
            io.emit('userOffline', { 
                id: socket.id,
                name: user.name 
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('🚀 LUMEN MESSENGER ЗАПУЩЕН');
    console.log(`📡 Порт: ${PORT}`);
    console.log('💾 Сообщения сохраняются в файл');
    console.log('================================');
});