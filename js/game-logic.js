const fs = require('fs');
const path = require('path');

const questions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'قاعدة_الأسئلة.json'), 'utf8'));

const rooms = {};

function generateRoomCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 8).toUpperCase(); } while (rooms[code]);
  return code;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function createRoom(code, socketId, name, avatar, mode) {
  return {
    code, mode, createdAt: Date.now(),
    host: socketId,
    players: [{ id: socketId, name, avatar, socketId, team: mode === 'team' ? 'a' : null, score: 0, isHost: true }],
    game: null,
    mafiaConfig: { hasDoctor: true, hasPolice: true }
  };
}

function joinRoom(code, socketId, name, avatar) {
  const room = rooms[code];
  if (!room) return { error: 'الغرفة غير موجودة' };
  if (room.players.length >= (room.mode === 'solo' ? 8 : room.mode === 'team' ? 12 : room.mode === 'mafia' ? 12 : 8))
    return { error: 'الغرفة ممتلئة' };
  if (room.game) return { error: 'اللعبة بدأت بالفعل' };
  const team = room.mode === 'team' ? (room.players.filter(p => p.team === 'a').length <= room.players.filter(p => p.team === 'b').length ? 'a' : 'b') : null;
  const player = { id: socketId, name, avatar, socketId, team, score: 0, isHost: false };
  room.players.push(player);
  return { success: true };
}

function switchTeam(code, socketId, team) {
  const room = rooms[code];
  if (!room) return { error: 'الغرفة غير موجودة' };
  const player = room.players.find(p => p.id === socketId);
  if (!player) return { error: 'لاعب غير موجود' };
  if (room.mode !== 'team') return { error: 'لا يمكن تبديل الفريق' };
  player.team = team;
  return { success: true };
}

function kickPlayer(code, socketId, targetId) {
  const room = rooms[code];
  if (!room) return { error: 'الغرفة غير موجودة' };
  if (room.host !== socketId) return { error: 'غير مصرح' };
  const idx = room.players.findIndex(p => p.id === targetId);
  if (idx === -1) return { error: 'لاعب غير موجود' };
  const kicked = room.players.splice(idx, 1)[0];
  return { success: true, kickedSocket: kicked.socketId };
}

function setLeader(code, socketId, targetId) {
  const room = rooms[code];
  if (!room) return { error: 'الغرفة غير موجودة' };
  if (room.host !== socketId) return { error: 'غير مصرح' };
  const target = room.players.find(p => p.id === targetId);
  if (!target) return { error: 'لاعب غير موجود' };
  room.host = targetId;
  room.players.forEach(p => p.isHost = p.id === targetId);
  return { success: true };
}

function getRoomPublic(code) {
  const room = rooms[code];
  if (!room) return null;
  return {
    code: room.code, mode: room.mode, host: room.host,
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, team: p.team, score: p.score, isHost: p.isHost })),
    game: room.game ? { started: true, currentRound: room.game.currentRound } : null,
    mafiaConfig: room.mafiaConfig
  };
}

function startGame(code, socketId) {
  const room = rooms[code];
  if (!room) return { error: 'الغرفة غير موجودة' };
  if (room.host !== socketId) return { error: 'غير مصرح' };
  if (room.mode === 'mafia' || room.mode === 'codenames') return { error: 'وضع مختلف' };

  const allQ = [];
  Object.entries(questions).forEach(([cat, qs]) => {
    shuffleArray(qs).forEach(q => allQ.push({ ...q, category: cat }));
  });
  const selected = shuffleArray(allQ).slice(0, 15);

  room.game = {
    questions: selected,
    currentQuestionIndex: 0,
    currentCategory: selected[0].category,
    trapAnswers: {},
    optionAnswers: {},
    scores: {},
    currentRound: 1,
    drawState: null,
    codenamesState: null,
    phase: 'trap'
  };

  room.players.forEach(p => {
    room.game.scores[p.id] = 0;
  });

  return { success: true, category: selected[0].category, question: selected[0].s };
}

function submitTrapAnswer(code, socketId, answer) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  room.game.trapAnswers[socketId] = answer;
  const count = Object.keys(room.game.trapAnswers).length;
  const allAnswered = count >= room.players.length;
  return { success: true, count, allAnswered };
}

function buildOptions(code) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  const q = room.game.questions[room.game.currentQuestionIndex];
  const correctIndex = q.الجواب;
  const correctAnswer = q.خيارات[correctIndex];

  const trapPool = Object.values(room.game.trapAnswers).filter(a => a !== correctAnswer);
  const uniqueTraps = [...new Set(trapPool)].slice(0, 3);

  while (uniqueTraps.length < 3) {
    const rnd = q.خيارات[Math.floor(Math.random() * q.خيارات.length)];
    if (rnd !== correctAnswer && !uniqueTraps.includes(rnd)) uniqueTraps.push(rnd);
  }

  const options = shuffleArray([correctAnswer, ...uniqueTraps]);
  room.game.options = options;
  room.game.correctOption = options.indexOf(correctAnswer);
  room.game.optionAnswers = {};
  room.game.phase = 'options';
  room.game.trapSuccess = {};

  Object.entries(room.game.trapAnswers).forEach(([pid, trap]) => {
    if (trap === correctAnswer) {
      room.game.trapSuccess[pid] = false;
    } else if (options.includes(trap)) {
      room.game.trapSuccess[pid] = true;
      room.game.scores[pid] = (room.game.scores[pid] || 0) + 1;
    }
  });

  return { options, trapSuccess: room.game.trapSuccess };
}

function submitOption(code, socketId, optionIndex) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  room.game.optionAnswers[socketId] = optionIndex;
  const count = Object.keys(room.game.optionAnswers).length;
  const allChosen = count >= room.players.length;
  return { success: true, count, allChosen };
}

function calculateQuestionResults(code) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  const game = room.game;
  const correct = game.correctOption;

  Object.entries(game.optionAnswers).forEach(([pid, idx]) => {
    if (idx === correct) {
      game.scores[pid] = (game.scores[pid] || 0) + 3;
    }
  });

  const q = game.questions[game.currentQuestionIndex];
  const results = room.players.map(p => ({
    id: p.id, name: p.name,
    trapAnswer: game.trapAnswers[p.id] || '',
    optionIndex: game.optionAnswers[p.id],
    isCorrect: game.optionAnswers[p.id] === correct,
    trapSuccess: game.trapSuccess[p.id] || false,
    score: game.scores[p.id] || 0
  }));

  return {
    correctAnswer: q.خيارات[correct],
    correctIndex: correct,
    results,
    scores: game.scores
  };
}

function resetForNextQuestion(code) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  const game = room.game;
  game.currentQuestionIndex++;
  if (game.currentQuestionIndex >= game.questions.length) {
    return { finished: true };
  }
  game.trapAnswers = {};
  game.optionAnswers = {};
  game.phase = 'trap';
  game.currentCategory = game.questions[game.currentQuestionIndex].category;
  return { finished: false, category: game.currentCategory };
}

function startDrawRound(code) {
  const room = rooms[code];
  if (!room) return;
  const words = ['قطة', 'كلب', 'شمس', 'قمر', 'سيارة', 'طائرة', 'بحر', 'جبل', 'بيت', 'مدرسة', 'مستشفى', 'حديقة'];
  const teamA = room.players.filter(p => p.team === 'a');
  const teamB = room.players.filter(p => p.team === 'b');
  room.game.drawState = {
    teamAWord: words[Math.floor(Math.random() * words.length)],
    teamBWord: words[Math.floor(Math.random() * words.length)],
    teamADrawer: teamA[0]?.socketId,
    teamBDrawer: teamB[0]?.socketId,
    guesses: {},
    revealed: { a: false, b: false }
  };
}

function getDrawState(code) {
  const room = rooms[code];
  if (!room || !room.game) return null;
  return room.game.drawState;
}

function submitDrawGuess(code, socketId, guess) {
  const room = rooms[code];
  if (!room || !room.game || !room.game.drawState) return { error: 'لا توجد جولة رسم' };
  const state = room.game.drawState;
  const player = room.players.find(p => p.socketId === socketId);
  if (!player) return { error: 'لاعب غير موجود' };
  const team = player.team;
  const word = team === 'a' ? state.teamAWord : state.teamBWord;
  const isCorrect = guess === word;
  if (isCorrect) {
    state.revealed[team] = true;
    room.game.scores[socketId] = (room.game.scores[socketId] || 0) + 3;
  }
  return { isCorrect, word: isCorrect ? word : null, team };
}

function endDrawRound(code) {
  const room = rooms[code];
  if (!room || !room.game) return {};
  const state = room.game.drawState;
  return { teamAWord: state.teamAWord, teamBWord: state.teamBWord, revealed: state.revealed };
}

function transitionToRound3(code) {
  const room = rooms[code];
  if (!room || !room.game) return;
  room.game.currentRound = 3;
  const catKeys = Object.keys(questions);
  room.game.currentCategory = catKeys[Math.floor(Math.random() * catKeys.length)];
  const qs = shuffleArray(questions[room.game.currentCategory]).slice(0, 5);
  room.game.questions = qs.map(q => ({ ...q, category: room.game.currentCategory }));
  room.game.currentQuestionIndex = 0;
  room.game.trapAnswers = {};
  room.game.optionAnswers = {};
  room.game.phase = 'trap';
}

function startCodenamesRound(code) {
  const room = rooms[code];
  if (!room) return;
  const codenamesWords = ['بيت', 'سماء', 'نار', 'ماء', 'شمس', 'قمر', 'نجم', 'بحر', 'جبل', 'غابة', 'حجر', 'سحاب', 'ريح', 'مطر', 'ثلج', 'قبر', 'مفتاح', 'كتاب', 'قلم', 'هاتف', 'سيارة', 'طائرة', 'سفينة', 'حصان', 'أسد'];
  const shuffled = shuffleArray(codenamesWords).slice(0, 25);
  const types = [];
  for (let i = 0; i < 9; i++) types.push('a');
  for (let i = 0; i < 8; i++) types.push('b');
  types.push('neutral');
  types.push('assassin');
  const shuffledTypes = shuffleArray(types);

  room.game.codenamesState = {
    words: shuffled,
    cardTypes: shuffledTypes,
    revealed: new Array(25).fill(false),
    currentTeam: 'a',
    clue: null,
    clueCount: 0,
    guessesLeft: 0,
    turnActive: false
  };
}

function getCodenamesRoundState(code) {
  const room = rooms[code];
  if (!room || !room.game) return null;
  return room.game.codenamesState;
}

function startCodenamesStandalone(code, socketId) {
  const room = rooms[code];
  if (!room) return { error: 'الغرفة غير موجودة' };
  startCodenamesRound(code);
  return { success: true, state: room.game.codenamesState };
}

function pickCodenamesTeam(code, socketId, team) {
  const room = rooms[code];
  if (!room) return { error: 'الغرفة غير موجودة' };
  const player = room.players.find(p => p.socketId === socketId);
  if (!player) return { error: 'لاعب غير موجود' };
  player.team = team;
  return { success: true };
}

function submitClue(code, socketId, word, count) {
  const room = rooms[code];
  if (!room || !room.game || !room.game.codenamesState) return { error: 'لا توجد لعبة كود نيمز' };
  const state = room.game.codenamesState;
  state.clue = word;
  state.clueCount = count;
  state.guessesLeft = count + 1;
  state.turnActive = true;
  return { success: true };
}

function guessCodenamesWord(code, socketId, index) {
  const room = rooms[code];
  if (!room || !room.game || !room.game.codenamesState) return { error: 'لا توجد لعبة كود نيمز' };
  const state = room.game.codenamesState;
  if (!state.turnActive) return { error: 'الدور غير نشط' };
  if (state.revealed[index]) return { error: 'البطاقة مكشوفة بالفعل' };

  state.revealed[index] = true;
  const type = state.cardTypes[index];

  if (type === 'assassin') {
    return { success: true, type: 'assassin', gameOver: true, winner: state.currentTeam === 'a' ? 'b' : 'a' };
  }

  if (type === state.currentTeam) {
    state.guessesLeft--;
    const remaining = state.cardTypes.filter((t, i) => t === state.currentTeam && !state.revealed[i]).length;
    if (remaining === 0) {
      return { success: true, type, gameOver: true, winner: state.currentTeam };
    }
    if (state.guessesLeft <= 0) {
      state.turnActive = false;
      state.currentTeam = state.currentTeam === 'a' ? 'b' : 'a';
    }
    return { success: true, type, gameOver: false, continueTurn: true };
  }

  state.turnActive = false;
  state.currentTeam = state.currentTeam === 'a' ? 'b' : 'a';
  return { success: true, type, gameOver: false };
}

function endCodenamesTurn(code) {
  const room = rooms[code];
  if (!room || !room.game || !room.game.codenamesState) return { error: 'لا توجد لعبة كود نيمز' };
  const state = room.game.codenamesState;
  state.turnActive = false;
  state.clue = null;
  state.currentTeam = state.currentTeam === 'a' ? 'b' : 'a';
  return { success: true, currentTeam: state.currentTeam };
}

function startMafiaGame(code, socketId) {
  const room = rooms[code];
  if (!room) return { error: 'الغرفة غير موجودة' };
  if (room.host !== socketId) return { error: 'غير مصرح' };
  if (room.players.length < 4) return { error: '4 لاعبين على الأقل' };

  const n = room.players.length;
  const mafiaCount = Math.floor(n / 4);
  const shuffledPlayers = shuffleArray(room.players);
  const roles = {};

  for (let i = 0; i < mafiaCount; i++) roles[shuffledPlayers[i].id] = 'mafia';
  if (n >= 4) roles[shuffledPlayers[mafiaCount].id] = 'doctor';
  if (n >= 5) roles[shuffledPlayers[mafiaCount + 1].id] = 'police';
  for (let i = 0; i < n; i++) {
    if (!roles[shuffledPlayers[i].id]) roles[shuffledPlayers[i].id] = 'citizen';
  }

  room.game = {
    roles,
    phase: 'night',
    nightActions: { kill: null, save: null, check: null },
    nightVotes: {},
    dayVotes: {},
    alive: room.players.map(p => p.id),
    nightDeaths: [],
    dayDeaths: [],
    mafiaTeam: shuffledPlayers.filter(p => roles[p.id] === 'mafia').map(p => p.id),
    doctorId: null,
    policeId: null,
    chatMessages: [],
    round: 1
  };

  room.players.forEach(p => {
    if (roles[p.id] === 'doctor') room.game.doctorId = p.id;
    if (roles[p.id] === 'police') room.game.policeId = p.id;
  });

  return { success: true };
}

function updateMafiaConfig(code, config) {
  const room = rooms[code];
  if (!room) return;
  Object.assign(room.mafiaConfig, config);
}

function getMafiaGameState(code, socketId) {
  const room = rooms[code];
  if (!room || !room.game) return null;
  const game = room.game;
  const role = game.roles[socketId];
  const isAlive = game.alive.includes(socketId);

  return {
    role,
    isAlive,
    phase: game.phase,
    alive: game.alive,
    mafiaTeam: role === 'mafia' ? game.mafiaTeam : undefined,
    doctorId: role === 'doctor' ? game.doctorId : undefined,
    policeId: role === 'police' ? game.policeId : undefined,
    nightDeaths: game.nightDeaths,
    dayDeaths: game.dayDeaths,
    round: game.round,
    alivePlayers: room.players.filter(p => game.alive.includes(p.id)).map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
    nightActions: game.phase === 'night' ? game.nightActions : undefined,
    chatMessages: game.chatMessages,
    dayVotes: game.phase === 'voting' ? game.dayVotes : undefined,
    nightVotes: game.phase === 'night' ? game.nightVotes : undefined
  };
}

function startMafiaNight(code) {
  const room = rooms[code];
  if (!room || !room.game) return;
  room.game.phase = 'night';
  room.game.nightActions = { kill: null, save: null, check: null };
  room.game.nightVotes = {};
  room.game.nightDeaths = [];
}

function mafiaKill(code, socketId, targetId) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  if (room.game.roles[socketId] !== 'mafia') return { error: 'غير مصرح' };
  if (!room.game.alive.includes(targetId)) return { error: 'اللاعب غير موجود' };
  room.game.nightVotes[socketId] = targetId;
  const mafiaAlive = room.game.mafiaTeam.filter(id => room.game.alive.includes(id));
  const allVoted = mafiaAlive.every(id => room.game.nightVotes[id]);
  if (allVoted) {
    const votes = {};
    Object.values(room.game.nightVotes).forEach(tid => { votes[tid] = (votes[tid] || 0) + 1; });
    const maxVotes = Math.max(...Object.values(votes));
    const candidates = Object.entries(votes).filter(([_, v]) => v === maxVotes).map(([k]) => k);
    room.game.nightActions.kill = candidates[Math.floor(Math.random() * candidates.length)];
  }
  return { success: true, voted: allVoted };
}

function doctorSave(code, socketId, targetId) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  if (room.game.roles[socketId] !== 'doctor') return { error: 'غير مصرح' };
  if (!room.game.alive.includes(targetId)) return { error: 'اللاعب غير موجود' };
  room.game.nightActions.save = targetId;
  return { success: true };
}

function policeCheck(code, socketId, targetId) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  if (room.game.roles[socketId] !== 'police') return { error: 'غير مصرح' };
  if (!room.game.alive.includes(targetId)) return { error: 'اللاعب غير موجود' };
  const isMafia = room.game.roles[targetId] === 'mafia';
  room.game.nightActions.check = targetId;
  return { targetId, isMafia, targetName: room.players.find(p => p.id === targetId)?.name };
}

function isMafiaNightComplete(code) {
  const room = rooms[code];
  if (!room || !room.game) return false;
  const game = room.game;
  if (!game.nightActions.kill) return false;
  if (game.doctorId && game.alive.includes(game.doctorId) && !game.nightActions.save) return false;
  if (game.policeId && game.alive.includes(game.policeId) && !game.nightActions.check) return false;
  return true;
}

function resolveMafiaNight(code) {
  const room = rooms[code];
  if (!room || !room.game) return;
  const game = room.game;
  game.nightDeaths = [];
  if (game.nightActions.kill && game.nightActions.kill !== game.nightActions.save) {
    game.alive = game.alive.filter(id => id !== game.nightActions.kill);
    game.nightDeaths.push(game.nightActions.kill);
  }
}

function startMafiaDay(code) {
  const room = rooms[code];
  if (!room || !room.game) return;
  room.game.phase = 'day';
  room.game.dayVotes = {};
}

function startMafiaVoting(code) {
  const room = rooms[code];
  if (!room || !room.game) return;
  room.game.phase = 'voting';
  room.game.dayVotes = {};
}

function nominatePlayer(code, socketId, targetId) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  if (!room.game.alive.includes(socketId)) return { error: 'غير موجود' };
  if (!room.game.alive.includes(targetId)) return { error: 'الهدف غير موجود' };
  return { success: true, nominator: room.players.find(p => p.id === socketId)?.name, target: room.players.find(p => p.id === targetId)?.name };
}

function mafiaVoteDay(code, socketId, targetId) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  if (!room.game.alive.includes(socketId)) return { error: 'غير موجود' };
  room.game.dayVotes[socketId] = targetId;
  const aliveVoters = room.game.alive.length;
  const voted = Object.keys(room.game.dayVotes).length;
  return { success: true, voted, total: aliveVoters, allVoted: voted >= aliveVoters };
}

function isMafiaDayComplete(code) {
  const room = rooms[code];
  if (!room || !room.game) return false;
  return Object.keys(room.game.dayVotes).length >= room.game.alive.length;
}

function resolveDayPhase(code) {
  const room = rooms[code];
  if (!room || !room.game) return { ejected: null };
  const game = room.game;
  const votes = {};
  Object.values(game.dayVotes).forEach(tid => { votes[tid] = (votes[tid] || 0) + 1; });
  let ejected = null;
  if (Object.keys(votes).length > 0) {
    const maxVotes = Math.max(...Object.values(votes));
    const candidates = Object.entries(votes).filter(([_, v]) => v === maxVotes).map(([k]) => k);
    ejected = candidates[Math.floor(Math.random() * candidates.length)];
    game.alive = game.alive.filter(id => id !== ejected);
    game.dayDeaths.push(ejected);
  }
  game.phase = 'night';
  return { ejected, ejectedName: ejected ? room.players.find(p => p.id === ejected)?.name : null, votes };
}

function checkMafiaWin(code) {
  const room = rooms[code];
  if (!room || !room.game) return null;
  const game = room.game;
  const mafiaAlive = game.mafiaTeam.filter(id => game.alive.includes(id)).length;
  const citizensAlive = game.alive.length - mafiaAlive;
  if (mafiaAlive >= citizensAlive) return 'mafia';
  if (mafiaAlive === 0) return 'citizens';
  return null;
}

function addMafiaChatMessage(code, socketId, message) {
  const room = rooms[code];
  if (!room || !room.game) return { error: 'لا توجد لعبة' };
  const player = room.players.find(p => p.id === socketId);
  if (!player) return { error: 'لاعب غير موجود' };
  const msg = { name: player.name, avatar: player.avatar, message, time: Date.now() };
  room.game.chatMessages.push(msg);
  return msg;
}

function calculateFinalResults(code) {
  const room = rooms[code];
  if (!room || !room.game) return null;
  return {
    scores: room.game.scores,
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: room.game.scores[p.id] || 0 }))
      .sort((a, b) => b.score - a.score)
  };
}

function disconnectPlayer(code, socketId) {
  const room = rooms[code];
  if (!room) return { roomDeleted: true };
  const idx = room.players.findIndex(p => p.socketId === socketId);
  if (idx === -1) return { roomDeleted: false };
  room.players.splice(idx, 1);
  if (room.players.length === 0) return { roomDeleted: true };
  if (room.host === socketId) {
    room.host = room.players[0].id;
    room.players[0].isHost = true;
  }
  return { roomDeleted: false };
}

module.exports = {
  rooms, generateRoomCode, createRoom, joinRoom, switchTeam, kickPlayer, setLeader,
  getRoomPublic, startGame, submitTrapAnswer, buildOptions, submitOption,
  calculateQuestionResults, resetForNextQuestion, startDrawRound, getDrawState,
  submitDrawGuess, endDrawRound, transitionToRound3, startCodenamesRound,
  getCodenamesRoundState, startCodenamesStandalone, pickCodenamesTeam, submitClue,
  guessCodenamesWord, endCodenamesTurn, startMafiaGame, updateMafiaConfig,
  getMafiaGameState, startMafiaNight, mafiaKill, doctorSave, policeCheck,
  isMafiaNightComplete, resolveMafiaNight, startMafiaDay, startMafiaVoting,
  nominatePlayer, mafiaVoteDay, isMafiaDayComplete, resolveDayPhase,
  checkMafiaWin, addMafiaChatMessage, calculateFinalResults, disconnectPlayer
};
