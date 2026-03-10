# CeNotes — Project Guide

## What This Is
A Vue 3 PWA sheet music player for a Swedish male choir (Fåmansbolaget). Members can browse songs, view sheet music, and play audio previews of individual voice parts. Built with Vite + TypeScript.

## Tech Stack
- **Vue 3** (Composition API, `<script setup>`)
- **OpenSheetMusicDisplay (OSMD)** `^1.9.7` — renders MusicXML as SVG sheet music
- **Web Audio API** — synthesizes audio from sampled piano notes (C1–C5 mp3s)
- **vite-plugin-pwa** — registers as installable PWA with auto-update

## Project Structure
```
public/
  songs/        # MusicXML files (one per song)
  songs.json    # Generated list of song names (no extension)
  voices.json   # Generated member→voice→song mapping
  samples/      # C1.mp3–C5.mp3 (piano samples for audio synthesis)
  fonts/        # Music notation fonts for OSMD
src/
  components/
    Player.vue      # Main component — all playback logic lives here
    SongFilter.vue  # Filter songs by which members are present
    Logo.vue
    Loader.vue
scripts/
  generateSonglist.js   # Reads songs/ dir → writes songs.json
  generateVoices.js     # Reads config → writes voices.json
```

## Build & Dev Commands
```bash
npm run serve     # Dev server on port 8080
npm run build     # Type-check + Vite build
npm run deploy    # Runs update + build with /CeNotes/ base path
npm run update    # Regenerates songs.json and voices.json (run before deploy when songs change)
```

## Adding Songs
1. Drop `.musicxml` file into `public/songs/`
2. Run `npm run update` to regenerate `songs.json`
3. **Filenames with Swedish characters (å, ä, ö) work** — the URL is `encodeURIComponent`-encoded when passed to OSMD

## Player.vue — Architecture

### Audio Pipeline
```
BufferSource → GainNode → DynamicsCompressor → AudioContext.destination
```
- Samples: C1–C5 piano recordings, pitch-shifted via `source.detune` to reach any note
- Gain: `5.0` (high intentionally for volume)
- Compressor: hard limiter (`threshold=-6dB, knee=0, ratio=20, attack=1ms`) to prevent clipping on chords
- On iOS: `audioContext.resume()` called on every `play()` call and on first `touchstart` to unblock suspended context

### Playback Timing Model
The OSMD cursor visits each note-start event across all voices in chronological order. `play(prevRemaining)` is called recursively:

- `noteDurations[]` — timing durations of all non-skipped notes at the current cursor position
- `allDurations = [...noteDurations, prevRemaining]` (if prevRemaining > 0)
- `timeUntilNext = Math.min(...allDurations)` — when to call `cursor.next()`
- `nextRemaining = min(d - timeUntilNext for d in allDurations where d > timeUntilNext)` — earliest upcoming event from voices not yet exhausted

**Critical:** `prevRemaining` tracks notes still playing from previous cursor positions. This ensures that when voices have different rhythms (e.g., voice 1 plays a long note while voice 2 plays several short notes), all notes are properly scheduled. When all notes at a position are skipped (tied/slur continuations), `prevRemaining` is passed through unchanged.

### Timing: Sound vs. Cursor
- **Timing duration** uses `note.length.realValue` (single note only) — determines when cursor advances
- **Sound duration** uses `note.NoteTie.Duration.realValue` for tie-start notes — determines how long audio plays
- Splitting these is essential: using the full tie chain for timing inflates `prevRemaining` and makes subsequent notes play too early

### Tempo Normalization
Uses `osmd.cursor.Iterator.currentPlaybackSettings()` at each cursor position:
- `beatLengthMs = ps.BeatLengthInMilliseconds` — ms per beat (handles half-note = 60, quarter = 120, etc.)
- `beatRealValue = ps.BeatRealValue` — beat unit as whole-note fraction (0.5 for half, 0.25 for quarter)
- Duration formula: `noteRealValue / beatRealValue * beatLengthMs`
- Falls back to `timeBasedOnTempo` / `rythm` refs if PlaybackSettings unavailable

### Key OSMD APIs Used
- `osmd.cursor.NotesUnderCursor()` — notes at current cursor position (all voices)
- `osmd.cursor.GNotesUnderCursor()` — graphical notes (for click-to-seek)
- `osmd.cursor.Iterator.currentPlaybackSettings()` — tempo/beat info at current position
- `note.NoteTie` — Tie object; `note.NoteTie.StartNote` identifies tie-start; `note.NoteTie.Duration.realValue` = total tied duration
- `note.ParentVoiceEntry.Articulations` — array of Articulation; `articulationEnum === 10` = fermata, `11` = inverted fermata
- `note.slurs` — array of Slur; `slur.endNote` = last note of slur (camelCase, not PascalCase)
- `note.length.realValue` — note duration as fraction of whole note

### Ties & Slurs
- **Ties** (always active): skip notes where `note.NoteTie && note.NoteTie.StartNote !== note`
- **Slurs** (opt-in via settings): 
  - Tracks active slurs per voice in a `Map<voiceId, Set<Slur>>` to handle polyphonic music correctly
  - When a slur starts, adds it to the active slurs set for that voice
  - For intermediate notes (notes that don't have the slur in their `slurs` array but the slur is active in their voice), skips playback
  - For slur end notes (marked as active slur end), removes from active slurs and skips playback
  - Slur start note calculates full duration by walking through voice entries sequentially from start note to end note, accumulating all intermediate note durations
  - Falls back to just end note duration if voice walking fails
  - Correctly handles time-modified notes (triplets, quintuplets) as `realValue` already includes modification
  - Map is cleared on pause, reverse, and song load to prevent stale state
- **Critical:** When all notes at a position are skipped (`noteDurations.length === 0`), the code must wait for `prevRemaining` time (if any) before advancing the cursor. Simply calling `play(prevRemaining)` recursively would cause instant advancement through multiple positions (speed-up bug)

### Fermatas
Notes with `articulationEnum === 10 or 11` on `ParentVoiceEntry.Articulations` get `fermataMultiplier = 3` applied to both sound and timing durations.

### Repetitions
`checkForRepetions()` handles first/second volta repeats. `hasRepetedOnce` tracks state — reset it in `reverse()` and when loading a new song.

### Known Quirks
- `osmd.cursor.Iterator.FrontReached` (not `EndReached`) is used to walk backwards when finding repeat start barlines
- `osmd.sheet.Parts` (lowercase `sheet`) for part visibility; `osmd.Sheet.Transpose` (uppercase `Sheet`) for transposition — inconsistent OSMD API
- Each song load creates a new `AudioContext` (old one is `.close()`d first) — browser limits ~6 contexts per page
- `samples = []` must be reset before re-loading to prevent array growth across song changes
- Song loading uses a `loadId` counter to abort stale concurrent loads

## MusicXML Notes
- Files use standard MusicXML 4.0 partwise format
- `<sound tempo="">` is always in quarter-notes-per-minute; `<metronome>` carries the display beat unit
- Swedish filenames (å, ä, ö) must be `encodeURIComponent`-encoded in fetch URLs
- `<part-group>` with interleaved starts/stops (as in Hårgalåten) is valid MusicXML — OSMD handles it
