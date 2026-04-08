const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// ——— Leaderboard persistence ———
const LB_FILE = path.join(__dirname, 'leaderboard.json');

function loadLeaderboard() {
  try {
    if (fs.existsSync(LB_FILE)) {
      return JSON.parse(fs.readFileSync(LB_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveLeaderboard(lb) {
  fs.writeFileSync(LB_FILE, JSON.stringify(lb, null, 2));
}

let leaderboard = loadLeaderboard();

function addToLeaderboard(entry) {
  // entry: { name, wpm, rawWpm, acc, errors, duration, mode, timestamp }
  leaderboard.push(entry);
  // Sort by WPM desc, keep top 100
  leaderboard.sort((a, b) => b.wpm - a.wpm);
  if (leaderboard.length > 100) leaderboard = leaderboard.slice(0, 100);
  saveLeaderboard(leaderboard);
  return leaderboard.findIndex(e => e === entry) + 1; // rank
}

// ——— REST endpoints ———
app.get('/leaderboard', (req, res) => {
  res.json(leaderboard.slice(0, 50));
});

app.post('/leaderboard', (req, res) => {
  const { name, wpm, rawWpm, acc, errors, duration, mode } = req.body;
  if (!name || !wpm || wpm < 1 || wpm > 300) return res.status(400).json({ error: 'Invalid entry' });
  const entry = {
    name: String(name).slice(0, 20).replace(/[<>]/g, ''),
    wpm: Math.round(wpm),
    rawWpm: Math.round(rawWpm || wpm),
    acc: Math.round(acc || 100),
    errors: Math.round(errors || 0),
    duration: duration || 60,
    mode: mode || 'words',
    timestamp: Date.now()
  };
  const rank = addToLeaderboard(entry);
  res.json({ rank, leaderboard: leaderboard.slice(0, 50) });
});

// ——— Lobby system ———
const lobbies = {}; // code -> lobby object

const WORD_BANK = `the be to of and a in that have it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us`.split(' ');

const QUOTES = [
  "The only way to do great work is to love what you do. If you haven't found it yet, keep looking. Don't settle.",
  "In the middle of every difficulty lies opportunity. The mind that opens to a new idea never returns to its original size.",
  "Success is not final, failure is not fatal; it is the courage to continue that counts. Our greatest glory is not in never falling, but in rising every time we fall.",
  "The future belongs to those who believe in the beauty of their dreams. Do not wait to strike till the iron is hot, but make it hot by striking.",
];

function generateRaceText(mode) {
  if (mode === 'quote') {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
  }
  const count = 60;
  const words = [];
  for (let i = 0; i < count; i++) {
    words.push(WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)]);
  }
  return words.join(' ');
}

function makeLobbyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getLobbyState(lobby) {
  return {
    code: lobby.code,
    host: lobby.host,
    status: lobby.status,
    mode: lobby.mode,
    duration: lobby.duration,
    players: Object.values(lobby.players).map(p => ({
      id: p.id,
      name: p.name,
      progress: p.progress,
      wpm: p.wpm,
      finished: p.finished,
      finishTime: p.finishTime,
      rank: p.rank
    })),
    text: lobby.status === 'racing' ? lobby.text : null,
    countdown: lobby.countdown,
    startedAt: lobby.startedAt
  };
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  // Create lobby
  socket.on('create_lobby', ({ name, mode, duration }) => {
    let code;
    do { code = makeLobbyCode(); } while (lobbies[code]);

    const lobby = {
      code,
      host: socket.id,
      status: 'waiting', // waiting | countdown | racing | finished
      mode: mode || 'words',
      duration: [15,30,60].includes(duration) ? duration : 30,
      text: '',
      players: {},
      countdown: null,
      startedAt: null,
      countdownTimer: null,
      raceEndTimer: null,
      finishCount: 0
    };

    lobby.players[socket.id] = {
      id: socket.id,
      name: String(name || 'Anonymous').slice(0, 20),
      progress: 0,
      wpm: 0,
      finished: false,
      finishTime: null,
      rank: null
    };

    lobbies[code] = lobby;
    socket.join(code);
    socket.emit('lobby_joined', { code, playerId: socket.id });
    io.to(code).emit('lobby_update', getLobbyState(lobby));
  });

  // Join lobby
  socket.on('join_lobby', ({ code, name }) => {
    const lobby = lobbies[code?.toUpperCase()];
    if (!lobby) { socket.emit('lobby_error', 'Room not found'); return; }
    if (lobby.status !== 'waiting') { socket.emit('lobby_error', 'Race already in progress'); return; }
    if (Object.keys(lobby.players).length >= 8) { socket.emit('lobby_error', 'Room is full (8 players max)'); return; }

    lobby.players[socket.id] = {
      id: socket.id,
      name: String(name || 'Anonymous').slice(0, 20),
      progress: 0,
      wpm: 0,
      finished: false,
      finishTime: null,
      rank: null
    };

    socket.join(code.toUpperCase());
    socket.emit('lobby_joined', { code: code.toUpperCase(), playerId: socket.id });
    io.to(code.toUpperCase()).emit('lobby_update', getLobbyState(lobby));
  });

  // Start race (host only)
  socket.on('start_race', ({ code }) => {
    const lobby = lobbies[code];
    if (!lobby || lobby.host !== socket.id) return;
    if (lobby.status !== 'waiting') return;

    lobby.text = generateRaceText(lobby.mode);
    lobby.status = 'countdown';
    lobby.countdown = 3;
    lobby.finishCount = 0;

    // Reset players
    Object.values(lobby.players).forEach(p => {
      p.progress = 0; p.wpm = 0; p.finished = false; p.finishTime = null; p.rank = null;
    });

    io.to(code).emit('lobby_update', getLobbyState(lobby));
    io.to(code).emit('race_text', { text: lobby.text });

    let count = 3;
    const cd = setInterval(() => {
      count--;
      lobby.countdown = count;
      io.to(code).emit('countdown', count);
      if (count <= 0) {
        clearInterval(cd);
        lobby.status = 'racing';
        lobby.startedAt = Date.now();
        io.to(code).emit('race_start', { startedAt: lobby.startedAt, duration: lobby.duration });
        io.to(code).emit('lobby_update', getLobbyState(lobby));
        // Auto-end race when time runs out
        lobby.raceEndTimer = setTimeout(() => {
          if (lobby.status !== 'racing') return;
          lobby.status = 'finished';
          // Mark any unfinished players as DNF
          Object.values(lobby.players).forEach(p => {
            if (!p.finished) { p.finished = true; p.rank = null; p.wpm = p.wpm || 0; }
          });
          io.to(code).emit('race_over', { players: getLobbyState(lobby).players });
        }, lobby.duration * 1000 + 500);
      }
    }, 1000);
    lobby.countdownTimer = cd;
  });

  // Progress update
  socket.on('progress_update', ({ code, progress, wpm }) => {
    const lobby = lobbies[code];
    if (!lobby || !lobby.players[socket.id]) return;
    lobby.players[socket.id].progress = Math.min(100, progress);
    lobby.players[socket.id].wpm = wpm || 0;
    io.to(code).emit('player_progress', {
      playerId: socket.id,
      progress: lobby.players[socket.id].progress,
      wpm: lobby.players[socket.id].wpm
    });
  });

  // Player finished
  socket.on('race_finished', ({ code, wpm, rawWpm, acc, errors }) => {
    const lobby = lobbies[code];
    if (!lobby || !lobby.players[socket.id]) return;
    const player = lobby.players[socket.id];
    if (player.finished) return;

    lobby.finishCount++;
    player.finished = true;
    player.progress = 100;
    player.wpm = wpm;
    player.finishTime = Date.now() - lobby.startedAt;
    player.rank = lobby.finishCount;

    io.to(code).emit('player_finished', {
      playerId: socket.id,
      name: player.name,
      rank: player.rank,
      wpm,
      finishTime: player.finishTime
    });

    // If all players finished
    const allDone = Object.values(lobby.players).every(p => p.finished);
    if (allDone) {
      lobby.status = 'finished';
      io.to(code).emit('race_over', { players: getLobbyState(lobby).players });
    }
  });

  // Return to lobby
  socket.on('return_to_lobby', ({ code }) => {
    const lobby = lobbies[code];
    if (!lobby || lobby.host !== socket.id) return;
    if (lobby.raceEndTimer) clearTimeout(lobby.raceEndTimer);
    lobby.status = 'waiting';
    lobby.countdown = null;
    Object.values(lobby.players).forEach(p => {
      p.progress = 0; p.wpm = 0; p.finished = false; p.finishTime = null; p.rank = null;
    });
    io.to(code).emit('lobby_update', getLobbyState(lobby));
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id);
    for (const code in lobbies) {
      const lobby = lobbies[code];
      if (lobby.players[socket.id]) {
        delete lobby.players[socket.id];
        if (Object.keys(lobby.players).length === 0) {
          if (lobby.countdownTimer) clearInterval(lobby.countdownTimer);
          delete lobbies[code];
        } else {
          // Transfer host if needed
          if (lobby.host === socket.id) {
            lobby.host = Object.keys(lobby.players)[0];
          }
          io.to(code).emit('lobby_update', getLobbyState(lobby));
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`1800-typer server running on port ${PORT}`));
