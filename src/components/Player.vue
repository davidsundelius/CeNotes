<script setup lang="ts">
  import { ref, onMounted, watch } from 'vue';
  import Loader from './Loader.vue';

  let audioContext;
  let samples = [];
  let timeout = null;
  let activeSources = [];
  let osmd = null;
  const fadeOutTime = 0.1;
  
  const loading = ref(true);
  const isPlaying = ref(false);
  const songs = ref([]);
  const selectedSong = ref('GottOl.musicxml');
  const tempo = ref(120);
  const rythm = ref(4);
  const timeBasedOnTempo = ref(60000 / tempo.value);
  const parts = ref([]);

  watch(() => parts, (newParts) => {
    if(!osmd) {
      return;
    }
    osmd.sheet.Parts.forEach((part, index) => {
      part.voices[0].visible = newParts.value[index].show;
    });
    osmd.render();
  }, {deep: true, immediate: true});

  watch(() => selectedSong, async () => {
    if(!selectedSong.value || !document.getElementById('sheetmusic')) {
      return;
    }
    await loadSheetMusic('./songs/' + selectedSong.value);
    loading.value = false;
  }, {deep: true, immediate: true});

  onMounted(async () => {
    await loadSongs();
    loading.value = false;
  });

  async function loadSongs() {
    const loadedSongs = await fetch('./songs.json')
      .then((response) => response.json());
    songs.value = loadedSongs.map((song) => {
      return {
        label: song,
        value: song + '.musicxml'
      };
    });
  }

  async function loadSamples() {
    loading.value = true;
    navigator.audioSession.type = 'playback';
    audioContext = new AudioContext()
    
    for(let i = 1; i < 6; i++) {
      samples.push(await fetch('./samples/C'+i+'.mp3')
        .then((response) => response.arrayBuffer())
        .then((buffer) => audioContext.decodeAudioData(buffer)));
    }
  }

  async function loadSheetMusic(xmlFile) {
    await loadSamples();
    pause();
    const { OpenSheetMusicDisplay, MusicSheet, Cursor } = await import('opensheetmusicdisplay');
    loading.value = true;
    osmd = new OpenSheetMusicDisplay(document.getElementById('sheetmusic'), {autoResize: true, darkMode: false, disableCursor: false, followCursor: true});
    osmd.setLogLevel('warn');
    await osmd.load(xmlFile);
    parts.value = osmd.sheet.Parts.map((part) => {
      return {
        label: part.nameLabel.text,
        show: true
      };
    });
    console.log(osmd.sheet);
    
    osmd.zoom = 0.9;
    tempo.value = osmd.sheet.defaultStartTempoInBpm;
    timeBasedOnTempo.value = 60000 / tempo.value;
    osmd.render();
    osmd.cursor.show();
  }

  function play() {
    isPlaying.value = true;
    let timeUntilNextNote = 999999;
    osmd.cursor.NotesUnderCursor().forEach((note) => {
      const duration = note.Length.realValue * rythm.value * timeBasedOnTempo.value;
      timeUntilNextNote = Math.min(duration, timeUntilNextNote);
      playTone(note.ToStringShort(3), duration);
    });
    timeout = setTimeout(() => {
      osmd.cursor.next();
      play();
    }, timeUntilNextNote);
  }

  function getNoteOffsetFromC4(note: string) {
    if(!note) {
      return NaN;
    }
    if(note === 'rest') {  
      return NaN;
    }
    const noteValues = {
      'C': 0,
      'C#': 1,
      'Db': 1,
      'Dn': 1,
      'D': 2,
      'D#': 3,
      'Eb': 3,
      'En': 3,
      'E': 4,
      'F': 5,
      'F#': 6,
      'Gn': 6,
      'Gb': 6,
      'G': 7,
      'G#': 8,
      'An': 8,
      'Ab': 8,
      'A': 9,
      'A#': 10,
      'Bb': 10,
      'Bn': 10,
      'B': 11
    };
    const noteParts = note.match(/([A-G]#?n?b?)(\d)/);
    return noteValues[noteParts[1]] + (parseInt(noteParts[2]) - 4) * 12;
  }

  function reverse() {
    osmd.cursor.reset();
  }

  function playTone(note: string, duration: number) {
    const noteValue = getNoteOffsetFromC4(note);
    if(isNaN(noteValue)) {
      return;
    }
    const octave = Math.floor(noteValue / 12 + 100) - 100;
    const source = audioContext.createBufferSource();
    source.buffer = samples[3 + octave];
    activeSources.push(source);
    source.detune.value = (noteValue - octave*12) * 100;
    const gainer = audioContext.createGain();
    source.connect(gainer);
    gainer.connect(audioContext.destination);
    source.start(0);
    gainer.gain.linearRampToValueAtTime(0.0001, audioContext.currentTime + duration / 1000 + fadeOutTime);
    source.stop(audioContext.currentTime + duration / 1000 + fadeOutTime);
  }

  function pause() {
    clearTimeout(timeout);
    activeSources.forEach((source) => {
      source.stop();
    });
    activeSources = [];
    isPlaying.value = false;
  }
</script>

<template>
  <div>
    <header class="header">
      <h1>CeNotes</h1>
      <div class="songs">
        <label for="song">Låt:</label>
        <select v-model="selectedSong">
          <option v-for="(song, index) in songs" :key="index" :value="song.value">{{song.label}}</option>
        </select>
      </div>
    </header>
    <Loader v-if="loading" class="loader"/>

    <div id="sheetmusic" class="sheetmusic"></div>
    <footer v-if="!loading" class="playbar">
      <span @click="reverse()">⏮️</span>
      <span @click="play()" v-if="!isPlaying">▶️</span>
      <span @click="pause()" v-else>⏸️</span>
      <div class="parts">
        <div v-if="!loading">
          <div v-for="(part, index) in parts" :key="index" >
            <input v-model="part.show" type="checkbox" :value="index" :id="part.label" checked>
            <label :for="part.label">{{part.label}}</label>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
  h1 {
    font-size: 3.2em;
    line-height: 1.1;
  }
  .loader {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .header {
    position: fixed;
    top: 0;
    padding: 1em;
    width: 100vw;
    border-bottom: 1px solid #ccc;
    background-color: #1a1a1a;
    display: flex;
    height: 30px;
    z-index: 1;
  }
  .header h1 {
    margin: 0;
    flex: 1;
    text-align: left;
    font-size: 32px;
  }

  .songs {
    display: flex;
    flex: 1;
    justify-content: flex-end;
    gap: 4px;
    align-items: center;
    margin-right: 2em;
  }

  

  .sheetmusic {
    width: 100vw;
    background-color: #fff;
    margin-top: 70px;
    margin-bottom: 50px;
  }

  .playbar {
    position: fixed;
    left: 0;
    bottom: 0;
    padding: 4px;
    width: 100vw;
    border-top: 1px solid #ccc;
    background-color: #1a1a1a;
    display: flex;
    overflow-x: auto;
  }

  .playbar span {
    margin-left: 12px;
    font-size: 50px;
  }

  .parts {
    display: flex;
    flex: 1;
    justify-content: flex-end;
    align-items: center;
    margin-right: 2em;
  }

  .parts div {
    display: flex;
    align-items: center;
  }

  .parts div input{
    display: none;
  }

  .parts div label {
    margin-left: 0.5em;
    border-radius: 8px;
    border: 1px solid transparent;
    padding: 0.6em 1.2em;
    font-size: 1em;
    font-weight: 500;
    font-family: inherit;
    background-color: #313581;
    cursor: pointer;
    transition: border-color 0.25s;
    box-shadow: 2px 2px 2px #646cff;
  }

  .parts div input:checked ~ label {
    background-color: #646cff;
    box-shadow: none;
  }

  .parts div label:hover {
    border-color: #646cff;
  }
</style>