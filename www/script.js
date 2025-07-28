const socket = io();

let localStream;
const peerConnections = {};

const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:141.94.245.41:3478',
      username: 'jesus',
      credential: 'Saintesprit02'
    }
  ]
};

const audiosDiv = document.getElementById('audio-zone');
const participantsList = document.getElementById('participants-list');
const joinBtn = document.getElementById('join');
const nameInput = document.getElementById('name');
const roomInput = document.getElementById('room');
const prayerRoom = document.getElementById('prayer-room');
const joinSection = document.getElementById('join-section');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

let roomName = '';
let userName = '';
let micEnabled = true;

/* Ajoute un message dans la zone chat */
function addChatMessage(msg, self = false) {
  const div = document.createElement('div');
  div.classList.add('chat-message');
  div.classList.add(self ? 'self' : 'other');
  div.textContent = msg;
  chatMessages.appendChild(div);
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

/* Met à jour la liste des participants */
function updateParticipantsList(participants) {
  participantsList.querySelectorAll('.participant').forEach(el => el.remove());
  participants.forEach(({ id, name, micOn }) => {
    const div = document.createElement('div');
    div.classList.add('participant');
    div.dataset.id = id;

    const spanName = document.createElement('span');
    spanName.classList.add('name');
    spanName.textContent = name;
    div.appendChild(spanName);

    const micBtn = document.createElement('button');
    micBtn.classList.add('mic-btn');
    micBtn.title = micOn ? "Micro activé" : "Micro désactivé";
    micBtn.innerHTML = micOn ? "🎤" : "🔇";
    if (!micOn) micBtn.classList.add('off');
    micBtn.onclick = () => toggleMic(id);
    div.appendChild(micBtn);

    participantsList.appendChild(div);
  });
}

/* Permet de couper/rallumer le micro local */
function toggleMic(userId) {
  if (userId !== socket.id) {
    alert("Tu ne peux pas couper le micro des autres.");
    return;
  }
  micEnabled = !micEnabled;
  if(localStream) {
    localStream.getAudioTracks().forEach(track => (track.enabled = micEnabled));
  }
  socket.emit('mic-toggle', { room: roomName, micOn: micEnabled });
  updateParticipantsLocalMic(micEnabled);
}

/* Met à jour l’icône micro local dans la liste */
function updateParticipantsLocalMic(micOn) {
  const localDiv = participantsList.querySelector(`.participant[data-id="${socket.id}"]`);
  if (!localDiv) return;
  const btn = localDiv.querySelector('.mic-btn');
  btn.innerHTML = micOn ? "🎤" : "🔇";
  btn.title = micOn ? "Micro activé" : "Micro désactivé";
  btn.classList.toggle('off', !micOn);
}

/* Surveille le niveau audio et ajoute la classe speaking */
function monitorAudioLevel(stream, audioElem) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function checkVolume() {
    if (context.state === "closed") return;
    analyser.getByteFrequencyData(dataArray);
    const volume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    audioElem.classList.toggle('speaking', volume > 30);
    requestAnimationFrame(checkVolume);
  }
  checkVolume();
}

/* Crée une connexion WebRTC pour un peer donné */
function createPeerConnection(userId) {
  const pc = new RTCPeerConnection(servers);

  if(localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { candidate: event.candidate, room: roomName, to: userId });
    }
  };

  pc.ontrack = (event) => {
    let audioElem = document.getElementById(`audio-${userId}`);
    if (!audioElem) {
      audioElem = document.createElement('audio');
      audioElem.id = `audio-${userId}`;
      audioElem.autoplay = true;
      audiosDiv.appendChild(audioElem);
      monitorAudioLevel(event.streams[0], audioElem);
    }
    audioElem.srcObject = event.streams[0];
  };

  return pc;
}

/* Gestion bouton rejoindre */
joinBtn.onclick = async () => {
  roomName = roomInput.value.trim();
  userName = nameInput.value.trim();
  if (!roomName || !userName) {
    alert("Veuillez entrer votre nom et le nom de la chambre.");
    return;
  }

  joinBtn.disabled = true;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micEnabled = true;

    joinSection.style.display = 'none';
    prayerRoom.style.display = 'flex';

    const localAudio = document.createElement('audio');
    localAudio.id = 'audio-local';
    localAudio.autoplay = true;
    localAudio.muted = true;
    localAudio.srcObject = localStream;
    audiosDiv.appendChild(localAudio);
    monitorAudioLevel(localStream, localAudio);

    // Affiche l'état micro local
    updateParticipantsLocalMic(micEnabled);

    socket.emit('join-room', { room: roomName, name: userName, micOn: micEnabled });
  } catch (err) {
    alert("Erreur accès micro : " + err.message);
    joinBtn.disabled = false;
  }
};

/* Socket.io écouteurs */

socket.on('update-participants', ({ participants }) => updateParticipantsList(participants));

socket.on('user-joined', async ({ id }) => {
  try {
    const pc = createPeerConnection(id);
    peerConnections[id] = pc;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { offer, room: roomName, to: id });
  } catch (e) {
    console.error("Erreur user-joined:", e);
  }
});

socket.on('offer', async ({ from, offer }) => {
  try {
    const pc = createPeerConnection(from);
    peerConnections[from] = pc;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { answer, room: roomName, to: from });
  } catch (e) {
    console.error("Erreur offer:", e);
  }
});

socket.on('answer', async ({ from, answer }) => {
  const pc = peerConnections[from];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = peerConnections[from];
  if (pc && candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error("Erreur ICE:", e);
    }
  }
});

socket.on('user-left', userId => {
  if (peerConnections[userId]) {
    peerConnections[userId].close();
    delete peerConnections[userId];
  }
  const audioElem = document.getElementById(`audio-${userId}`);
  if (audioElem) audioElem.remove();
});

/* Chat */

function sendMessage() {
  if (chatInput.value.trim()) {
    const message = chatInput.value.trim();
    addChatMessage(`Moi : ${message}`, true);
    socket.emit('chat-message', { room: roomName, name: userName, message });
    chatInput.value = '';
  }
}

sendBtn.onclick = sendMessage;

chatInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') sendMessage();
});

socket.on('chat-message', ({ name, message }) => {
  if (name !== userName) {
    addChatMessage(`${name} : ${message}`, false);
  }
});

/* Mise à jour icône micro autres participants */
socket.on('mic-status-changed', ({ userId, micOn }) => {
  const partDiv = participantsList.querySelector(`.participant[data-id="${userId}"]`);
  if (!partDiv) return;
  const btn = partDiv.querySelector('.mic-btn');
  btn.innerHTML = micOn ? "🎤" : "🔇";
  btn.title = micOn ? "Micro activé" : "Micro désactivé";
  btn.classList.toggle('off', !micOn);
});
