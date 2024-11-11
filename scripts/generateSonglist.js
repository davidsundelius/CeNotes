import fs from 'fs';

fs.readdir('public/songs', (error, fileNames) => {
  fs.writeFileSync('public/songs.json', JSON.stringify(fileNames.filter(fileName => fileName.endsWith('.musicxml')).map(fileName => fileName.slice(0, -9))));
});