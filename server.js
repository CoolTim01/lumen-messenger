const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройка Socket.IO для работы на Render
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

// Раздача статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Проверка здоровья (нужно для Render)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        users: users.size,
        online: onlineUsers.size
    });
});

io.on('connection', (socket) => {
    console.log(`✅ Пользователь подключился: ${socket.id}`);

    // Отправляем подтверждение подключения
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
        
        // Отправляем список пользователей
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
        
        // Оповещаем других
        socket.broadcast.emit('userOnline', userInfo);
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

        if (onlineUsers.has(data.to)) {
            io.to(data.to).emit('privateMessage', messageData);
            socket.emit('messageSent', messageData);
            console.log(`💬 ${sender.name} → сообщение`);
        } else {
            socket.emit('error', { message: 'Пользователь не в сети' });
        }
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

// Запуск сервера (Render сам установит PORT)
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('🚀 LUMEN MESSENGER ЗАПУЩЕН');
    console.log(`📡 Порт: ${PORT}`);
    console.log('================================');
});