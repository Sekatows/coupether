const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configurar Socket.IO ANTES de todo
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Almacenar salas activas
const rooms = new Map();

// Estructura de una sala mejorada con soporte multi-plataforma
class Room {
  constructor(id) {
    this.id = id;
    this.users = new Map();
    this.video = {
      url: '',
      platform: '', // 'youtube', 'twitch', 'kick'
      videoId: '', // ID del video/stream
      currentTime: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      duration: 0,
      channelName: '' // Para Twitch/Kick
    };
    this.messages = [];
    this.voiceStatus = new Map(); // Estado de voz de cada usuario
    this.createdAt = Date.now();
  }

  addUser(socketId, username) {
    this.users.set(socketId, { 
      username, 
      joinedAt: Date.now(),
      isHost: this.users.size === 0 // El primer usuario es el host
    });
    
    // Inicializar estado de voz (silenciado por defecto)
    this.voiceStatus.set(socketId, {
      isMuted: true,
      isVoiceEnabled: false
    });
  }

  removeUser(socketId) {
    this.users.delete(socketId);
    this.voiceStatus.delete(socketId);
    
    // Si se va el host, hacer host al siguiente usuario
    if (this.users.size > 0) {
      const firstUser = this.users.entries().next().value;
      if (firstUser) {
        firstUser[1].isHost = true;
      }
    }
  }

  updateVoiceStatus(socketId, status) {
    if (this.voiceStatus.has(socketId)) {
      this.voiceStatus.set(socketId, {
        ...this.voiceStatus.get(socketId),
        ...status
      });
    }
  }

  updateVideo(data) {
    // Detectar plataforma y extraer información
    if (data.url) {
      const videoInfo = this.parseVideoUrl(data.url);
      if (videoInfo) {
        data.platform = videoInfo.platform;
        data.videoId = videoInfo.videoId;
        data.channelName = videoInfo.channelName || '';
      }
    }
    
    this.video = { 
      ...this.video, 
      ...data, 
      lastUpdate: Date.now() 
    };
    
    console.log(`📺 Video actualizado en sala ${this.id}:`, {
      url: this.video.url,
      platform: this.video.platform,
      videoId: this.video.videoId,
      channelName: this.video.channelName,
      currentTime: this.video.currentTime,
      isPlaying: this.video.isPlaying
    });
  }

  parseVideoUrl(url) {
    // YouTube
    const youtubeRegExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const youtubeMatch = url.match(youtubeRegExp);
    if (youtubeMatch && youtubeMatch[2].length === 11) {
      return {
        platform: 'youtube',
        videoId: youtubeMatch[2]
      };
    }

    // Twitch
    const twitchRegExp = /(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)/;
    const twitchMatch = url.match(twitchRegExp);
    if (twitchMatch) {
      return {
        platform: 'twitch',
        videoId: twitchMatch[1],
        channelName: twitchMatch[1]
      };
    }

    // Kick
    const kickRegExp = /(?:https?:\/\/)?(?:www\.)?kick\.com\/([a-zA-Z0-9_]+)/;
    const kickMatch = url.match(kickRegExp);
    if (kickMatch) {
      return {
        platform: 'kick',
        videoId: kickMatch[1],
        channelName: kickMatch[1]
      };
    }

    return null;
  }

  addMessage(socketId, message) {
    const user = this.users.get(socketId);
    if (user) {
      const messageData = {
        id: uuidv4(),
        username: user.username,
        message: message,
        timestamp: Date.now()
      };
      
      // Mantener solo los últimos 100 mensajes
      this.messages.push(messageData);
      if (this.messages.length > 100) {
        this.messages = this.messages.slice(-100);
      }
      
      return messageData;
    }
    return null;
  }

  isEmpty() {
    return this.users.size === 0;
  }

  getUsersArray() {
    const usersArray = [];
    for (let [socketId, user] of this.users) {
      usersArray.push({
        ...user,
        socketId: socketId,
        voiceStatus: this.voiceStatus.get(socketId) || { isMuted: true, isVoiceEnabled: false }
      });
    }
    return usersArray;
  }

  getHost() {
    for (let [socketId, user] of this.users) {
      if (user.isHost) {
        return { socketId, ...user };
      }
    }
    return null;
  }

  getVoiceStats() {
    const totalUsers = this.users.size;
    const usersWithVoice = Array.from(this.voiceStatus.values()).filter(status => status.isVoiceEnabled).length;
    const unmutedUsers = Array.from(this.voiceStatus.values()).filter(status => !status.isMuted && status.isVoiceEnabled).length;
    
    return { totalUsers, usersWithVoice, unmutedUsers };
  }
}

// Rutas HTTP
app.get('/', (req, res) => {
  console.log('Sirviendo index.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta de prueba mejorada
app.get('/test', (req, res) => {
  const roomsInfo = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    users: room.users.size,
    hasVideo: !!room.video.url,
    platform: room.video.platform,
    videoId: room.video.videoId,
    channelName: room.video.channelName,
    isPlaying: room.video.isPlaying,
    voiceStats: room.getVoiceStats(),
    createdAt: new Date(room.createdAt).toLocaleString()
  }));

  res.json({ 
    message: 'Servidor funcionando correctamente con soporte multi-plataforma', 
    timestamp: new Date().toISOString(),
    activeRooms: rooms.size,
    supportedPlatforms: ['YouTube', 'Twitch', 'Kick'],
    rooms: roomsInfo
  });
});

// Verificar que Socket.IO esté disponible
app.get('/socket.io/*', (req, res) => {
  console.log('Solicitud Socket.IO:', req.url);
  res.status(200).send('Socket.IO endpoint');
});

// Crear una nueva sala
app.post('/api/create-room', (req, res) => {
  const roomId = uuidv4().substring(0, 8).toUpperCase();
  const room = new Room(roomId);
  rooms.set(roomId, room);
  
  console.log(`🏠 Sala creada: ${roomId}`);
  res.json({ roomId });
});

// Obtener información de una sala
app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId.toUpperCase());
  
  if (!room) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }
  
  res.json({
    roomId: room.id,
    userCount: room.users.size,
    users: room.getUsersArray(),
    video: room.video,
    voiceStats: room.getVoiceStats(),
    createdAt: room.createdAt
  });
});

// Socket.IO events
io.on('connection', (socket) => {
  console.log(`👤 Usuario conectado: ${socket.id}`);
  
  // Unirse a una sala
  socket.on('join-room', (data) => {
    const { roomId, username } = data;
    const room = rooms.get(roomId.toUpperCase());
    
    if (!room) {
      socket.emit('error', { message: 'Sala no encontrada' });
      return;
    }
    
    // Salir de salas anteriores
    socket.rooms.forEach(roomName => {
      if (roomName !== socket.id) {
        socket.leave(roomName);
        const oldRoom = rooms.get(roomName);
        if (oldRoom) {
          oldRoom.removeUser(socket.id);
        }
      }
    });
    
    // Unirse a la nueva sala
    socket.join(roomId.toUpperCase());
    room.addUser(socket.id, username.trim());
    
    const host = room.getHost();
    console.log(`👥 ${username} se unió a la sala ${roomId} (${room.users.size} usuarios)`);
    
    // Enviar estado actual al usuario que se une
    socket.emit('room-joined', {
      roomId: room.id,
      users: room.getUsersArray(),
      video: room.video,
      messages: room.messages.slice(-50), // Solo los últimos 50 mensajes
      isHost: room.users.get(socket.id)?.isHost || false,
      voiceStats: room.getVoiceStats()
    });
    
    // Notificar a otros usuarios
    socket.to(roomId.toUpperCase()).emit('user-joined', {
      username: username,
      userCount: room.users.size,
      users: room.getUsersArray()
    });
  });
  
  // Estado de voz
  socket.on('voice-status', (data) => {
    const { roomId, isMuted } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      
      // Actualizar estado de voz
      room.updateVoiceStatus(socket.id, { 
        isMuted: isMuted !== undefined ? isMuted : true,
        isVoiceEnabled: true
      });
      
      // Notificar a otros usuarios del cambio de estado
      socket.to(roomId.toUpperCase()).emit('voice-status', {
        username: user.username,
        isMuted: isMuted,
        isVoiceEnabled: true
      });
      
      console.log(`🎤 ${user.username} ${isMuted ? 'silenciado' : 'activado'} micrófono en sala ${roomId}`);
    }
  });
  
  // Transmisión de audio
  socket.on('voice-data', (data) => {
    const { roomId, audioData } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      const voiceStatus = room.voiceStatus.get(socket.id);
      
      // Solo transmitir si el usuario no está silenciado
      if (voiceStatus && !voiceStatus.isMuted) {
        // Transmitir audio a todos los usuarios excepto al emisor
        socket.to(roomId.toUpperCase()).emit('voice-data', {
          audioData: audioData,
          username: user.username,
          socketId: socket.id
        });
      }
    }
  });
  
  // Sincronizar video (mejorado para multi-plataforma)
  socket.on('video-sync', (data) => {
    const { roomId, url, currentTime, isPlaying } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      const updateData = {};
      
      if (url !== undefined) updateData.url = url;
      if (currentTime !== undefined) updateData.currentTime = currentTime;
      if (isPlaying !== undefined) updateData.isPlaying = isPlaying;
      
      room.updateVideo(updateData);
      
      // Broadcast a todos los usuarios de la sala excepto el emisor
      socket.to(roomId.toUpperCase()).emit('video-synced', {
        url: room.video.url,
        platform: room.video.platform,
        videoId: room.video.videoId,
        channelName: room.video.channelName,
        currentTime: room.video.currentTime,
        isPlaying: room.video.isPlaying,
        timestamp: Date.now()
      });
      
      console.log(`🔄 Video sincronizado en sala ${roomId} [${room.video.platform}]: ${isPlaying ? 'Playing' : 'Paused'} at ${currentTime}s`);
    }
  });
  
  // Cambio de video URL (mejorado para multi-plataforma)
  socket.on('video-change', (data) => {
    const { roomId, url } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      // Validar que sea una URL válida de alguna plataforma soportada
      const videoInfo = room.parseVideoUrl(url);
      if (!videoInfo) {
        socket.emit('error', { message: 'URL no válida. Soportamos YouTube, Twitch y Kick.' });
        return;
      }
      
      room.updateVideo({ 
        url,
        platform: videoInfo.platform,
        videoId: videoInfo.videoId,
        channelName: videoInfo.channelName || '',
        currentTime: 0, 
        isPlaying: false 
      });
      
      // Notificar a todos los usuarios de la sala
      io.to(roomId.toUpperCase()).emit('video-changed', { 
        url,
        platform: videoInfo.platform,
        videoId: videoInfo.videoId,
        channelName: videoInfo.channelName,
        username: room.users.get(socket.id)?.username
      });
      
      console.log(`📺 Video cambiado en sala ${roomId} [${videoInfo.platform}]: ${url}`);
    }
  });
  
  // Solicitar sincronización
  socket.on('request-sync', (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      socket.emit('video-synced', {
        url: room.video.url,
        platform: room.video.platform,
        videoId: room.video.videoId,
        channelName: room.video.channelName,
        currentTime: room.video.currentTime,
        isPlaying: room.video.isPlaying,
        timestamp: Date.now()
      });
    }
  });
  
  // Mensajes de chat
  socket.on('send-message', (data) => {
    const { roomId, message } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      const messageData = room.addMessage(socket.id, message.trim());
      
      if (messageData) {
        // Enviar mensaje a todos los usuarios de la sala
        io.to(roomId.toUpperCase()).emit('new-message', messageData);
        console.log(`💬 Mensaje en sala ${roomId}: ${messageData.username}: ${message}`);
      }
    }
  });
  
  // Ping para mantener conexión activa
  socket.on('ping', (data) => {
    socket.emit('pong', { timestamp: Date.now() });
  });
  
  // Desconexión
  socket.on('disconnect', (reason) => {
    console.log(`👋 Usuario desconectado: ${socket.id} (${reason})`);
    
    // Encontrar y limpiar salas
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        const user = room.users.get(socket.id);
        const wasHost = user.isHost;
        
        room.removeUser(socket.id);
        
        // Notificar a otros usuarios
        socket.to(roomId).emit('user-left', {
          username: user.username,
          userCount: room.users.size,
          users: room.getUsersArray()
        });
        
        // Si era el host, notificar el cambio
        if (wasHost && room.users.size > 0) {
          const newHost = room.getHost();
          if (newHost) {
            io.to(roomId).emit('host-changed', {
              newHost: newHost.username
            });
            console.log(`👑 Nuevo host en sala ${roomId}: ${newHost.username}`);
          }
        }
        
        // Eliminar sala si está vacía
        if (room.isEmpty()) {
          rooms.delete(roomId);
          console.log(`🗑️ Sala ${roomId} eliminada (vacía)`);
        } else {
          console.log(`📊 Sala ${roomId}: ${room.users.size} usuarios restantes`);
        }
      }
    });
  });
  
  // Error handling
  socket.on('error', (error) => {
    console.error(`❌ Error en socket ${socket.id}:`, error);
  });
});

// Limpiar salas vacías y antiguas cada 30 minutos
setInterval(() => {
  const now = Date.now();
  const MAX_AGE = 24 * 60 * 60 * 1000; // 24 horas
  
  rooms.forEach((room, roomId) => {
    const age = now - room.createdAt;
    
    if (room.isEmpty() || age > MAX_AGE) {
      rooms.delete(roomId);
      console.log(`🧹 Sala ${roomId} eliminada por ${room.isEmpty() ? 'inactividad' : 'antigüedad'}`);
    }
  });
  
  console.log(`📊 Limpieza completada. Salas activas: ${rooms.size}`);
}, 30 * 60 * 1000);

// Estadísticas cada hora
setInterval(() => {
  const totalUsers = Array.from(rooms.values()).reduce((sum, room) => sum + room.users.size, 0);
  const totalVoiceUsers = Array.from(rooms.values()).reduce((sum, room) => sum + room.getVoiceStats().usersWithVoice, 0);
  const totalUnmutedUsers = Array.from(rooms.values()).reduce((sum, room) => sum + room.getVoiceStats().unmutedUsers, 0);
  
  const platformStats = {};
  Array.from(rooms.values()).forEach(room => {
    if (room.video.platform) {
      platformStats[room.video.platform] = (platformStats[room.video.platform] || 0) + 1;
    }
  });
  
  const stats = {
    activeRooms: rooms.size,
    totalUsers: totalUsers,
    roomsWithVideo: Array.from(rooms.values()).filter(room => room.video.url).length,
    platformDistribution: platformStats,
    voiceStats: {
      usersWithVoice: totalVoiceUsers,
      unmutedUsers: totalUnmutedUsers
    }
  };
  
  console.log('📈 Estadísticas del servidor:', stats);
}, 60 * 60 * 1000);

// Manejo de errores del servidor
server.on('error', (error) => {
  console.error('❌ Error del servidor:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 ===== SERVIDOR INICIADO =====');
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🧪 Test: http://localhost:${PORT}/test`);
  console.log(`📁 Static files: ${path.join(__dirname, 'public')}`);
  console.log(`⏰ Iniciado: ${new Date().toLocaleString()}`);
  console.log(`🔧 Modo: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎤 Soporte de voz: Habilitado`);
  console.log(`📺 Plataformas: YouTube, Twitch, Kick`);
  console.log('================================\n');
  
  // Verificar que el archivo index.html existe
  const fs = require('fs');
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    console.log('✅ index.html encontrado');
  } else {
    console.log('❌ ERROR: index.html NO encontrado en:', indexPath);
    console.log('💡 Asegúrate de que el archivo HTML esté en la carpeta public/');
  }
});