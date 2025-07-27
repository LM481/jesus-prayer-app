const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const rooms = {}; // { roomName: { participants: { socketId: { name, micOn } } } }

app.use(express.static(__dirname));

io.on('connection', socket => {
  console.log('Utilisateur connecté :', socket.id);

  socket.on('join-room', data => {
    const { room, name, micOn } = data;
    socket.join(room);

    if (!rooms[room]) {
      rooms[room] = { participants: {} };
    }
    rooms[room].participants[socket.id] = { name, micOn: micOn ?? true };

    // Envoyer liste mise à jour à tous
    io.to(room).emit('update-participants', {
      participants: Object.entries(rooms[room].participants).map(([id, p]) => ({
        id,
        name: p.name,
        micOn: p.micOn
      }))
    });

    socket.to(room).emit('user-joined', { id: socket.id, name });

    // Relay offer, answer, candidates
    socket.on('offer', offerData => {
      io.to(offerData.to).emit('offer', { offer: offerData.offer, from: socket.id });
    });

    socket.on('answer', answerData => {
      io.to(answerData.to).emit('answer', { answer: answerData.answer, from: socket.id });
    });

    socket.on('ice-candidate', candidateData => {
      io.to(candidateData.to).emit('ice-candidate', { candidate: candidateData.candidate, from: socket.id });
    });

    // Chat
    socket.on('chat-message', msgData => {
      io.to(room).emit('chat-message', { name, message: msgData.message });
    });

    // Micro toggle
    socket.on('mic-toggle', micData => {
      if (rooms[room] && rooms[room].participants[socket.id]) {
        rooms[room].participants[socket.id].micOn = micData.micOn;
        io.to(room).emit('mic-status-changed', { userId: socket.id, micOn: micData.micOn });
      }
    });

    socket.on('disconnect', () => {
      if (rooms[room] && rooms[room].participants[socket.id]) {
        delete rooms[room].participants[socket.id];
        io.to(room).emit('user-left', socket.id);
        io.to(room).emit('update-participants', {
          participants: Object.entries(rooms[room].participants).map(([id, p]) => ({
            id,
            name: p.name,
            micOn: p.micOn
          }))
        });
      }
      console.log(`${socket.id} a quitté ${room}`);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});

