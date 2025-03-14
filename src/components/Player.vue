<script setup lang="ts">
  import { ref, onMounted, watch } from 'vue';
  import Logo from './Logo.vue';
  import Loader from './Loader.vue';
  import SongFilter from './SongFilter.vue';

  let audioContext: any;
  let samples: Array<any> = [];
  let timeout: any = null;
  let activeSources: Array<any> = [];
  let osmd: any = null;
  let TypePointF2D: any;

  const showingSongFilter = ref(false);
  const loading = ref(true);
  const isZoomedIn = ref(window.innerWidth > 800);
  const isPlaying = ref(false);
  const songs = ref<Array<{label: string, value: string}>>([]);
  const selectedSong = ref(null);
  const tempo = ref(120);
  const rythm = ref(4);
  const timeBasedOnTempo = ref(60000 / tempo.value);
  const parts = ref<any>([]);
  const hasRepetedOnce = ref(false);

  const settingsModal = ref<HTMLDialogElement>();
  const useSlurs = ref(false);
  const zoomLevel = ref(0.5);
  const transpose = ref(0);
  const fadeOutTime = 0.2;

  declare global {
    interface Navigator {
      audioSession: any;
    }
  }

  watch(() => parts, (newParts: any) => {
    if(!osmd) {
      return;
    }
    osmd.sheet.Parts.forEach((part: any, index: number) => {
      part.voices[0].visible = newParts.value[index].show;
    });
    osmd.updateGraphic();
    osmd.render();
    osmd.cursor.show();
  }, {deep: true, immediate: true});

  watch(() => selectedSong, async () => {
    if(!selectedSong.value) {
      return;
    }
    await loadSheetMusic('./songs/' + selectedSong.value);
    loading.value = false;
  }, {deep: true, immediate: true});

  watch(() => transpose, () => {
    if(!osmd) {
      return;
    }
    osmd.Sheet.Transpose = Number(transpose.value);
    osmd.updateGraphic();
    osmd.render();
    osmd.cursor.show();
  }, {deep: true, immediate: true});

  onMounted(async () => {
    await loadSongs();
    loading.value = false;
  });

  async function loadSongs() {
    const loadedSongs = await fetch('./songs.json')
      .then((response) => response.json());
    songs.value = loadedSongs.map((song: string) => {
      return {
        label: song,
        value: song + '.musicxml'
      };
    });
  }

  async function loadSamples() {
    if(navigator.audioSession) {
      navigator.audioSession.type = 'playback';
    }
    loading.value = true;
    audioContext = new AudioContext()
    for(let i = 1; i < 6; i++) {
      samples.push(await fetch('./samples/C'+i+'.mp3')
        .then((response) => response.arrayBuffer())
        .then((buffer) => audioContext.decodeAudioData(buffer)));
    }
  }

  async function loadSheetMusic(xmlFile: string) {
    await loadSamples();
    pause();
    const { OpenSheetMusicDisplay, TransposeCalculator, PointF2D } = await import('opensheetmusicdisplay');
    TypePointF2D = PointF2D;
    loading.value = true;
    osmd = new OpenSheetMusicDisplay(document.getElementById('sheetmusic')!, {autoResize: true, darkMode: false, disableCursor: false, followCursor: true});
    osmd.TransposeCalculator = new TransposeCalculator();
    osmd.setLogLevel('warn');
    await osmd.load(xmlFile);
    parts.value = osmd.sheet.Parts.map((part: any) => {
      return {
        label: part.nameLabel.text,
        show: true
      };
    });
    osmd.zoom = isZoomedIn.value ? 1 : zoomLevel.value;
    tempo.value = osmd.sheet.defaultStartTempoInBpm || 100;
    timeBasedOnTempo.value = 60000 / tempo.value;
    osmd.render();
    osmd.cursor.show();
  }

  function back() {
    stop();
    selectedSong.value = null;
  }

  function selectNote(event: any) {
    clearTimeout(timeout);
    osmd.cursor.reset();
    var sheetBoundingBox = event.target.getBoundingClientRect();
    const nearestNote = osmd.GraphicSheet.GetNearestNote(
      new TypePointF2D((event.clientX - sheetBoundingBox.left - 5) / 10 / osmd.zoom, (event.clientY - sheetBoundingBox.top - 5) / 10 / osmd.zoom)
    );
    if(nearestNote?.getSVGId()) {
      while(!osmd.cursor.GNotesUnderCursor().some((c: any) => c.getSVGId() === nearestNote.getSVGId())) {
        osmd.cursor.next();
        if(osmd.cursor.Iterator.EndReached) {
          osmd.cursor.reset();
          break;
        }
      }
    } else {
      return;
    }
    play();
  }

  function play(timeUntilNextNote = 999999) {
    isPlaying.value = true;
    let storedDuration = 0;
    const notes = osmd.cursor.NotesUnderCursor();
    if(notes.length === 0) {
      isPlaying.value = false;
      osmd.cursor.reset();
      return;
    }
    notes.forEach((note: any) => {
      let duration = 0;
      let slurLength = 0;
      let slurEndNote = null;
      if(useSlurs.value) {
        storedDuration = Math.max(duration, storedDuration);
        if(note.slurs.some((slur: any) => slur.endNote === note)) {
          timeUntilNextNote = Math.min(duration, timeUntilNextNote);
          return;
        }
        slurLength = note.slurs.reduce((acc: any, slur: any) => {
          return slur.endNote.length.realValue + acc;
        }, 0);
        if(slurLength > 0) {
          slurEndNote = note.slurs[0].endNote
        }
      }
      duration = (note.length.realValue + slurLength) * rythm.value * timeBasedOnTempo.value;
      storedDuration = Math.max(duration, storedDuration);
      timeUntilNextNote = Math.min(duration, timeUntilNextNote);
      if(slurEndNote) {
        playTone(note.ToStringShort(3), duration, slurEndNote.ToStringShort(3));
      } else {
        playTone(note.ToStringShort(3), duration);
      }
    });
    timeout = setTimeout(() => {
      osmd.cursor.next();
      checkForRepetions(notes);
      play(storedDuration - timeUntilNextNote === 0 ? 999999 : storedDuration - timeUntilNextNote);
    }, timeUntilNextNote);
  }

  function checkForRepetions(notes: any) {
    const newNotes = osmd.cursor.NotesUnderCursor();
    if(notes[0].SourceMeasure.endsWithLineRepetition() && (newNotes.length === 0 || newNotes[0].SourceMeasure !== notes[0].SourceMeasure)) {
        if(!hasRepetedOnce.value) {
          hasRepetedOnce.value = true;
          while(!osmd.cursor.Iterator.FrontReached) {
            const prevNotes = osmd.cursor.NotesUnderCursor();
            osmd.cursor.previous();
            if(prevNotes.length && prevNotes[0].SourceMeasure.beginsWithLineRepetition() && !osmd.cursor.NotesUnderCursor()[0].SourceMeasure.beginsWithLineRepetition()) {
              break;
            }
          }
          osmd.cursor.next();
        } else {
          hasRepetedOnce.value = false;
        }
      }
  }

  /*function jumpToSpecificNote(index: number) {
    clearTimeout(timeout);
    osmd.cursor.reset();
    for(let i = 0; i < index; i++) {
      osmd.cursor.next();
    }
    play();
  }*/

  function getNoteOffsetFromC4(note: string) {
    if(!note) {
      return NaN;
    }
    if(note === 'rest') {  
      return NaN;
    }
    const noteValues: any = {
      'Cb': -1,
      'C': 0,
      'Cn': 0,
      'C#': 1,
      'Db': 1,
      'Dn': 2,
      'D': 2,
      'D#': 3,
      'Eb': 3,
      'En': 4,
      'E': 4,
      'Fb': 4,
      'Fn': 5,
      'F': 5,
      'F#': 6,
      'Gb': 6,
      'Gn': 7,
      'G': 7,
      'G#': 8,
      'Ab': 8,
      'An': 9,
      'A': 9,
      'A#': 10,
      'Bb': 10,
      'Bn': 11,
      'B': 11
    };
    const noteParts: RegExpMatchArray = note.match(/([A-G]#?n?b?)(\d)/) || ['', '', ''];
    return noteValues[noteParts[1]] + (parseInt(noteParts[2]) - 4) * 12;
  }

  function reverse() {
    osmd.cursor.reset();
  }

  function playTone(note: string, duration: number, endNote?: string) {
    const noteValue = getNoteOffsetFromC4(note);
    const endNoteValue = getNoteOffsetFromC4(endNote || '');
    if(isNaN(noteValue)) {
      return;
    }
    const octave = Math.floor(noteValue / 12 + 100) - 100;
    const source = audioContext.createBufferSource();
    source.buffer = samples[3 + octave];
    activeSources.push(source);
    source.detune.value = (noteValue - octave*12) * 100;
    source.detune.value += transpose.value * 100;
    if(!isNaN(endNoteValue)) {
      source.detune.linearRampToValueAtTime(source.detune.value + (endNoteValue - noteValue) * 100, audioContext.currentTime + duration / 1000);
    }
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

  function toggleZoom() {
    isZoomedIn.value = !isZoomedIn.value;
    osmd.zoom = isZoomedIn.value ? 1.0 : zoomLevel.value;
    osmd.render();
  }

  function playStartChoord() {
    pause();
    osmd.cursor.reset();
    const queue: Array<any> = [];
    osmd.cursor.NotesUnderCursor().forEach((note: any) => {
      if(!note.ToStringShort(3).includes('rest') && !queue.find((n) => n.ToStringShort(3) === note.ToStringShort(3))) {
        queue.push(note);
      }
    });
    const interval = setInterval(() => {
      if(queue.length === 0) {
        clearInterval(interval);
        return;
      }
      const note = queue.shift();
      playTone(note.ToStringShort(3), 1000);
    }, 1000);
  }

  function reload() {
    window.location.reload();
  }
</script>

<template>
  <div>
    <dialog ref="settingsModal" class="modal" @click="(event) => event.target === settingsModal ? settingsModal?.close() : null">
      <section @click.stop>
        <h1>Inställningar</h1>
        <label>
          <input type="checkbox" v-model="useSlurs">
          Använd Slur
        </label>
        <br/>
        <label>
          <input type="range" min="-12" max="12" value="0" id="transpose" v-model="transpose">
          Transponerar {{ transpose }} halvtoner
        </label>
        <br/>
        <br/>
        <button @click="settingsModal?.close()">Stäng</button>
      </section>
    </dialog>

    <header class="header">
      <Logo class="logo" @click="back()" />
      <div class="songs">
        <span @click="toggleZoom()" v-if="selectedSong" class="zoom">🔍</span>
        <button @click="settingsModal?.showModal()" v-if="selectedSong">⚙️</button>
        <select v-model="selectedSong" class="songSelector">
          <option v-for="(song, index) in songs" :key="index" :value="song.value">{{song.label}}</option>
        </select>
      </div>
    </header>
    <Loader v-if="loading" class="loader"/>

    <section class="welcome" v-if="!loading && !selectedSong">
      <Logo class="fullsizeLogo" @click="selectedSong = null"/>
      <div v-if="!showingSongFilter">
        <h2>Välkommen till Fåmansbolagets app!</h2>
        För att sätta igång, välj en låt uppe till höger.
        <br/><br/>
        <a href="https://docs.google.com/spreadsheets/d/1Asz1vAQnRQWRlBACTt4WN_92cJiI3OBNGVt8mDEVPCE" target="_blank">Stämmor</a><br/>
        <a href="https://drive.google.com/drive/u/0/folders/1IUoG-h-6rYRIFZSNNX8_2aD13yMnw6W3" target="_blank">Låtarkivet</a><br/>
        <a href="https://docs.google.com/spreadsheets/d/1y43wZmyr1p-7MujA9y752EdvHZ0mI1WrdrCaJaOBGDU" target="_blank">Medlemslista</a><br/>
        <button @click="showingSongFilter = true">Låtväljaren</button><br/>
        <br/><br/>
        <button @click="reload()">Uppdatera</button>
      </div>
      <SongFilter v-if="showingSongFilter" @close="showingSongFilter=false"/>
    </section>
    <div id="sheetmusic" class="sheetmusic" v-if="selectedSong" @click="selectNote"></div>
    <footer v-if="!loading && selectedSong" class="playbar">
      <span @click="reverse()">⏮️</span>
      <span @click="play()" v-if="!isPlaying">▶️</span>
      <span @click="pause()" v-else>⏸️</span>
      <span @click="playStartChoord()">🎼</span>
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
    line-height: 29px;
    font-size: 32px;
  }

  .modal {
    z-index: 9999;
  }
  .modal::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .songs {
    display: flex;
    flex: 1;
    justify-content: flex-end;
    gap: 4px;
    align-items: center;
    margin-right: 2em;
  }
  .zoom {
    margin-right: 1em;
    font-size: 1.5em;
    cursor: pointer;
  }
  .back {
    margin-right: 1em;
    font-size: 1.5em;
    cursor: pointer;
  }
  .songSelector {
    padding: 0.5em;
    font-size: 1em;
    width: 120px;
    font-family: inherit;
    background-color: #313581;
    color: #fff;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.25s;
  }

  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    width: 100vw;
    text-align: center;
  }
  .fullsizeLogo {
    margin-bottom: 20px;
    width: 120px;
    height: 120px;
    transform: scale(1);
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0% {
        transform: scale(0.90);
        box-shadow: 0 0 0 10px rgba(0, 0, 0, 0);
    }

    50% {
        transform: scale(1);
        box-shadow: 0 0 0 10px rgba(0, 0, 0, 0);
    }

    100% {
        transform: scale(0.90);
        box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
    }
}

  .sheetmusic {
    width: 100vw;
    background-color: #fff;
    margin-top: 63px;
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