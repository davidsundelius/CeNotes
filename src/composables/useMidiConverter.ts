export default function useMidiConverter() {
  function getNoteFromNoteNumber(noteNumber: number, tempo: string) {
    const notes = [
      'C',
      'C#',
      'D',
      'D#',
      'E',
      'F',
      'F#',
      'G',
      'G#',
      'A',
      'A#',
      'B'
    ];
    return notes[noteNumber % 12] + Math.floor(noteNumber / 12) + '/' + tempo;
  }

  function divideTrackIntoMeasures(track: any) {
    let measures: string[] = [];
    let measure: string[] = [];
    track.forEach((note: any) => {
      measure.push(getNoteFromNoteNumber(note.noteOn.noteNumber, 'q'));
      if(measure.length === 4) {
        measures.push(measure.join(', '));
        measure = [];
      }
    });
    measures.splice(1);
    return measures;
  }

  function convertMidiToVexTab(tracks: any, score: any, system: any) {
    
    const track = tracks[0].filter((note: any) => note.noteOn);

    const stave = system.addStave({
      voices: [
        score.voice(score.notes('C#5/q, C#5/q, C#5/q, C#5/q'), { stem: 'up' })
      ]
    });
    stave.addClef('treble');
    stave.addTimeSignature('4/4');
    stave.context.setStrokeStyle('white');
    stave.context.setFillStyle('white');
  }

  function convertMidiToMusic(midiJSON: any) {
    return midiJSON.tracks.map(track => {
      return {
        name: track.name,
        notes: track.notes.map(note => {
          return {
            name: note.name,
            duration: note.duration,
            time: note.time,
            midi: note.midi,
            velocity: note.velocity
          };
        })
      };
    });
  }

  return {
    convertMidiToVexTab,
    convertMidiToMusic
  };
};
