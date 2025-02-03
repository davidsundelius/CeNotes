import fs from 'fs';

let membets = [];
let result = [];
fs.readFileSync('./config/voices.csv', 'utf8').split('\n').forEach((row, index) => {
  if(index === 0) {
    row.split(',').slice(3).forEach((member) => {
      membets.push(member);
    });
  } else {
    const data = row.replace(/"[^"]+"/g, (s) => s.replace(/,/g, '')).split(',');
    const song = data[0];
    const voices = data.slice(3);
    const distinctVoices = Array.from(new Set(voices.map((v) => v.replaceAll('\r','')).filter((voice) => voice !== '-' && voice !== '?' && voice !== '')));
    if(distinctVoices.length === 0) {
      return;
    }
    const songResult = { name: song };
    distinctVoices.forEach((voice) => {
      songResult[voice] = voices.map((v, i) => {
        return {
          v: v,
          name: membets[i]
        }
    }).filter((v) => v.v === voice).map((v) => v.name);
    });
    result.push(songResult);
  }
  fs.writeFileSync('public/voices.json', JSON.stringify({
    songs: result,
    members: membets
  }));
});