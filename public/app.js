// Variables globales
let socket;
let currentRoom = null;
let currentUser = null;
let youtubePlayer = null;
let isPlayerReady = false;
let isSyncing = false;
let syncTimeout = null;

// Variables de sincronización
let lastKnownTime = 0;
let lastKnownState = -1; // -1: sin inicializar, 1: playing, 2: paused

// Estado de conexión
function updateConnectionStatus(message, type) {
    const statusContainer = document.getElementById('connectionStatus');
    const indicator = statusContainer.querySelector('.status-indicator');
    const text = statusContainer.querySelector('.status-text');
    
    text.textContent = message;
    
    // Actualizar indicador visual
    indicator.className = 'status-indicator';
    if (type === 'success') {
        indicator.classList.add('connected');
    } else if (type === 'loading') {
        indicator.classList.add('connecting');
    }
}

// Inicializar YouTube API
function onYouTubeIframeAPIReady() {
    console.log('📺 YouTube API lista');
}

// Extraer ID de video de YouTube
function getYouTubeVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Crear reproductor de YouTube
function createYouTubePlayer(videoId) {
    if (youtubePlayer) {
        youtubePlayer.destroy();
    }

    document.getElementById('noVideo').style.display = 'none';

    youtubePlayer = new YT.Player('player', {
        height: '400',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'autoplay': 0,
            'controls': 1,
            'rel': 0,
            'modestbranding': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    console.log('🎬 Reproductor listo');
    isPlayerReady = true;
    document.getElementById('playBtn').disabled = false;
    document.getElementById('pauseBtn').disabled = false;
    
    // Actualizar tiempo cada segundo
    setInterval(updateTimeDisplay, 1000);
}

function onPlayerStateChange(event) {
    if (!isPlayerReady || isSyncing) return;

    const currentTime = youtubePlayer.getCurrentTime();
    const isPlaying = event.data === YT.PlayerState.PLAYING;
    
    console.log(`🎮 Estado cambió: ${isPlaying ? 'Playing' : 'Paused'} en ${currentTime.toFixed(2)}s`);
    
    // Enviar sincronización a otros usuarios
    socket.emit('video-sync', {
        roomId: currentRoom,
        currentTime: currentTime,
        isPlaying: isPlaying
    });

    showSyncStatus();
}

function updateTimeDisplay() {
    if (youtubePlayer && isPlayerReady) {
        const currentTime = youtubePlayer.getCurrentTime();
        const duration = youtubePlayer.getDuration();
        
        const current = formatTime(currentTime);
        const total = formatTime(duration);
        
        document.getElementById('timeDisplay').textContent = `${current} / ${total}`;
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function showSyncStatus() {
    const status = document.getElementById('syncStatus');
    const text = status.querySelector('.sync-text');
    
    status.classList.remove('hidden');
    text.textContent = 'Syncing...';
    
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        text.textContent = 'Synced';
        setTimeout(() => {
            status.classList.add('hidden');
        }, 2000);
    }, 1000);
}

// Inicializar conexión
function initSocket() {
    console.log('Iniciando conexión Socket.IO...');
    updateConnectionStatus('Connecting to server...', 'loading');

    socket = io({
        transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
        console.log('✅ Conectado:', socket.id);
        updateConnectionStatus('Connected to server', 'success');
        document.getElementById('createBtn').disabled = false;
        document.getElementById('joinBtn').disabled = false;
    });

    socket.on('disconnect', (reason) => {
        console.log('❌ Desconectado:', reason);
        updateConnectionStatus('Disconnected: ' + reason, 'error');
        document.getElementById('createBtn').disabled = true;
        document.getElementById('joinBtn').disabled = true;
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Error de conexión:', error);
        updateConnectionStatus('Connection error: ' + error.message, 'error');
    });

    // Eventos de sala
    socket.on('room-joined', (data) => {
        console.log('🏠 Unido a sala:', data);
        currentRoom = data.roomId;
        showRoomScreen(data);
        
        // Si hay un video cargado, sincronizar
        if (data.video && data.video.url) {
            loadVideoFromData(data.video);
        }
    });

    socket.on('user-joined', (data) => {
        console.log('👤 Usuario se unió:', data.username);
        updateUserCount(data.userCount);
        updateUsersList(data.users);
        addSystemMessage(`${data.username} joined the room`);
    });

    socket.on('user-left', (data) => {
        console.log('👋 Usuario salió:', data.username);
        updateUserCount(data.userCount);
        updateUsersList(data.users);
        addSystemMessage(`${data.username} left the room`);
    });

    socket.on('video-changed', (data) => {
        console.log('📺 Video cambiado:', data.url);
        const videoId = getYouTubeVideoId(data.url);
        if (videoId) {
            createYouTubePlayer(videoId);
            addSystemMessage('Video changed by another user');
        }
    });

    socket.on('video-synced', (data) => {
        console.log('🔄 Sincronizando video:', data);
        syncVideo(data);
    });

    socket.on('new-message', (data) => {
        addChatMessage(data);
    });

    socket.on('error', (data) => {
        alert('Error: ' + data.message);
    });
}

function loadVideoFromData(videoData) {
    const videoId = getYouTubeVideoId(videoData.url);
    if (videoId) {
        createYouTubePlayer(videoId);
        document.getElementById('videoUrl').value = videoData.url;
    }
}

function syncVideo(data) {
    if (!youtubePlayer || !isPlayerReady) return;
    
    isSyncing = true;
    
    const timeDiff = Math.abs(youtubePlayer.getCurrentTime() - data.currentTime);
    
    // Solo sincronizar si hay una diferencia significativa (>2 segundos)
    if (timeDiff > 2) {
        youtubePlayer.seekTo(data.currentTime, true);
    }
    
    // Sincronizar estado de reproducción
    if (data.isPlaying && youtubePlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
        youtubePlayer.playVideo();
    } else if (!data.isPlaying && youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        youtubePlayer.pauseVideo();
    }
    
    setTimeout(() => {
        isSyncing = false;
    }, 1000);
    
    showSyncStatus();
}

// Crear sala
async function createRoom() {
    const username = prompt('Enter your name:');
    if (!username) return;

    try {
        const response = await fetch('/api/create-room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        currentUser = username.trim();
        socket.emit('join-room', { 
            roomId: data.roomId, 
            username: currentUser 
        });
        
    } catch (error) {
        alert('Error creating room: ' + error.message);
    }
}

// Mostrar formulario de unirse
function showJoinForm() {
    document.getElementById('joinForm').classList.remove('hidden');
    document.getElementById('username').focus();
}

function hideJoinForm() {
    document.getElementById('joinForm').classList.add('hidden');
}

// Unirse a sala
function joinRoom() {
    const username = document.getElementById('username').value.trim();
    const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();

    if (!username || !roomCode) {
        alert('Please complete all fields');
        return;
    }

    currentUser = username;
    socket.emit('join-room', { roomId: roomCode, username });
}

// Mostrar pantalla de sala
function showRoomScreen(data) {
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('roomScreen').classList.remove('hidden');
    document.getElementById('currentRoom').textContent = data.roomId;
    updateUserCount(data.users ? data.users.length : 1);
    updateUsersList(data.users || []);
    
    // Mostrar mensajes existentes
    if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => addChatMessage(msg));
    }
}

// Actualizar contador de usuarios
function updateUserCount(count) {
    document.getElementById('userCount').textContent = count;
}

// Actualizar lista de usuarios
function updateUsersList(users) {
    const list = document.getElementById('usersList');
    list.innerHTML = '';
    users.forEach(user => {
        const userEl = document.createElement('div');
        userEl.className = 'user-item';
        userEl.innerHTML = `
            <div style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%;"></div>
            <span>${user.username} ${user.username === currentUser ? '(You)' : ''}</span>
        `;
        list.appendChild(userEl);
    });
}

// Cargar video
function loadVideo() {
    const url = document.getElementById('videoUrl').value.trim();
    if (!url) {
        alert('Please enter a YouTube URL');
        return;
    }
    
    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
        alert('Invalid YouTube URL. Use format: https://www.youtube.com/watch?v=VIDEO_ID');
        return;
    }
    
    createYouTubePlayer(videoId);
    socket.emit('video-change', { roomId: currentRoom, url });
    addSystemMessage('Video loaded: ' + url);
}

// Controles de video
function togglePlay() {
    if (!youtubePlayer || !isPlayerReady) return;
    
    if (youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        youtubePlayer.pauseVideo();
    } else {
        youtubePlayer.playVideo();
    }
}

// Chat
function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    socket.emit('send-message', {
        roomId: currentRoom,
        message: message
    });
    
    input.value = '';
}

function addChatMessage(data) {
    const chat = document.getElementById('chatMessages');
    const msgEl = document.createElement('div');
    const time = new Date(data.timestamp).toLocaleTimeString();
    const isOwn = data.username === currentUser;
    
    msgEl.className = `chat-message ${isOwn ? 'own' : 'other'}`;
    
    msgEl.innerHTML = `
        <div class="message-header">
            ${isOwn ? 'You' : data.username} • ${time}
        </div>
        <div class="message-content">${data.message}</div>
    `;
    
    chat.appendChild(msgEl);
    chat.scrollTop = chat.scrollHeight;
}

function addSystemMessage(message) {
    const chat = document.getElementById('chatMessages');
    const msgEl = document.createElement('div');
    
    msgEl.className = 'system-message';
    msgEl.textContent = message;
    chat.appendChild(msgEl);
    chat.scrollTop = chat.scrollHeight;
}

// Salir de sala
function leaveRoom() {
    if (confirm('Are you sure you want to leave?')) {
        if (youtubePlayer) {
            youtubePlayer.destroy();
        }
        location.reload();
    }
}

// Manejadores de eventos de teclado
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        if (e.target.id === 'messageInput') sendMessage();
        if (e.target.id === 'roomCode') joinRoom();
        if (e.target.id === 'videoUrl') loadVideo();
    }
});

// Iniciar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Page loaded, starting Coupether...');
    initSocket();
});