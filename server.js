const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Middleware
app.use(cors());

// Firebase Admin Setup
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://araa--music-default-rtdb.asia-southeast1.firebasedatabase.app",
});
const db = admin.database();

// 🔁 Serve static frontend + audio
const BUILD_DIR = path.join(__dirname, 'dist');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
app.use(express.static(BUILD_DIR));
app.use('/audio', express.static(DOWNLOAD_DIR));

// 🔄 Clear old downloads on startup
function clearDownloadsFolder() {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
  fs.readdirSync(DOWNLOAD_DIR).forEach((file) => {
    const fullPath = path.join(DOWNLOAD_DIR, file);
    fs.rmSync(fullPath, { recursive: true, force: true });
  });
  console.log('[INFO] Cleared downloads folder');
}
clearDownloadsFolder();


async function fetchDatas() {
  try {
    const [songsSnap, moviesSnap] = await Promise.all([
      db.ref('songs').once('value'),
      db.ref('music_data').once('value'),
    ]);

    if (songsSnap.exists()) {
      songsList = songsSnap.val();
      console.log('[INFO] Preloaded songs data');
    } else {
      console.warn('[WARNING] No songs data found in Firebase');
    }

    if (moviesSnap.exists()) {
      moviesList = moviesSnap.val();
      console.log('[INFO] Preloaded movies data');
    } else {
      console.warn('[WARNING] No movies data found in Firebase');
    }
  } catch (error) {
    console.error('[ERROR] Failed to preload data:', error.message);
  }
}
fetchDatas();

// 📥 GET /songs – from cached memory
app.get('/songs', (req, res) => {
  try {

    if (!songsList || Object.keys(songsList).length === 0) {
      return res.status(404).json({ message: 'No cached song data available' });
    }
    res.json({ songsList });
  } catch (error) {
    console.error('[ERROR] Failed to fetch songs:', error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 📥 GET /movies – from cached memory
app.get('/movies', (req, res) => {
  try {
    if (!moviesList || Object.keys(moviesList).length === 0) {
      return res.status(404).json({ message: 'No cached movie data available' });
    }
    res.json(moviesList);
  } catch (error) {
    console.error('[ERROR] Failed to fetch movies:', error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ⬇️ Active downloads tracker
const activeFetches = new Map();
function logActiveFetches() {
  const table = [...activeFetches].map(([userId, videoId]) => ({ userId, videoId }));
  console.clear();
  console.table(table.length ? table : [{ userId: '-', videoId: '-' }]);
}

// ✅ GET /download – Download YouTube audio
app.get('/download', async (req, res) => {
  const { url: videoId, user_id: userId } = req.query;

  if (!videoId || !userId) {
    return res.status(400).json({ success: false, message: 'Missing video ID or user ID' });
  }
  updateSongData(videoId);
  activeFetches.set(userId, videoId);
  logActiveFetches();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const userDir = path.join(DOWNLOAD_DIR, userId);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

  const targetFile = path.join(userDir, `${videoId}.webm`);
  const fileUrl = `/audio/${userId}/${videoId}.webm`;
  const outputTemplate = path.join(userDir, `${videoId}.%(ext)s`);

  // Return early if already downloaded
  if (fs.existsSync(targetFile)) {
    await saveAudioMetadata(userId, videoId, `${videoId}.webm`);
    activeFetches.delete(userId);
    logActiveFetches();
    return res.json({ success: true, file: fileUrl });
  }

  // Start download
  //const cmd = `yt-dlp -f bestaudio[ext=webm] -o "${outputTemplate}" --cookies "./cookiesyt.txt" "${videoUrl}"`;
  const cmd = `yt-dlp -f 'bestvideo[height<=360]+bestaudio' -o "${outputTemplate}" --cookies "./cookiesyt.txt" "${videoUrl}"`
  exec(cmd, async (error, stdout, stderr) => {
    console.log('[INFO] stdout:', stdout); // Logs the output
    console.log('[INFO] stderr:', stderr); // Logs any errors
    if (error || stderr) {
      console.error('[ERROR] Download failed:', error?.message || stderr);
      activeFetches.delete(userId);
      logActiveFetches();
      return res.status(500).json({ success: false, message: 'Download failed' });
    }

    await saveAudioMetadata(userId, videoId, `${videoId}.webm`);
    activeFetches.delete(userId);
    logActiveFetches();
    res.json({ success: true, file: fileUrl });
  });
});

// ✅ Save metadata and limit to 5 recent per user
async function saveAudioMetadata(userId, videoId, fileName) {
  const timestamp = Date.now();
  const audioRef = db.ref(`downloads/${userId}/audios`);
  const newEntry = audioRef.push();
  await newEntry.set({ audioId: videoId, fileName, timestamp });
  const snapshot = await audioRef.once('value');
  const data = snapshot.val();
  if (!data) return;

  const sorted = Object.entries(data).sort((a, b) => a[1].timestamp - b[1].timestamp);
  if (sorted.length <= 5) return;

  const excess = sorted.slice(0, sorted.length - 5);
  for (const [key, value] of excess) {
    const filePath = path.join(DOWNLOAD_DIR, userId, value.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await audioRef.child(key).remove();
    console.log(`[INFO] Deleted old: ${filePath}`);
  }
}

function updateSongData(songId) {
  const songRef = db.ref("songs").child(songId);
  console.log(songId);
  
  songRef.once("value", snapshot => {
    if (snapshot.exists()) {
      let currentPlayCount = snapshot.child("song_plays").val();

      if (!currentPlayCount) {
        currentPlayCount = 1;
      } else {
        currentPlayCount += 1;
      }

      // Update the played_count field in the database
      songRef.update({
        played_count: currentPlayCount
      }, error => {
        if (error) {
          console.error("Failed to update song data:", error);
        } else {
        }
      });
    } else {
      console.log("Song not found in the database.");
    }
  }, error => {
    console.error("Error reading from Firebase:", error);
  });
}


// 🔄 Catch-all for React frontend routes
app.get('*', (req, res) => {
  res.sendFile(path.join(BUILD_DIR, 'index.html'));
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`\n[READY] Server is running at http://localhost:${PORT}`);
});
