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

// Estructura de una sala mejorada con fix de voz
class Room {
  constructor(id) {
    this.id = id;
    this.users = new Map();
    this.video = {
      url: '',
      videoId: '', // ID del video de YouTube
      currentTime: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      duration: 0
    };
    this.messages = [];
    this.voiceStatus = new Map(); // Estado de voz de cada usuario
    this.createdAt = Date.now();
  }

  addUser(socketId, username) {
    const isHost = this.users.size === 0; // El primer usuario es el host
    
    this.users.set(socketId, { 
      username, 
      joinedAt: Date.now(),
      isHost: isHost
    });
    
    // FIXED: Inicializar estado de voz - Host NO silenciado por defecto
    this.voiceStatus.set(socketId, {
      isMuted: !isHost, // Solo el host empieza sin silenciar
      isVoiceEnabled: false, // Nadie tiene voz habilitada inicialmente
      hasPermission: true // Todos tienen permiso para usar voz
    });
    
    console.log(`👑 Usuario ${username} ${isHost ? '(HOST - VOZ ACTIVA)' : '(SILENCIADO)'} añadido a sala ${this.id}`);
  }

  removeUser(socketId) {
    const user = this.users.get(socketId);
    const wasHost = user?.isHost;
    
    this.users.delete(socketId);
    this.voiceStatus.delete(socketId);
    
    // Si se va el host, hacer host al siguiente usuario y darle privilegios de voz
    if (wasHost && this.users.size > 0) {
      const firstUserEntry = this.users.entries().next().value;
      if (firstUserEntry) {
        const [newHostSocketId, newHostUser] = firstUserEntry;
        newHostUser.isHost = true;
        
        // FIXED: El nuevo host también debería tener voz activa
        this.updateVoiceStatus(newHostSocketId, {
          isMuted: false,
          isVoiceEnabled: true
        });
        
        console.log(`👑 Nuevo host en sala ${this.id}: ${newHostUser.username} (VOZ ACTIVADA)`);
        return { newHost: newHostUser, socketId: newHostSocketId };
      }
    }
    return null;
  }

  updateVoiceStatus(socketId, status) {
    if (this.voiceStatus.has(socketId)) {
      const currentStatus = this.voiceStatus.get(socketId);
      this.voiceStatus.set(socketId, {
        ...currentStatus,
        ...status
      });
      
      const user = this.users.get(socketId);
      console.log(`🎤 ${user?.username} en sala ${this.id}: muted=${status.isMuted !== undefined ? status.isMuted : currentStatus.isMuted}, enabled=${status.isVoiceEnabled !== undefined ? status.isVoiceEnabled : currentStatus.isVoiceEnabled}`);
    }
  }

  updateVideo(data) {
    // Extraer ID de YouTube si es una URL completa
    if (data.url) {
      const videoId = this.extractYouTubeId(data.url);
      data.videoId = videoId;
    }
    
    this.video = { 
      ...this.video, 
      ...data, 
      lastUpdate: Date.now() 
    };
    
    console.log(`📺 Video actualizado en sala ${this.id}:`, {
      url: this.video.url,
      videoId: this.video.videoId,
      currentTime: this.video.currentTime,
      isPlaying: this.video.isPlaying
    });
  }

  extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
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
    videoId: room.video.videoId,
    isPlaying: room.video.isPlaying,
    voiceStats: room.getVoiceStats(),
    host: room.getHost()?.username || 'None',
    createdAt: new Date(room.createdAt).toLocaleString()
  }));

  res.json({ 
    message: 'Servidor funcionando correctamente', 
    timestamp: new Date().toISOString(),
    activeRooms: rooms.size,
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
    host: room.getHost(),
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
    const isUserHost = room.users.get(socket.id)?.isHost || false;
    
    console.log(`👥 ${username} se unió a la sala ${roomId} (${room.users.size} usuarios) ${isUserHost ? '- ES HOST' : ''}`);
    
    // Enviar estado actual al usuario que se une
    socket.emit('room-joined', {
      roomId: room.id,
      users: room.getUsersArray(),
      video: room.video,
      messages: room.messages.slice(-50), // Solo los últimos 50 mensajes
      isHost: isUserHost,
      voiceStats: room.getVoiceStats()
    });
    
    // Notificar a otros usuarios
    socket.to(roomId.toUpperCase()).emit('user-joined', {
      username: username,
      userCount: room.users.size,
      users: room.getUsersArray(),
      isHost: isUserHost
    });
  });
  
  // Estado de voz mejorado
  socket.on('voice-status', (data) => {
    const { roomId, isMuted, isVoiceEnabled } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      
      // Actualizar estado de voz
      const updateData = {};
      if (isMuted !== undefined) updateData.isMuted = isMuted;
      if (isVoiceEnabled !== undefined) updateData.isVoiceEnabled = isVoiceEnabled;
      
      room.updateVoiceStatus(socket.id, updateData);
      
      // Notificar a otros usuarios del cambio de estado
      socket.to(roomId.toUpperCase()).emit('voice-status-update', {
        username: user.username,
        socketId: socket.id,
        ...updateData
      });
      
      const voiceStatus = room.voiceStatus.get(socket.id);
      console.log(`🎤 ${user.username} cambió estado: ${voiceStatus.isMuted ? 'SILENCIADO' : 'ACTIVO'} en sala ${roomId}`);
    }
  });
  
  // Transmisión de audio mejorada
  socket.on('voice-data', (data) => {
    const { roomId, audioData, timestamp } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      const voiceStatus = room.voiceStatus.get(socket.id);
      
      // Solo transmitir si el usuario no está silenciado y tiene voz habilitada
      if (voiceStatus && !voiceStatus.isMuted && voiceStatus.isVoiceEnabled) {
        // Transmitir audio a todos los usuarios excepto al emisor
        socket.to(roomId.toUpperCase()).emit('voice-data', {
          audioData: audioData,
          username: user.username,
          socketId: socket.id,
          timestamp: timestamp || Date.now()
        });
        
        // Log más detallado para debug
        console.log(`🔊 Audio transmitido de ${user.username} en sala ${roomId} (${audioData.length} bytes)`);
      } else {
        console.log(`🔇 Audio bloqueado de ${user.username}: muted=${voiceStatus?.isMuted}, enabled=${voiceStatus?.isVoiceEnabled}`);
      }
    }
  });
  
  // Sincronizar video (mejorado)
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
        videoId: room.video.videoId,
        currentTime: room.video.currentTime,
        isPlaying: room.video.isPlaying,
        timestamp: Date.now()
      });
      
      console.log(`🔄 Video sincronizado en sala ${roomId}: ${isPlaying ? 'Playing' : 'Paused'} at ${currentTime}s`);
    }
  });
  
  // Cambio de video URL (mejorado)
  socket.on('video-change', (data) => {
    const { roomId, url } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      // Validar que sea una URL de YouTube válida
      const videoId = room.extractYouTubeId(url);
      if (!videoId) {
        socket.emit('error', { message: 'URL de YouTube no válida' });
        return;
      }
      
      room.updateVideo({ 
        url, 
        videoId,
        currentTime: 0, 
        isPlaying: false 
      });
      
      // Notificar a todos los usuarios de la sala
      io.to(roomId.toUpperCase()).emit('video-changed', { 
        url,
        videoId,
        username: room.users.get(socket.id)?.username
      });
      
      console.log(`📺 Video cambiado en sala ${roomId}: ${url} (ID: ${videoId})`);
    }
  });
  
  // Solicitar sincronización (nuevo evento)
  socket.on('request-sync', (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId?.toUpperCase());
    
    if (room && room.users.has(socket.id)) {
      socket.emit('video-synced', {
        url: room.video.url,
        videoId: room.video.videoId,
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
  
  // Desconexión mejorada
  socket.on('disconnect', (reason) => {
    console.log(`👋 Usuario desconectado: ${socket.id} (${reason})`);
    
    // Encontrar y limpiar salas
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        const user = room.users.get(socket.id);
        const wasHost = user.isHost;
        
        const hostChangeResult = room.removeUser(socket.id);
        
        // Notificar a otros usuarios
        socket.to(roomId).emit('user-left', {
          username: user.username,
          userCount: room.users.size,
          users: room.getUsersArray(),
          wasHost: wasHost
        });
        
        // Si cambió el host, notificar
        if (hostChangeResult && hostChangeResult.newHost) {
          io.to(roomId).emit('host-changed', {
            newHost: hostChangeResult.newHost.username,
            newHostSocketId: hostChangeResult.socketId
          });
          
          // FIXED: Notificar al nuevo host que active su micrófono
          io.to(hostChangeResult.socketId).emit('became-host', {
            message: 'You are now the host - voice activated'
          });
          
          console.log(`👑 Nuevo host en sala ${roomId}: ${hostChangeResult.newHost.username} (AUTO-VOZ)`);
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
  const totalHosts = Array.from(rooms.values()).reduce((sum, room) => sum + (room.getHost() ? 1 : 0), 0);
  
  const stats = {
    activeRooms: rooms.size,
    totalUsers: totalUsers,
    totalHosts: totalHosts,
    roomsWithVideo: Array.from(rooms.values()).filter(room => room.video.url).length,
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
  console.log('\n🚀 ===== SERVIDOR INICIADO CON VOICE FIX =====');
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🧪 Test: http://localhost:${PORT}/test`);
  console.log(`📁 Static files: ${path.join(__dirname, 'public')}`);
  console.log(`⏰ Iniciado: ${new Date().toLocaleString()}`);
  console.log(`🔧 Modo: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎤 Soporte de voz: MEJORADO - Host auto-activo`);
  console.log(`👑 Host privilegios: Micrófono activado por defecto`);
  console.log('=============================================\n');
  
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