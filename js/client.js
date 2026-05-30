const socket = io();

let currentRoom = null;
let currentQuestionIndex = 0;
let currentRound = 1;
let timer = null;
let timeLeft = 30;
let playerName = '';
let isHost = false;
let selectedAvatar = 0;
let selectedGameMode = 'solo';
let mafiaState = null;
let codenamesState = null;
let mySocketId = null;

const avatarEmojis = ['😎','🦸','🦹','🧙','🧛','🧟','🧞','🥷','🤴','👑','🎭','🎪','🎯','🎲','🎮','🏆','⚡','🔥','💎','🌟','🦇','🐺'];

socket.on('connect', () => { mySocketId = socket.id; });

function init() {
  const grid = document.getElementById('avatar-grid');
  avatarEmojis.forEach((emoji, i) => {
    const div = document.createElement('div');
    div.className = 'avatar-item' + (i === 0 ? ' selected' : '');
    div.textContent = emoji;
    div.onclick = () => selectAvatar(i);
    grid.appendChild(div);
  });
}

function selectAvatar(index) {
  selectedAvatar = index;
  document.querySelectorAll('.avatar-item').forEach((el, i) => {
    el.classList.toggle('selected', i === index);
  });
}

function selectMode(mode) {
  selectedGameMode = mode;
  document.querySelectorAll('.mode-card').forEach(el => {
    el.classList.toggle('selected', el.dataset.mode === mode);
  });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function getPlayerName() {
  const val = document.getElementById('player-name').value.trim();
  if (!val) { alert('أدخل اسمك'); return null; }
  playerName = val;
  return val;
}

function createRoom() {
  const name = getPlayerName();
  if (!name) return;
  socket.emit('createRoom', { name, avatar: selectedAvatar, mode: selectedGameMode });
}

function joinRoom() {
  const name = getPlayerName();
  if (!name) return;
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code) { alert('أدخل كود الغرفة'); return; }
  socket.emit('joinRoom', { code, name, avatar: selectedAvatar });
}

function switchTeam(team) {
  socket.emit('switchTeam', { code: currentRoom, team });
}

function pickCodenamesTeam(team) {
  socket.emit('pickCodenamesTeam', { code: currentRoom, team });
}

function startGame() {
  socket.emit('startGame', { code: currentRoom });
}

function startMafiaGame() {
  socket.emit('startMafiaGame', { code: currentRoom });
}

function startCodenamesGame() {
  socket.emit('startCodenamesStandalone', { code: currentRoom });
}

function updateMafiaConfig() {
  socket.emit('updateMafiaConfig', {
    code: currentRoom,
    config: {
      hasDoctor: document.getElementById('cfg-doctor').checked,
      hasPolice: document.getElementById('cfg-police').checked
    }
  });
}

function copyRoomCode() {
  if (currentRoom) {
    navigator.clipboard.writeText(currentRoom).then(() => alert('تم النسخ: ' + currentRoom));
  }
}

function goHome() {
  showScreen('screen-home');
  currentRoom = null;
  isHost = false;
  clearTimer();
}

function startTimer(duration, elementId, onEnd) {
  clearTimer();
  timeLeft = duration;
  const fill = document.getElementById(elementId);
  const display = document.getElementById('mafia-timer-display') || document.getElementById('mafia-timer-day') || document.getElementById('mafia-timer-vote');
  timer = setInterval(() => {
    timeLeft--;
    if (fill) fill.style.width = (timeLeft / duration * 100) + '%';
    if (display) display.textContent = timeLeft + ' ثانية';
    if (timeLeft <= 0) {
      clearTimer();
      if (onEnd) onEnd();
    }
  }, 1000);
}

function clearTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

function submitTrapAnswer() {
  const answer = document.getElementById('trap-answer-input').value.trim();
  if (!answer) { alert('اكتب إجابة فخ'); return; }
  socket.emit('submitTrapAnswer', { code: currentRoom, answer });
  document.getElementById('trap-answer-input').value = '';
  document.getElementById('trap-answer-input').disabled = true;
}

function submitOption(index) {
  socket.emit('submitOption', { code: currentRoom, optionIndex: index });
  document.querySelectorAll('.option-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === index) btn.classList.add('selected');
  });
}

function requestNextQuestion() {
  socket.emit('requestNextQuestion', { code: currentRoom });
}

function submitDrawGuess() {
  const guess = document.getElementById('draw-guess-input').value.trim();
  if (!guess) return;
  socket.emit('submitDrawGuess', { code: currentRoom, guess });
  document.getElementById('draw-guess-input').value = '';
}

function endDrawRound() {
  socket.emit('endDrawRound', { code: currentRoom });
}

function submitSpymasterClue() {
  const word = document.getElementById('cn-clue-input').value.trim();
  const count = parseInt(document.getElementById('cn-clue-number').value);
  if (!word || isNaN(count)) { alert('أدخل التلميح والعدد'); return; }
  socket.emit('submitClue', { code: currentRoom, word, count });
}

function guessCodenamesWord(index) {
  socket.emit('guessCodenamesWord', { code: currentRoom, index });
}

function endCodenamesTurn() {
  socket.emit('endCodenamesTurn', { code: currentRoom });
}

function sendMafiaChat() {
  const input = document.getElementById('mafia-chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('mafiaChat', { code: currentRoom, message: msg });
  input.value = '';
}

function renderPlayersList(players, containerId, showKick) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerHTML = `
      <div class="player-avatar">${avatarEmojis[p.avatar] || '😎'}</div>
      <div class="player-name">${p.name}</div>
      ${p.isHost ? '<span class="player-host">👑 مضيف</span>' : ''}
      ${showKick && !p.isHost && isHost ? `<button class="btn btn-secondary" style="padding:0.3rem 0.6rem;font-size:0.75rem" onclick="socket.emit('kickPlayer',{code:currentRoom,targetId:'${p.id}'})">طرد</button>` : ''}
    `;
    container.appendChild(div);
  });
}

function updateLobby(room) {
  if (!room) return;
  currentRoom = room.code;
  isHost = room.host === mySocketId;

  document.getElementById('lobby-code').textContent = room.code;
  const teamA = room.players.filter(p => p.team === 'a');
  const teamB = room.players.filter(p => p.team === 'b');
  renderPlayersList(teamA, 'team-a-list', true);
  renderPlayersList(teamB, 'team-b-list', true);

  document.getElementById('btn-start-game').style.display = isHost ? 'inline-flex' : 'none';
}

function updateMafiaLobby(room) {
  if (!room) return;
  currentRoom = room.code;
  isHost = room.host === mySocketId;
  document.getElementById('mafia-code').textContent = room.code;
  renderPlayersList(room.players, 'mafia-players-list', true);
}

function updateCodenamesLobby(room) {
  if (!room) return;
  currentRoom = room.code;
  document.getElementById('cn-lobby-code').textContent = room.code;
  const teamA = room.players.filter(p => p.team === 'a');
  const teamB = room.players.filter(p => p.team === 'b');
  renderPlayersList(teamA, 'cn-team-a-list', false);
  renderPlayersList(teamB, 'cn-team-b-list', false);
}

function renderMafiaPlayerCards(players, alive, containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    const isDead = !alive.includes(p.id);
    div.className = 'mafia-player-card' + (isDead ? ' dead' : '');
    div.innerHTML = `<div class="player-avatar" style="font-size:2rem;margin-bottom:0.5rem">${avatarEmojis[p.avatar] || '😎'}</div><div style="font-weight:600">${p.name}</div>`;
    if (!isDead) div.onclick = () => onSelect(p.id);
    container.appendChild(div);
  });
}

function renderCodenamesBoard(state, isSpymaster) {
  const board = document.getElementById('codenames-board');
  board.innerHTML = '';
  state.words.forEach((word, i) => {
    const card = document.createElement('div');
    card.className = 'codenames-card';
    if (state.revealed[i]) {
      card.classList.add('revealed');
      card.classList.add('type-' + state.cardTypes[i]);
    }
    card.textContent = word;
    if (!state.revealed[i] && !isSpymaster && state.turnActive) {
      card.onclick = () => guessCodenamesWord(i);
    }
    board.appendChild(card);
  });
}

socket.on('roomCreated', (data) => {
  currentRoom = data.code;
  const mode = data.room.mode;
  if (mode === 'mafia') {
    showScreen('screen-mafia-lobby');
    updateMafiaLobby(data.room);
  } else if (mode === 'codenames') {
    showScreen('screen-codenames-lobby');
    updateCodenamesLobby(data.room);
  } else {
    showScreen('screen-lobby');
    updateLobby(data.room);
  }
});

socket.on('roomUpdated', (room) => {
  if (!room) return;
  const mode = room.mode;
  if (mode === 'team') {
    showScreen('screen-lobby');
    updateLobby(room);
  } else if (mode === 'mafia') {
    showScreen('screen-mafia-lobby');
    updateMafiaLobby(room);
  } else if (mode === 'codenames') {
    showScreen('screen-codenames-lobby');
    updateCodenamesLobby(room);
  }
});

socket.on('error', (msg) => { alert(msg); });

socket.on('kicked', () => {
  alert('تم طردك من الغرفة');
  goHome();
});

socket.on('gameStarted', (data) => {
  showScreen('screen-game');
  document.getElementById('trap-answer-input').disabled = false;
});

socket.on('newQuestion', (data) => {
  showScreen('screen-game');
  document.getElementById('q-category').textContent = data.category;
  document.getElementById('q-counter').textContent = (data.index + 1) + '/' + data.total;
  document.getElementById('q-text').textContent = data.question;
  document.getElementById('trap-answer-input').value = '';
  document.getElementById('trap-answer-input').disabled = false;
  startTimer(30, 'timer-fill');
});

socket.on('showOptions', (data) => {
  showScreen('screen-game-options');
  document.getElementById('opt-category').textContent = document.getElementById('q-category').textContent;
  document.getElementById('opt-counter').textContent = document.getElementById('q-counter').textContent;
  document.getElementById('opt-text').textContent = document.getElementById('q-text').textContent;

  const grid = document.getElementById('options-grid');
  grid.innerHTML = '';
  data.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt;
    btn.onclick = () => submitOption(i);
    grid.appendChild(btn);
  });
  startTimer(20, 'opt-timer-fill');
});

socket.on('optionChosen', (data) => {
  const msg = document.getElementById('waiting-msg');
  if (msg) { msg.style.display = 'block'; msg.textContent = 'بانتظار اللاعبين... (' + data.count + ')'; }
});

socket.on('questionResults', (data) => {
  showScreen('screen-question-results');
  clearTimer();
  document.getElementById('correct-answer-display').textContent = 'الإجابة الصحيحة: ' + data.correctAnswer;

  let html = '<table class="results-table"><thead><tr><th>اللاعب</th><th>إجابة الفخ</th><th>الخيار</th><th>النتيجة</th><th>النقاط</th></tr></thead><tbody>';
  data.results.forEach(r => {
    const status = r.isCorrect ? '✅' : (r.trapSuccess ? '⚡' : '❌');
    html += `<tr><td>${r.name}</td><td>${r.trapAnswer}</td><td>${status}</td><td>${r.isCorrect ? '+3' : (r.trapSuccess ? '+1' : '0')}</td><td>${r.score}</td></tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('results-table-wrapper').innerHTML = html;
});

socket.on('drawRoundStart', (data) => {
  showScreen('screen-draw');
  setupCanvas();
});

socket.on('drawGuessResult', (data) => {
  const el = document.getElementById('draw-result');
  if (data.isCorrect) {
    el.innerHTML = '<span style="color:var(--accent-green-light);font-size:1.2rem;font-weight:700">🎉 أحسنت! الإجابة: ' + data.word + '</span>';
  } else {
    el.innerHTML = '<span style="color:var(--accent-red-light)">❌ خطأ، حاول مرة أخرى</span>';
  }
});

socket.on('drawRoundResults', (data) => {
  alert('فريق أ: ' + data.teamAWord + ' | فريق ب: ' + data.teamBWord);
});

socket.on('codenamesStarted', (data) => {
  codenamesState = data.state;
  showScreen('screen-codenames');
  renderCodenamesBoard(codenamesState, false);
});

socket.on('codenamesTeamPicked', (room) => {
  if (room) updateCodenamesLobby(room);
});

socket.on('clueSubmitted', (data) => {
  document.getElementById('cn-clue-display').style.display = 'block';
  document.getElementById('cn-clue-word').textContent = data.word;
  document.getElementById('cn-clue-count').textContent = '(' + data.count + ')';
});

socket.on('codenamesWordGuessed', (data) => {
  if (codenamesState) {
    codenamesState.revealed[data.index || 0] = true;
    renderCodenamesBoard(codenamesState, false);
  }
  if (data.gameOver) {
    setTimeout(() => {
      showScreen('screen-results');
      document.getElementById('winner-display').innerHTML = '<div class="winner-card"><h2>🏆 فاز فريق ' + (data.winner === 'a' ? 'الأحمر' : 'الأزرق') + '</h2></div>';
    }, 1000);
  }
});

socket.on('codenamesTurnEnded', (data) => {
  if (codenamesState) {
    codenamesState.currentTeam = data.currentTeam;
    codenamesState.turnActive = false;
    codenamesState.clue = null;
    document.getElementById('cn-turn-indicator').textContent = 'دور فريق ' + (data.currentTeam === 'a' ? 'الأحمر' : 'الأزرق');
    document.getElementById('cn-clue-display').style.display = 'none';
  }
});

socket.on('finalResults', (data) => {
  showScreen('screen-results');
  if (!data) return;
  const rankings = document.getElementById('rankings');
  rankings.innerHTML = '';
  data.players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'rank-item';
    div.innerHTML = `
      <div class="rank-number ${i < 3 ? 'rank-' + (i + 1) : ''}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</div>
      <div class="player-avatar">${avatarEmojis[p.avatar] || '😎'}</div>
      <div class="player-name" style="flex:1">${p.name}</div>
      <div style="font-weight:900;font-size:1.3rem;color:var(--accent-yellow)">${p.score}</div>
    `;
    rankings.appendChild(div);
  });
});

socket.on('mafiaGameStarted', () => {
  showScreen('screen-mafia-night');
});

socket.on('mafiaStateUpdate', (state) => {
  mafiaState = state;
  renderMafiaState();
});

socket.on('mafiaNightStart', (data) => {
  showScreen('screen-mafia-night');
  startTimer(data.duration, 'timer-fill');
});

socket.on('mafiaDayStart', (data) => {
  showScreen('screen-mafia-day');
  const deathsEl = document.getElementById('mafia-day-deaths');
  if (data.deaths && data.deaths.length > 0) {
    deathsEl.innerHTML = '<div style="color:var(--accent-red-light);font-size:1.1rem;font-weight:700">💀 قُتل: ' + data.deaths.join(', ') + '</div>';
  } else {
    deathsEl.innerHTML = '<div style="color:var(--accent-green-light)">لا ضحايا الليلة</div>';
  }
  startTimer(data.duration, 'timer-fill');
});

socket.on('mafiaVotingStart', (data) => {
  showScreen('screen-mafia-voting');
  startTimer(data.duration, 'timer-fill');
});

socket.on('mafiaDayResult', (data) => {
  if (data.ejected) {
    alert('تم طرد ' + data.ejectedName);
  } else {
    alert('لم يتم طرد أحد');
  }
});

socket.on('mafiaGameOver', (data) => {
  showScreen('screen-mafia-results');
  const winner = data.winner === 'mafia' ? 'المافيا 🔫' : 'المواطنون 👥';
  document.getElementById('mafia-results-title').textContent = '🏆 نهاية اللعبة';
  document.getElementById('mafia-results-winner').innerHTML = '<h2 style="color:var(--accent-yellow)">فاز: ' + winner + '</h2>';
  if (mafiaState) {
    let html = '<div class="card full-width"><h3 class="mb-1">الأدوار:</h3>';
    mafiaState.alivePlayers.forEach(p => {
      const role = mafiaState.role;
      html += `<div style="margin:0.3rem 0">${p.name}: ${role}</div>`;
    });
    html += '</div>';
    document.getElementById('mafia-results-roles').innerHTML = html;
  }
});

socket.on('mafiaChatMessage', (data) => {
  const container = document.getElementById('mafia-chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<span class="msg-name">${data.name}:</span><span class="msg-text">${data.message}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
});

socket.on('policeResult', (data) => {
  const result = data.isMafia ? '🔍 المافيا!' : '✅ مواطن';
  alert(data.targetName + ' هو: ' + result);
});

function renderMafiaState() {
  if (!mafiaState) return;

  const roleBadge = document.getElementById('mafia-role-badge');
  const roleNames = { mafia: '🔫 مافيا', doctor: '💊 طبيب', police: '🔍 شرطي', citizen: '👤مواطن' };
  roleBadge.textContent = roleNames[mafiaState.role] || 'مجهول';
  roleBadge.className = 'role-badge role-' + mafiaState.role;

  if (mafiaState.phase === 'night') {
    showScreen('screen-mafia-night');
    const title = document.getElementById('mafia-night-title');
    const subtitle = document.getElementById('mafia-night-subtitle');
    const actions = document.getElementById('mafia-night-actions');
    actions.innerHTML = '';

    if (mafiaState.role === 'mafia') {
      title.textContent = '🌙 المافيا - اختر ضحية';
      subtitle.textContent = 'اختر من تريد قتله';
      renderMafiaPlayerCards(
        mafiaState.alivePlayers.filter(p => !mafiaState.mafiaTeam.includes(p.id)),
        mafiaState.alive,
        'mafia-night-actions',
        (id) => { socket.emit('mafiaKill', { code: currentRoom, targetId: id }); }
      );
    } else if (mafiaState.role === 'doctor') {
      title.textContent = '💊 الطبيب - انقذ لاعباً';
      subtitle.textContent = 'اختر من تريد حمايته';
      renderMafiaPlayerCards(
        mafiaState.alivePlayers,
        mafiaState.alive,
        'mafia-night-actions',
        (id) => { socket.emit('doctorSave', { code: currentRoom, targetId: id }); }
      );
    } else if (mafiaState.role === 'police') {
      title.textContent = '🔍 الشرطي - تحقق من هوية';
      subtitle.textContent = 'اختر لاعباً للتحقق';
      renderMafiaPlayerCards(
        mafiaState.alivePlayers.filter(p => p.id !== mySocketId),
        mafiaState.alive,
        'mafia-night-actions',
        (id) => { socket.emit('policeCheck', { code: currentRoom, targetId: id }); }
      );
    } else {
      title.textContent = '🌙 الليل - حان وقت النوم';
      subtitle.textContent = 'انتظر...');
    }
  } else if (mafiaState.phase === 'day' || mafiaState.phase === 'voting') {
    showScreen('screen-mafia-day');
    renderMafiaPlayerCards(
      mafiaState.alivePlayers,
      mafiaState.alive,
      'mafia-day-players',
      (id) => { socket.emit('mafiaNominate', { code: currentRoom, targetId: id }); }
    );
    renderMafiaPlayerCards(
      mafiaState.alivePlayers,
      mafiaState.alive,
      'mafia-vote-players',
      (id) => { socket.emit('mafiaVote', { code: currentRoom, targetId: id }); }
    );
  }
}

function setupCanvas() {
  const canvas = document.getElementById('draw-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let drawing = false;
  const colors = ['#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff'];

  const toolsDiv = document.getElementById('draw-tools');
  toolsDiv.innerHTML = '';
  colors.forEach(color => {
    const btn = document.createElement('button');
    btn.className = 'color-btn';
    btn.style.background = color;
    btn.onclick = () => { ctx.strokeStyle = color; };
    toolsDiv.appendChild(btn);
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-secondary';
  clearBtn.textContent = 'مسح';
  clearBtn.onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); };
  toolsDiv.appendChild(clearBtn);

  canvas.onmousedown = (e) => { drawing = true; ctx.beginPath(); ctx.moveTo(e.offsetX, e.offsetY); };
  canvas.onmousemove = (e) => { if (drawing) { ctx.lineTo(e.offsetX, e.offsetY); ctx.stroke(); } };
  canvas.onmouseup = () => { drawing = false; };
  canvas.onmouseleave = () => { drawing = false; };
}

init();
