// Variables globales
let socket;
let currentRoom = null;
let currentUser = null;
let currentPlatform = null;
let currentPlayer = null;
let isPlayerReady = false;
let isSyncing = false;

// Variables de sincronización mejoradas
let syncThreshold = 0.8;
let lastSyncTime = 0;
let syncCooldown = 200;
let syncBuffer = 0.3;

// Variables de audio/voz
let localStream = null;
let isVoiceEnabled = false;
let isMuted = true;
let audioContext = null;
let analyser = null;
let microphone = null;
let mediaRecorder = null;
let audioChunks = [];
let audioInterval = null;
let audioProcessors = new Map();

// Variables de compartir pantalla
let screenStream = null;
let isScreenSharing = false;
let screenRecorder = null;
let screenShareSender = null;

// Estado de conexión
function updateConnectionStatus(message, type) {
    const statusContainer = document.getElementById('connectionStatus');
    const indicator = statusContainer.querySelector('.status-indicator');
    const text = statusContainer.querySelector('.status-text');
    
    text.textContent = message;
    
    indicator.className = 'status-indicator';
    if (type === 'success') {
        indicator.classList.add('connected');
    } else if (type === 'loading') {
        indicator.classList.add('connecting');
    }
}

// Detectar plataforma de URL
function detectPlatform(url) {
    // YouTube
    if (url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/)) {
        return { platform: 'youtube', id: getYouTubeVideoId(url) };
    }
    
    // Twitch
    const twitchMatch = url.match(/(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)/);
    if (twitchMatch) {
        return { platform: 'twitch', id: twitchMatch[1] };
    }
    
    // Kick
    const kickMatch = url.match(/(?:https?:\/\/)?(?:www\.)?kick\.com\/([a-zA-Z0-9_]+)/);
    if (kickMatch) {
        return { platform: 'kick', id: kickMatch[1] };
    }
    
    // Google Drive
    const driveMatch = url.match(/(?:https?:\/\/)?(?:drive\.google\.com\/file\/d\/|drive\.google\.com\/open\?id=)([a-zA-Z0-9_-]+)/);
    if (driveMatch) {
        return { platform: 'drive', id: driveMatch[1] };
    }
    
    return null;
}

// Actualizar indicador de plataforma
function updatePlatformIndicator(platform) {
    const indicator = document.getElementById('platformIndicator');
    const text = document.getElementById('platformText');
    
    if (!platform) {
        indicator.style.display = 'none';
        return;
    }
    
    indicator.style.display = 'flex';
    indicator.className = `platform-indicator ${platform}`;
    
    const platformNames = {
        youtube: 'YouTube',
        twitch: 'Twitch',
        kick: 'Kick',
        drive: 'Drive',
        screen: 'Screen Share'
    };
    
    text.textContent = platformNames[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

// Detectar plataforma mientras se escribe
document.getElementById('videoUrl').addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url) {
        const detection = detectPlatform(url);
        updatePlatformIndicator(detection ? detection.platform : null);
    } else {
        updatePlatformIndicator(null);
    }
});

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

// === FUNCIONES DE COMPARTIR PANTALLA ===
async function initScreenShare() {
    try {
        const constraints = {
            video: {
                mediaSource: 'screen',
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 60, max: 60 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
        
        // Detectar cuando el usuario deja de compartir desde el navegador
        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
            stopScreenShare();
        });

        isScreenSharing = true;
        updateScreenShareButton();
        
        console.log('🖥️ Screen share iniciado:', screenStream.getVideoTracks()[0].getSettings());
        
        // Crear reproductor para la pantalla compartida
        createScreenPlayer();
        
        // Notificar a la sala que se está compartiendo pantalla
        if (currentRoom) {
            socket.emit('screen-share-start', {
                roomId: currentRoom,
                settings: screenStream.getVideoTracks()[0].getSettings()
            });
        }

        return true;
    } catch (error) {
        console.error('❌ Error al iniciar screen share:', error);
        
        if (error.name === 'NotAllowedError') {
            addSystemMessage('Screen sharing permission was denied');
        } else if (error.name === 'NotSupportedError') {
            addSystemMessage('Screen sharing is not supported in this browser');
        } else {
            addSystemMessage('Error starting screen share: ' + error.message);
        }
        
        isScreenSharing = false;
        updateScreenShareButton();
        return false;
    }
}

function createScreenPlayer() {
    // Limpiar reproductor anterior
    if (currentPlayer) {
        if (currentPlatform === 'youtube' && currentPlayer.destroy) {
            currentPlayer.destroy();
        } else if ((currentPlatform === 'drive' || currentPlatform === 'screen') && currentPlayer.pause) {
            currentPlayer.pause();
        }
        currentPlayer = null;
    }

    document.getElementById('noVideo').style.display = 'none';
    const playerContainer = document.getElementById('player');
    playerContainer.innerHTML = '';

    currentPlatform = 'screen';
    isPlayerReady = false;

    if(screenStream){
 const video = document.createElement('video');
    video.srcObject = screenStream;
    video.width = '100%';
    video.height = '100%';
    video.autoplay = true;
    video.muted = false; // Permitir audio del screen share
    video.playsInline = true;
    video.controls = false; // Quitar controles para screen share
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.backgroundColor = '#000';
    video.style.objectFit = 'contain';
   
        video.onloadedmetadata = () => {
        isPlayerReady = true;
        console.log('🖥️ Screen share player ready');
    };

    } else {
       // Usuarios que reciben - usar canvas para mostrar frames
       const canvas = document.createElement('canvas');
       canvas.width = 1920;
       canvas.height = 1080;
       canvas.style.width = '100%';
       canvas.style.height = '100%';
       canvas.style.backgroundColor = '#000';
       canvas.style.objectFit = 'contain';
       
       playerContainer.appendChild(canvas);
       currentPlayer = canvas;
       isPlayerReady = true;
       
       console.log('🖥️ Screen share receiver ready');
   }

    // No necesitamos eventos de play/pause para screen share ya que es en tiempo real
    
    playerContainer.appendChild(video);
    currentPlayer = video;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1920;
    canvas.height = 1080;

const sendFrame = () => {
    if (!screenStream || !isScreenSharing) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frameData = canvas.toDataURL('image/jpeg', 0.3); // Comprimir imagen
    
    if (currentRoom) {
        socket.emit('screen-frame', {
            roomId: currentRoom,
            frameData: frameData
        });
    }
    
    if (isScreenSharing) {
        setTimeout(sendFrame, 100); // 10 FPS
    }
};

video.onloadedmetadata = () => {
    isPlayerReady = true;
    sendFrame(); // Iniciar envío de frames
    console.log('🖥️ Screen share player ready');
    };
    
    // Actualizar la URL para mostrar que se está compartiendo pantalla
    document.getElementById('videoUrl').value = 'Screen Share Active';
    updatePlatformIndicator('screen');
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    isScreenSharing = false;
    updateScreenShareButton();
    
    // Limpiar el reproductor
    if (currentPlatform === 'screen') {
        document.getElementById('player').innerHTML = '';
        document.getElementById('noVideo').style.display = 'flex';
        document.getElementById('videoUrl').value = '';
        updatePlatformIndicator(null);
        currentPlayer = null;
        currentPlatform = null;
    }
    
    // Notificar a la sala que se dejó de compartir pantalla
    if (currentRoom) {
        socket.emit('screen-share-stop', {
            roomId: currentRoom
        });
    }
    
    console.log('🖥️ Screen share detenido');
}

async function toggleScreenShare() {
    if (!currentRoom) {
        alert('You must be in a room to share your screen');
        return;
    }

    if (isScreenSharing) {
        stopScreenShare();
        addSystemMessage('You stopped sharing your screen');
    } else {
        const success = await initScreenShare();
        if (success) {
            addSystemMessage('You started sharing your screen');
        }
    }
}

function updateScreenShareButton() {
    const btn = document.getElementById('screenShareBtn');
    
    if (isScreenSharing) {
        btn.classList.add('sharing');
        btn.title = 'Stop sharing screen';
        btn.querySelector('.screen-share-icon').textContent = '🛑';
    } else {
        btn.classList.remove('sharing');
        btn.title = 'Share screen';
        btn.querySelector('.screen-share-icon').textContent = '🖥️';
    }
}

// === FIN FUNCIONES DE COMPARTIR PANTALLA ===

// Crear reproductor según la plataforma
function createPlayer(platform, videoId) {
    // Limpiar reproductor anterior
    if (currentPlayer) {
        if (currentPlatform === 'youtube' && currentPlayer.destroy) {
            currentPlayer.destroy();
        } else if ((currentPlatform === 'drive' || currentPlatform === 'screen') && currentPlayer.pause) {
            currentPlayer.pause();
        }
        currentPlayer = null;
    }

    document.getElementById('noVideo').style.display = 'none';
    const playerContainer = document.getElementById('player');
    playerContainer.innerHTML = '';

    currentPlatform = platform;
    isPlayerReady = false;

    switch (platform) {
        case 'youtube':
            createYouTubePlayer(videoId);
            break;
        case 'twitch':
            createTwitchPlayer(videoId);
            break;
        case 'kick':
            createKickPlayer(videoId);
            break;
        case 'drive':
            createDrivePlayer(videoId);
            break;
        case 'screen':
            // Screen share se maneja por separado
            break;
    }
}

// Crear reproductor de YouTube
function createYouTubePlayer(videoId) {
    currentPlayer = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'autoplay': 0,
            'controls': 1,
            'rel': 0,
            'modestbranding': 1,
            'fs': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onYouTubeStateChange
        }
    });
}

// Crear reproductor de Twitch
function createTwitchPlayer(channel) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://player.twitch.tv/?channel=${channel}&parent=${window.location.hostname}&autoplay=false`;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.frameBorder = '0';
    iframe.allowFullscreen = true;
    iframe.style.border = 'none';
    
    document.getElementById('player').appendChild(iframe);
    currentPlayer = iframe;
    
    // Simular evento de ready para Twitch
    setTimeout(() => {
        isPlayerReady = true;
        console.log('📺 Twitch player ready');
    }, 1000);
}

// Crear reproductor de Kick
function createKickPlayer(channel) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://player.kick.com/${channel}`;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.frameBorder = '0';
    iframe.allowFullscreen = true;
    iframe.style.border = 'none';
    
    document.getElementById('player').appendChild(iframe);
    currentPlayer = iframe;
    
    // Simular evento de ready para Kick
    setTimeout(() => {
        isPlayerReady = true;
        console.log('📺 Kick player ready');
    }, 1000);
}

// Crear reproductor de Google Drive
function createDrivePlayer(fileId) {
    const video = document.createElement('video');
    video.src = `https://drive.google.com/uc?export=download&id=${fileId}`;
    video.width = '100%';
    video.height = '100%';
    video.controls = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.backgroundColor = '#000';
    
    // Eventos del reproductor de Drive
    video.onloadedmetadata = () => {
        isPlayerReady = true;
        console.log('📺 Google Drive player ready');
        console.log(`📹 Video duration: ${video.duration}s`);
    };

    video.onplay = () => {
        if (!isSyncing) {
            syncDriveVideo(true);
        }
    };

    video.onpause = () => {
        if (!isSyncing) {
            syncDriveVideo(false);
        }
    };

    video.onseeked = () => {
        if (!isSyncing) {
            syncDriveVideo(null, video.currentTime);
        }
    };

    video.ontimeupdate = () => {
        if (!isSyncing) {
            const now = Date.now();
            if (now - lastSyncTime > 5000) { // Sincronizar cada 5 segundos
                syncDriveVideo(null, video.currentTime);
            }
        }
    };

    video.onerror = (e) => {
        console.error('❌ Error loading Google Drive video:', e);
        addSystemMessage('Error loading Google Drive video. Make sure the file is publicly accessible.');
    };
    
    document.getElementById('player').appendChild(video);
    currentPlayer = video;
}

// Función específica para sincronizar videos de Drive
function syncDriveVideo(isPlaying = null, currentTime = null) {
    if (!currentPlayer || currentPlatform !== 'drive' || !currentRoom) return;
    
    const now = Date.now();
    if (now - lastSyncTime < syncCooldown) return;

    const videoCurrentTime = currentTime !== null ? currentTime : currentPlayer.currentTime;
    const videoIsPlaying = isPlaying !== null ? isPlaying : !currentPlayer.paused;
    
    lastSyncTime = now;
    
    socket.emit('video-sync', {
        roomId: currentRoom,
        currentTime: videoCurrentTime,
        isPlaying: videoIsPlaying,
        timestamp: now
    });

    console.log(`🔄 Google Drive video synced: ${videoIsPlaying ? 'Playing' : 'Paused'} at ${videoCurrentTime.toFixed(2)}s`);
}

function onPlayerReady(event) {
    console.log('🎬 YouTube player ready');
    isPlayerReady = true;
}

function onYouTubeStateChange(event) {
    if (!isPlayerReady || isSyncing || currentPlatform !== 'youtube') return;

    const now = Date.now();
    if (now - lastSyncTime < syncCooldown) return;

    const currentTime = currentPlayer.getCurrentTime();
    const isPlaying = event.data === YT.PlayerState.PLAYING;
    
    console.log(`🎮 YouTube estado cambió: ${isPlaying ? 'Playing' : 'Paused'} en ${currentTime.toFixed(2)}s`);
    
    lastSyncTime = now;
    socket.emit('video-sync', {
        roomId: currentRoom,
        currentTime: currentTime,
        isPlaying: isPlaying,
        timestamp: now
    });
}

// === FUNCIONES DE VOZ MEJORADAS ===
async function initVoice() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 44100
            } 
        });
        
        localStream = stream;
        isVoiceEnabled = true;
        
        // Configurar análisis de audio para visualización
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        
        analyser.fftSize = 256;
        microphone.connect(analyser);
        
        // Configurar MediaRecorder para capturar audio
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 128000
        });
        
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
            audioChunks = [];
            
            // Convertir a base64 para enviar por socket
            const reader = new FileReader();
            reader.onload = () => {
                const base64Audio = reader.result.split(',')[1];
                
                // Enviar audio a la sala
                if (currentRoom && !isMuted) {
                    socket.emit('voice-data', {
                        roomId: currentRoom,
                        audioData: base64Audio
                    });
                }
            };
            reader.readAsDataURL(audioBlob);
        };
        
        // Iniciar grabación en intervalos
        mediaRecorder.start();
        
        // Detener y reiniciar cada 500ms para enviar chunks pequeños
        audioInterval = setInterval(() => {
            if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                mediaRecorder.start();
            }
        }, 500);
        
        // Inicialmente silenciado
        localStream.getAudioTracks().forEach(track => {
            track.enabled = false;
        });
        
        updateVoiceStatus();
        startVoiceVisualization();
        
        console.log('🎤 Micrófono inicializado correctamente');
        
    } catch (error) {
        console.error('❌ Error al acceder al micrófono:', error);
        document.getElementById('voiceStatus').textContent = 'Microphone access denied';
        document.getElementById('micButton').classList.add('disabled');
    }
}

function toggleMicrophone() {
    if (!isVoiceEnabled) {
        initVoice();
        return;
    }
    
    if (!localStream) return;
    
    isMuted = !isMuted;
    
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    
    updateVoiceStatus();
    
    // Notificar a otros usuarios del estado del micrófono
    if (currentRoom) {
        socket.emit('voice-status', {
            roomId: currentRoom,
            isMuted: isMuted
        });
    }
    
    console.log(`🎤 Micrófono ${isMuted ? 'silenciado' : 'activado'}`);
}

function updateVoiceStatus() {
    const micButton = document.getElementById('micButton');
    const voiceStatus = document.getElementById('voiceStatus');
    
    if (!isVoiceEnabled) {
        micButton.className = 'mic-button disabled';
        voiceStatus.textContent = 'Click to enable voice';
        return;
    }
    
    if (isMuted) {
        micButton.className = 'mic-button muted';
        voiceStatus.textContent = 'Muted';
        micButton.textContent = '🔇';
    } else {
        micButton.className = 'mic-button active';
        voiceStatus.textContent = 'Speaking';
        micButton.textContent = '🎤';
    }
}

function startVoiceVisualization() {
    if (!analyser) return;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const indicators = document.querySelectorAll('.voice-indicator');
    
    function updateVisualization() {
        if (!analyser || isMuted) {
            indicators.forEach(indicator => {
                indicator.classList.remove('active');
            });
            requestAnimationFrame(updateVisualization);
            return;
        }
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calcular nivel de audio promedio
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const normalizedLevel = average / 255;
        
        // Activar indicadores basado en el nivel de audio
        indicators.forEach((indicator, index) => {
            const threshold = (index + 1) * 0.25;
            if (normalizedLevel > threshold) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        });
        
        requestAnimationFrame(updateVisualization);
    }
    
    updateVisualization();
}

// Procesar audio recibido de otros usuarios
function processIncomingAudio(audioData, socketId) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Decodificar audio base64
    const binaryAudio = atob(audioData);
    const len = binaryAudio.length;
    const bytes = new Uint8Array(len);
    
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryAudio.charCodeAt(i);
    }
    
    const audioBlob = new Blob([bytes], { type: 'audio/webm;codecs=opus' });
    const audioUrl = URL.createObjectURL(audioBlob);
    
    // Crear elemento de audio para reproducir
    const audioElement = new Audio(audioUrl);
    audioElement.volume = 0.7;
    
    // Si ya existe un procesador para este usuario, detenerlo
    if (audioProcessors.has(socketId)) {
        const oldProcessor = audioProcessors.get(socketId);
        if (oldProcessor) {
            oldProcessor.pause();
            URL.revokeObjectURL(oldProcessor.src);
        }
    }
    
    // Guardar y reproducir el nuevo audio
    audioProcessors.set(socketId, audioElement);
    
    // Reproducir el audio con un pequeño retraso
    setTimeout(() => {
        audioElement.play().catch(e => {
            console.error('Error reproduciendo audio:', e);
            if (e.name === 'NotAllowedError') {
                addSystemMessage('Click anywhere to enable audio playback');
                document.body.addEventListener('click', function enableAudio() {
                    audioElement.play().catch(console.error);
                    document.body.removeEventListener('click', enableAudio);
                }, { once: true });
            }
        });
    }, 100);
    
    // Limpiar después de que termine de reproducirse
    audioElement.onended = () => {
        URL.revokeObjectURL(audioUrl);
        audioProcessors.delete(socketId);
    };
}

// Limpiar recursos de audio al salir
function cleanupVoice() {
    if (audioInterval) {
        clearInterval(audioInterval);
        audioInterval = null;
    }
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
    }
    
    // Limpiar todos los procesadores de audio
    audioProcessors.forEach((processor, socketId) => {
        processor.pause();
        URL.revokeObjectURL(processor.src);
    });
    audioProcessors.clear();
    
    isVoiceEnabled = false;
    isMuted = true;
    updateVoiceStatus();
}

// === FIN FUNCIONES DE VOZ ===

// Sincronización mejorada para múltiples plataformas
function syncVideo(data) {
    if (!currentPlayer || !isPlayerReady) return;
    
    const now = Date.now();
    const latency = data.timestamp ? (now - data.timestamp) / 1000 : 0;
    
    isSyncing = true;
    
    if (currentPlatform === 'youtube') {
        const adjustedTime = data.currentTime + latency + syncBuffer;
        const currentTime = currentPlayer.getCurrentTime();
        const timeDiff = Math.abs(currentTime - adjustedTime);
        
        if (timeDiff > syncThreshold) {
            currentPlayer.seekTo(adjustedTime, true);
            console.log(`🔄 YouTube ajustando tiempo: ${timeDiff.toFixed(2)}s de diferencia`);
        }
        
        const currentState = currentPlayer.getPlayerState();
        setTimeout(() => {
            if (data.isPlaying && currentState !== YT.PlayerState.PLAYING && currentState !== YT.PlayerState.BUFFERING) {
                currentPlayer.playVideo();
            } else if (!data.isPlaying && currentState === YT.PlayerState.PLAYING) {
                currentPlayer.pauseVideo();
            }
        }, 50);
        
    } else if (currentPlatform === 'drive') {
        const adjustedTime = data.currentTime + latency;
        const currentTime = currentPlayer.currentTime;
        const timeDiff = Math.abs(currentTime - adjustedTime);
        
        if (timeDiff > syncThreshold) {
            currentPlayer.currentTime = adjustedTime;
            console.log(`🔄 Drive ajustando tiempo: ${timeDiff.toFixed(2)}s de diferencia`);
        }
        
        setTimeout(() => {
            if (data.isPlaying && currentPlayer.paused) {
                currentPlayer.play().catch(e => {
                    console.error('Error al reproducir video de Drive:', e);
                    if (e.name === 'NotAllowedError') {
                        addSystemMessage('Click anywhere to enable video autoplay');
                    }
                });
            } else if (!data.isPlaying && !currentPlayer.paused) {
                currentPlayer.pause();
            }
        }, 50);
        
    } else if (currentPlatform === 'screen') {
        // Screen share no necesita sincronización ya que es en tiempo real
        console.log(`🔄 Screen share - no sync needed (real-time)`);
    } else {
        console.log(`🔄 ${currentPlatform} sincronización (streams en vivo no requieren sync de tiempo)`);
    }
    
    setTimeout(() => {
        isSyncing = false;
    }, 150);
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
        updateConnectionStatus('Connected', 'success');
        document.getElementById('createBtn').disabled = false;
        document.getElementById('joinBtn').disabled = false;
    });

    socket.on('disconnect', (reason) => {
        console.log('❌ Desconectado:', reason);
        updateConnectionStatus('Disconnected', 'error');
        document.getElementById('createBtn').disabled = true;
        document.getElementById('joinBtn').disabled = true;
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Error de conexión:', error);
        updateConnectionStatus('Connection error', 'error');
    });

    // Eventos de sala
    socket.on('room-joined', (data) => {
        console.log('🏠 Unido a sala:', data);
        currentRoom = data.roomId;
        showRoomScreen(data);
        
        if (data.video && data.video.url) {
            loadVideoFromData(data.video);
        }
    });

    socket.on('user-joined', (data) => {
        console.log('👤 Usuario se unió:', data.username);
        updateUserCount(data.userCount);
        addSystemMessage(`${data.username} joined the room`);
    });

    socket.on('user-left', (data) => {
        console.log('👋 Usuario salió:', data.username);
        updateUserCount(data.userCount);
        addSystemMessage(`${data.username} left the room`);
    });

    socket.on('video-changed', (data) => {
        console.log('📺 Video cambiado:', data);
        if (data.platform && data.videoId) {
            createPlayer(data.platform, data.videoId);
            const platformName = data.platform.charAt(0).toUpperCase() + data.platform.slice(1);
            const displayName = data.channelName || data.videoId;
            
            let mediaType = 'video';
            if (data.platform === 'twitch' || data.platform === 'kick') {
                mediaType = 'stream';
            } else if (data.platform === 'screen') {
                mediaType = 'screen share';
            }
            
            addSystemMessage(`${platformName} ${mediaType} changed: ${displayName}`);
        }
    });

    socket.on('video-synced', (data) => {
        console.log('🔄 Sincronizando video:', data);
        syncVideo(data);
    });

    socket.on('new-message', (data) => {
        addChatMessage(data);
    });

    socket.on('voice-status', (data) => {
        addSystemMessage(`${data.username} ${data.isMuted ? 'muted' : 'unmuted'} their microphone`);
    });

    socket.on('voice-data', (data) => {
        processIncomingAudio(data.audioData, data.socketId);
    });

    // Eventos de screen share
    socket.on('screen-share-started', (data) => {
        addSystemMessage(`${data.username} started sharing their screen`);
    });

    socket.on('screen-share-stopped', (data) => {
        addSystemMessage(`${data.username} stopped sharing their screen`);
    });

    socket.on('screen-frame', (data) => {
    if (currentPlatform === 'screen' && data.socketId !== socket.id) {
        // Mostrar frame recibido de otro usuario
        const img = new Image();
        img.onload = () => {
            if (currentPlayer && currentPlayer.tagName === 'CANVAS') {
                const ctx = currentPlayer.getContext('2d');
                ctx.drawImage(img, 0, 0, currentPlayer.width, currentPlayer.height);
            }
        };
        img.src = data.frameData;
    }
    });

    socket.on('error', (data) => {
        console.error('❌ Error:', data.message);
        alert('Error: ' + data.message);
    });
}

function loadVideoFromData(videoData) {
    if (videoData && videoData.platform && videoData.videoId) {
        createPlayer(videoData.platform, videoData.videoId);
        document.getElementById('videoUrl').value = videoData.url || '';
        updatePlatformIndicator(videoData.platform);
        
        // Sincronizar tiempo para YouTube y Drive
        if (videoData.platform === 'youtube' || videoData.platform === 'drive') {
            setTimeout(() => {
                if (currentPlayer && isPlayerReady) {
                    if (videoData.platform === 'youtube') {
                        currentPlayer.seekTo(videoData.currentTime || 0, true);
                        if (videoData.isPlaying) {
                            setTimeout(() => currentPlayer.playVideo(), 200);
                        }
                    } else if (videoData.platform === 'drive') {
                        currentPlayer.currentTime = videoData.currentTime || 0;
                        if (videoData.isPlaying) {
                            setTimeout(() => currentPlayer.play().catch(console.error), 200);
                        }
                    }
                }
            }, 1000);
        }
    }
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
    const modal = document.getElementById('joinFormModal');
    const container = document.querySelector('.container');
    
    modal.classList.add('visible');
    container.classList.add('modal-open');
    document.getElementById('username').focus();
}

function hideJoinForm() {
    const modal = document.getElementById('joinFormModal');
    const container = document.querySelector('.container');
    
    modal.classList.remove('visible');
    container.classList.remove('modal-open');
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
    hideJoinForm();
}

// Mostrar pantalla de sala
function showRoomScreen(data) {
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('mainLayout').classList.remove('hidden');
    document.getElementById('urlInputNav').classList.remove('hidden');
    document.getElementById('roomInfoNav').classList.remove('hidden');
    document.getElementById('leaveBtn').classList.remove('hidden');
    document.getElementById('screenShareBtn').classList.remove('hidden');
    
    document.getElementById('currentRoom').textContent = data.roomId;
    updateUserCount(data.users ? data.users.length : 1);
    
    // Mostrar mensajes existentes
    if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => addChatMessage(msg));
    }
}

// Actualizar contador de usuarios
function updateUserCount(count) {
    document.getElementById('userCount').textContent = count;
    document.getElementById('userCountChat').textContent = count;
}

// Cargar video
function loadVideo() {
    const url = document.getElementById('videoUrl').value.trim();
    if (!url) {
        alert('Please enter a valid URL');
        return;
    }
    
    const detection = detectPlatform(url);
    if (!detection) {
        alert('Invalid URL. Supported platforms: YouTube, Twitch, Kick, Google Drive');
        return;
    }
    
    // Detener screen share si está activo
    if (isScreenSharing) {
        stopScreenShare();
    }
    
    createPlayer(detection.platform, detection.id);
    socket.emit('video-change', { roomId: currentRoom, url });
    
    const platformName = detection.platform.charAt(0).toUpperCase() + detection.platform.slice(1);
    let mediaType = 'video';
    if (detection.platform === 'twitch' || detection.platform === 'kick') {
        mediaType = 'stream';
    }
    
    addSystemMessage(`${platformName} ${mediaType} loaded: ${detection.id}`);
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
        cleanupVoice();
        
        // Detener screen share si está activo
        if (isScreenSharing) {
            stopScreenShare();
        }
        
        if (currentPlayer) {
            if (currentPlatform === 'youtube' && currentPlayer.destroy) {
                currentPlayer.destroy();
            } else if ((currentPlatform === 'drive' || currentPlatform === 'screen') && currentPlayer.pause) {
                currentPlayer.pause();
            }
        }
        location.reload();
    }
}

// Cerrar modal al hacer clic en el overlay
document.getElementById('joinFormModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        hideJoinForm();
    }
});

// Manejadores de eventos de teclado
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        if (e.target.id === 'messageInput') sendMessage();
        if (e.target.id === 'roomCode') joinRoom();
        if (e.target.id === 'videoUrl') loadVideo();
    }
    
    if (e.key === 'Escape') {
        hideJoinForm();
    }
});

// Atajo de teclado para micrófono (Espacio)
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        toggleMicrophone();
    }
    
    if (e.key === 'Escape') {
        hideJoinForm();
    }
});

// Limpiar recursos al cerrar la pestaña
window.addEventListener('beforeunload', () => {
    cleanupVoice();
    if (isScreenSharing) {
        stopScreenShare();
    }
});

// Iniciar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Page loaded, starting Coupether with multi-platform support including Google Drive and Screen Share...');
    initSocket();
});