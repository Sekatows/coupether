const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

console.log('🚀 Iniciando servidor simplificado...');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3001; // Puerto diferente para no interferir

// Middleware básico
app.use(express.static(path.join(__dirname, 'public')));

// Ruta de diagnóstico
app.get('/diagnostic', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    socketIO: 'Available',
    staticPath: path.join(__dirname, 'public')
  });
});

// Página de prueba simple
app.get('/simple', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Prueba Simple</title>
</head>
<body>
    <h1>🧪 Prueba de Conexión</h1>
    <div id="status">Conectando...</div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const status = document.getElementById('status');
        
        socket.on('connect', () => {
            status.innerHTML = '✅ Conectado! Socket ID: ' + socket.id;
            status.style.color = 'green';
        });
        
        socket.on('disconnect', () => {
            status.innerHTML = '❌ Desconectado';
            status.style.color = 'red';
        });
        
        socket.on('connect_error', (error) => {
            status.innerHTML = '❌ Error: ' + error.message;
            status.style.color = 'red';
        });
    </script>
</body>
</html>
  `);
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('✅ Cliente conectado:', socket.id);
  
  socket.emit('welcome', 'Conexión exitosa!');
  
  socket.on('disconnect', () => {
    console.log('❌ Cliente desconectado:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🎯 SERVIDOR DIAGNÓSTICO INICIADO');
  console.log(`📍 Prueba simple: http://localhost:${PORT}/simple`);
  console.log(`🔧 Diagnóstico: http://localhost:${PORT}/diagnostic`);
  console.log(`📁 Archivos estáticos desde: ${path.join(__dirname, 'public')}`);
  console.log('='.repeat(50));
  
  // Listar archivos en public
  const fs = require('fs');
  const publicDir = path.join(__dirname, 'public');
  
  if (fs.existsSync(publicDir)) {
    console.log('\n📁 Archivos en /public:');
    try {
      const files = fs.readdirSync(publicDir);
      files.forEach(file => console.log(`   - ${file}`));
    } catch (err) {
      console.log('   Error listando archivos:', err.message);
    }
  } else {
    console.log('\n❌ La carpeta /public no existe!');
  }
  
  console.log('\n💡 Si la prueba simple funciona, el problema está en el código principal');
  console.log('💡 Si no funciona, hay un problema con la configuración básica\n');
});