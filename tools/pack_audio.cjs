// Bundle <dist>/audio into pack-<group>.bin files plus audio/pack.json (path -> [pack, offset, length]).
// Usage: node tools/pack_audio.cjs <dist> [--strip]   (--strip removes the loose files afterwards)
const fs = require('fs');
const path = require('path');
const dist = process.argv[2];
const strip = process.argv.includes('--strip');
const root = path.join(dist, 'audio');
const files = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(mp3|ogg|wav|m4a)$/i.test(n)) files.push(path.relative(root, p).split(path.sep).join('/'));
  }
})(root);
const groups = {};
for (const f of files) (groups[f.split('/')[0]] ||= []).push(f);
const index = {};
for (const [g, list] of Object.entries(groups)) {
  const name = `pack-${g}.bin`;
  const parts = [];
  let off = 0;
  for (const f of list.sort()) {
    const b = fs.readFileSync(path.join(root, f));
    index[f] = [name, off, b.length];
    parts.push(b);
    off += b.length;
  }
  fs.writeFileSync(path.join(root, name), Buffer.concat(parts));
  console.log(name, list.length, 'files', (off / 1e6).toFixed(1), 'MB');
}
fs.writeFileSync(path.join(root, 'pack.json'), JSON.stringify(index));
if (strip) for (const f of files) fs.unlinkSync(path.join(root, f));
