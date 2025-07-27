const socket = io();

let localStream;
const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const audiosDiv = document.getElementById('audio-zone');
const participantsList = document.getElementById('participants-list');
const joinBtn = document.getElementById('join');
const nameInput = document.getElementById('name');
const roomInput = document.getElementById('room');
const prayerRoom = document.getElementById('prayer-room');
const joinSection = document.getElementById('join-section');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

let roomName = '';
let userName = '';
let micEnabled = true;

// Affiche message chat
function addChatMessage(msg, fromYou = false) {
  const p = document.createElement('div');
  p.classList.add('chat-message');
  p.classList.add(fromYou ? 'you' : 'other');
  p.textContent = msg;
  chatMessages.appendChild(p);
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

// Met à jour la liste des participants (array d'objets {id, name, micOn})
function updateParticipantsList(participants) {
  participantsList.querySelectorAll('.participant').forEach(el => el.remove());
  participants.forEach(({ id, name, micOn }) => {
    const div = document.createElement('div');
    div.classList.add('participant');
    div.setAttribute('data-id', id);

    const spanName = document.createElement('span');
    spanName.classList.add('name');
    spanName.textContent = name;
    div.appendChild(spanName);

    // Bouton micro
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

// Toggle micro local et informe les autres
function toggleMic(userId) {
  if (userId === socket.id) {
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(track => track.enabled = micEnabled);
    socket.emit('mic-toggle', { room: roomName, micOn: micEnabled });
    updateParticipantsLocalMic(micEnabled);
  } else {
    // Ne peut pas controler micro des autres (sécurité)
    alert("Vous ne pouvez pas changer le micro des autres.");
  }
}

// Mise à jour visuelle locale du micro dans la liste
function updateParticipantsLocalMic(micOn) {
  const localDiv = participantsList.querySelector(`.participant[data-id="${socket.id}"]`);
  if (!localDiv) return;
  const btn = localDiv.querySelector('.mic-btn');
  btn.innerHTML = micOn ? "🎤" : "🔇";
  btn.title = micOn ? "Micro activé" : "Micro désactivé";
  btn.classList.toggle('off', !micOn);
}

// Surveillance du volume audio local pour effet "speaking"
function monitorAudioLevel(stream, audioElem) {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function checkVolume() {
    analyser.getByteFrequencyData(dataArray);
    const volume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    if (volume > 30) {
      audioElem.classList.add('speaking');
    } else {
      audioElem.classList.remove('speaking');
    }
    requestAnimationFrame(checkVolume);
  }
  checkVolume();
}

// Création PeerConnection
function createPeerConnection(userId) {
  const pc = new RTCPeerConnection(servers);

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

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

// Rejoindre la salle
joinBtn.onclick = async () => {
  roomName = roomInput.value.trim();
  userName = nameInput.value.trim();
  if (!roomName || !userName) {
    alert("Veuillez entrer votre nom et le nom de la chambre");
    return;
  }

  joinBtn.disabled = true;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getAudioTracks().forEach(track => track.enabled = true);
    micEnabled = true;

    // Affichage UI réunion
    joinSection.style.display = 'none';
    prayerRoom.style.display = 'flex';

    // Audio local muet (muted true pour pas qu'on s'entende)
    const localAudio = document.createElement('audio');
    localAudio.id = 'audio-local';
    localAudio.autoplay = true;
    localAudio.muted = true;
    localAudio.srcObject = localStream;
    audiosDiv.appendChild(localAudio);
    monitorAudioLevel(localStream, localAudio);

    socket.emit('join-room', { room: roomName, name: userName, micOn: micEnabled });

  } catch (err) {
    alert("Erreur accès micro: " + err.message);
    joinBtn.disabled = false;
  }
};

const peerConnections = {};

socket.on('update-participants', data => {
  updateParticipantsList(data.participants);
});

socket.on('user-joined', async data => {
  const userId = data.id;
  const pc = createPeerConnection(userId);
  peerConnections[userId] = pc;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { offer, room: roomName, to: userId });
});

socket.on('offer', async data => {
  const pc = createPeerConnection(data.from);
  peerConnections[data.from] = pc;

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { answer, room: roomName, to: data.from });
});

socket.on('answer', async data => {
  const pc = peerConnections[data.from];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }
});

socket.on('ice-candidate', async data => {
  const pc = peerConnections[data.from];
  if (pc && data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
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

// Reception chat
chatInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && chatInput.value.trim()) {
    const message = chatInput.value.trim();
    addChatMessage(`Moi : ${message}`, true);
    socket.emit('chat-message', { room: roomName, name: userName, message });
    chatInput.value = '';
  }
});

socket.on('chat-message', data => {
  if (data.name !== userName) {
    addChatMessage(`${data.name} : ${data.message}`);
  }
});

// Mic toggle reception pour maj participants
socket.on('mic-status-changed', data => {
  const { userId, micOn } = data;
  const partDiv = participantsList.querySelector(`.participant[data-id="${userId}"]`);
  if (!partDiv) return;
  const btn = partDiv.querySelector('.mic-btn');
  btn.innerHTML = micOn ? "🎤" : "🔇";
  btn.title = micOn ? "Micro activé" : "Micro désactivé";
  btn.classList.toggle('off', !micOn);
});
