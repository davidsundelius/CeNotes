<script setup lang="ts">
  import { ref, onMounted, watch } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import Logo from './Logo.vue';
  import Loader from './Loader.vue';
  import SongFilter from './SongFilter.vue';

  const route = useRoute();
  const router = useRouter();

  let audioContext: any;
  let compressor: any;
  let samples: Array<any> = [];
  let timeout: any = null;
  let activeSources: Array<any> = [];  
  let osmd: any = null;
  let TypePointF2D: any;
  let loadId = 0;
  let activeSlursPerVoice = new Map<number, Set<any>>();

  const showingSongFilter = ref(false);
  const loading = ref(true);
  const isZoomedIn = ref(window.innerWidth > 800);
  const isPlaying = ref(false);
  const songs = ref<Array<{label: string, value: string}>>([]);
  const selectedSong = ref<string | null>(null);
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
    await loadSheetMusic('/songs/' + encodeURIComponent(selectedSong.value));
    loading.value = false;
    
    // Update URL when song is selected via dropdown
    const songName = selectedSong.value.replace('.musicxml', '');
    const encodedSongName = encodeURIComponent(songName);
    if(route.params.songName !== encodedSongName) {
      router.push({ name: 'song', params: { songName: encodedSongName } });
    }
  }, {deep: true, immediate: true});

  // Watch for URL changes and update selectedSong accordingly
  watch(() => route.params.songName, (newSongName) => {
    if(newSongName && typeof newSongName === 'string') {
      const decodedSongName = decodeURIComponent(newSongName);
      const songValue = decodedSongName + '.musicxml';
      if(selectedSong.value !== songValue) {
        selectedSong.value = songValue;
      }
    } else if(!newSongName && selectedSong.value) {
      // If URL has no song but we have a selected song, clear it
      selectedSong.value = null;
    }
  }, { immediate: true });

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
    const loadedSongs = await fetch('/songs.json')
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
    audioContext?.close();
    audioContext = new AudioContext();
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -6;
    compressor.knee.value = 0;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.001;
    compressor.release.value = 0.1;
    compressor.connect(audioContext.destination);
    // iOS requires a user gesture to resume a suspended AudioContext
    const resumeOnTouch = () => {
      audioContext?.resume();
      document.removeEventListener('touchstart', resumeOnTouch);
    };
    document.addEventListener('touchstart', resumeOnTouch);
    samples = [];
    for(let i = 1; i < 6; i++) {
      samples.push(await fetch('/samples/C'+i+'.mp3')
        .then((response) => response.arrayBuffer())
        .then((buffer) => audioContext.decodeAudioData(buffer)));
    }
  }

  async function loadSheetMusic(xmlFile: string) {
    const currentLoadId = ++loadId;
    await loadSamples();
    if(currentLoadId !== loadId) return;
    pause();
    activeSlursPerVoice.clear();
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
    pause();
    selectedSong.value = null;
    // Navigate to home route (removing song from URL)
    if(route.name !== 'home') {
      router.push({ name: 'home' });
    }
  }

  function selectNote(event: any) {
    pause();
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

  function play(prevRemaining: number = 0) {
    audioContext?.resume();
    isPlaying.value = true;
    const ps = osmd.cursor.Iterator?.currentPlaybackSettings?.();
    const beatLengthMs = ps?.BeatLengthInMilliseconds || timeBasedOnTempo.value;
    const beatRealValue = ps?.BeatRealValue || (1 / rythm.value);
    const notes = osmd.cursor.NotesUnderCursor();
    if(notes.length === 0) {
      isPlaying.value = false;
      osmd.cursor.reset();
      return;
    }
    // Collect timing durations for all notes at this cursor position
    const noteDurations: number[] = [];
    
    notes.forEach((note: any, noteIndex: number) => {
      // Always skip tied continuations — the start note covers the full duration
      if(note.NoteTie && note.NoteTie.StartNote !== note) {
        return;
      }
      
      const voiceId = note.ParentVoiceEntry?.ParentVoice?.VoiceId ?? noteIndex;
      const activeSlurs = activeSlursPerVoice.get(voiceId) || new Set();
      
      // Check if this note is an active slur end note
      if(useSlurs.value && note.slurs.some((slur: any) => slur.endNote === note && activeSlurs.has(slur))) {
        // This is the end of an active slur - skip and remove from active
        note.slurs.forEach((slur: any) => {
          if(slur.endNote === note) {
            activeSlurs.delete(slur);
          }
        });
        if(activeSlurs.size === 0) {
          activeSlursPerVoice.delete(voiceId);
        }
        return;
      }
      
      // Check if this note is in the middle of an active slur (doesn't start any of the active slurs)
      if(useSlurs.value && activeSlurs.size > 0) {
        // If this note doesn't have any of the active slurs, it's intermediate
        let isIntermediate = true;
        for(const slur of activeSlurs) {
          if(note.slurs.includes(slur)) {
            isIntermediate = false;
            break;
          }
        }
        if(isIntermediate) {
          return; // Skip intermediate notes
        }
      }
      
      // Add any new slurs starting at this note
      if(useSlurs.value && note.slurs.length > 0) {
        note.slurs.forEach((slur: any) => {
          if(slur.endNote && slur.endNote !== note && !activeSlurs.has(slur)) {
            activeSlurs.add(slur);
          }
        });
        if(activeSlurs.size > 0) {
          activeSlursPerVoice.set(voiceId, activeSlurs);
        }
      }
      
      // CRITICAL: Separate timing (cursor advance) from sound (audio playback)
      // - Timing uses only the current note's duration
      // - Sound uses the full tie chain duration
      // This prevents inflating prevRemaining and causing delays
      let soundRealValue = note.length.realValue;
      let timingRealValue = note.length.realValue;
      if(note.NoteTie && note.NoteTie.Notes && note.NoteTie.Notes.length > 0) {
        // Sum all notes in the tie chain for sound duration
        soundRealValue = 0;
        for(const tiedNote of note.NoteTie.Notes) {
          soundRealValue += tiedNote.length.realValue;
        }
        // Keep timingRealValue as single note only - do NOT set to soundRealValue
      }
      
      // Check for fermata on any note in the tie chain
      let tieHasFermata = false;
      if(note.NoteTie && note.NoteTie.Notes) {
        for(const tiedNote of note.NoteTie.Notes) {
          if(tiedNote.ParentVoiceEntry?.Articulations?.some(
            (a: any) => a.articulationEnum === 10 || a.articulationEnum === 11
          )) {
            tieHasFermata = true;
            break;
          }
        }
      }
      
      // Calculate slur extension by walking through voice to find all intermediate notes
      let slurRealValue = 0;
      let slurEndNote: any = null;
      let slurNotesWithFermata: any[] = []; // Track notes in slur that have fermata
      if(useSlurs.value && note.slurs.length > 0) {
        note.slurs.forEach((slur: any) => {
          if(slur.endNote && slur.endNote !== note) {
            // Try to use the slur's built-in notes collection if available
            if(slur.Notes && slur.Notes.length > 0) {
              // Sum all notes in the slur except the first one
              for(let i = 1; i < slur.Notes.length; i++) {
                const slurNote = slur.Notes[i];
                // Manually sum tied notes if present
                let noteRealValue = slurNote.length.realValue;
                if(slurNote.NoteTie && slurNote.NoteTie.Notes && slurNote.NoteTie.Notes.length > 0) {
                  noteRealValue = 0;
                  for(const tiedNote of slurNote.NoteTie.Notes) {
                    noteRealValue += tiedNote.length.realValue;
                  }
                }
                slurRealValue += noteRealValue;
                // Check if this slur note has a fermata
                if(slurNote.ParentVoiceEntry?.Articulations?.some(
                  (a: any) => a.articulationEnum === 10 || a.articulationEnum === 11
                )) {
                  slurNotesWithFermata.push(slurNote);
                }
              }
              slurEndNote = slur.endNote;
            } else {
              // Fallback: Walk through voice entries to find intermediate notes
              const voice = note.ParentVoiceEntry?.ParentVoice;
              
              if(voice && voice.VoiceEntries) {
                let foundStart = false;
                let accumulatedDuration = 0;
                let foundEnd = false;
                
                for(const entry of voice.VoiceEntries) {
                  for(const voiceNote of entry.Notes) {
                    if(voiceNote === note) {
                      foundStart = true;
                      continue; // Don't count the start note
                    }
                    if(foundStart && !foundEnd) {
                      // Add this note's duration (realValue already includes time modifications like triplets)
                      // Manually sum tied notes if present
                      let noteRealValue = voiceNote.length.realValue;
                      if(voiceNote.NoteTie && voiceNote.NoteTie.Notes && voiceNote.NoteTie.Notes.length > 0) {
                        noteRealValue = 0;
                        for(const tiedNote of voiceNote.NoteTie.Notes) {
                          noteRealValue += tiedNote.length.realValue;
                        }
                      }
                      accumulatedDuration += noteRealValue;
                      // Check if this voice note has a fermata
                      if(voiceNote.ParentVoiceEntry?.Articulations?.some(
                        (a: any) => a.articulationEnum === 10 || a.articulationEnum === 11
                      )) {
                        slurNotesWithFermata.push(voiceNote);
                      }
                      
                      if(voiceNote === slur.endNote) {
                        foundEnd = true;
                        break;
                      }
                    }
                  }
                  if(foundEnd) break;
                }
                
                if(foundEnd && accumulatedDuration > 0) {
                  slurRealValue += accumulatedDuration;
                  slurEndNote = slur.endNote;
                } else {
                  // Couldn't walk the voice properly, just use end note duration
                  let endNoteRealValue = slur.endNote.length.realValue;
                  if(slur.endNote.NoteTie && slur.endNote.NoteTie.Notes && slur.endNote.NoteTie.Notes.length > 0) {
                    endNoteRealValue = 0;
                    for(const tiedNote of slur.endNote.NoteTie.Notes) {
                      endNoteRealValue += tiedNote.length.realValue;
                    }
                  }
                  slurRealValue += endNoteRealValue;
                  slurEndNote = slur.endNote;
                }
              } else {
                // No voice entry access, fallback to just end note duration
                let endNoteRealValue = slur.endNote.length.realValue;
                if(slur.endNote.NoteTie && slur.endNote.NoteTie.Notes && slur.endNote.NoteTie.Notes.length > 0) {
                  endNoteRealValue = 0;
                  for(const tiedNote of slur.endNote.NoteTie.Notes) {
                    endNoteRealValue += tiedNote.length.realValue;
                  }
                }
                slurRealValue += endNoteRealValue;
                slurEndNote = slur.endNote;
              }
            }
          }
        });
      }
      
      // Check for fermata on current note OR any note in the tie chain OR any note in the slur chain
      const hasFermata = (note.ParentVoiceEntry?.Articulations?.some(
        (a: any) => a.articulationEnum === 10 || a.articulationEnum === 11
      ) ?? false) || tieHasFermata || slurNotesWithFermata.length > 0;
      const fermataMultiplier = hasFermata ? 1.5 : 1;
      const soundDuration = (soundRealValue + slurRealValue) / beatRealValue * beatLengthMs * fermataMultiplier;
      const timingDuration = timingRealValue / beatRealValue * beatLengthMs * fermataMultiplier;
      noteDurations.push(timingDuration);
      if(slurEndNote) {
        playTone(note.ToStringShort(3), soundDuration, slurEndNote.ToStringShort(3));
      } else {
        playTone(note.ToStringShort(3), soundDuration);
      }
    });
    // All notes at this position were skipped (tied/slur continuations)
    if(noteDurations.length === 0) {
      if(prevRemaining > 0) {
        // We still need to wait for the prevRemaining time before advancing
        timeout = setTimeout(() => {
          osmd.cursor.next();
          checkForRepetions(notes);
          play(0); // After waiting, there's nothing left remaining
        }, prevRemaining);
      } else {
        // No notes playing and nothing remaining - advance immediately
        osmd.cursor.next();
        checkForRepetions(notes);
        play(0);
      }
      return;
    }
    
    // Include prevRemaining (from notes still playing from previous positions) in timing calculation
    const allDurations = prevRemaining > 0 ? [...noteDurations, prevRemaining] : noteDurations;
    
    // Use the minimum duration to advance the cursor
    // This ensures we move at the pace of the shortest event (either a new note or a note finishing from before)
    const timeUntilNext = Math.min(...allDurations);
    
    // Safety check: ensure timeUntilNext is reasonable (at least 1ms)
    if(timeUntilNext < 1) {
      console.warn('Invalid timeUntilNext:', timeUntilNext, 'noteDurations:', noteDurations, 'prevRemaining:', prevRemaining);
      // Skip to next position immediately
      osmd.cursor.next();
      checkForRepetions(notes);
      play(0);
      return;
    }
    
    // Calculate the next remaining duration for notes that will still be playing
    // This is the earliest upcoming event from notes not yet exhausted
    const remainingDurations = allDurations
      .map(d => d - timeUntilNext)
      .filter(d => d > 0.5); // Filter out very small remainders (< 0.5ms) to avoid accumulating rounding errors
    const nextRemaining = remainingDurations.length > 0 ? Math.min(...remainingDurations) : 0;
    
    timeout = setTimeout(() => {
      osmd.cursor.next();
      checkForRepetions(notes);
      play(nextRemaining);
    }, timeUntilNext);
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
    pause();
    hasRepetedOnce.value = false;
    activeSlursPerVoice.clear();
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
    source.onended = () => {
      activeSources = activeSources.filter((s) => s !== source);
    };
    source.detune.value = (noteValue - octave*12) * 100;
    source.detune.value += transpose.value * 100;
    if(!isNaN(endNoteValue)) {
      source.detune.linearRampToValueAtTime(source.detune.value + (endNoteValue - noteValue) * 100, audioContext.currentTime + duration / 1000);
    }
    const gainer = audioContext.createGain();
    source.connect(gainer);
    gainer.connect(compressor);
    source.start(0);
    gainer.gain.setValueAtTime(5.0, audioContext.currentTime);
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
    activeSlursPerVoice.clear();
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