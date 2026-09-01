// Quick MP4 edit-list / duration inspector: node scripts/mp4boxdump.cjs <file.mp4>
const fs = require('fs')
const b = fs.readFileSync(process.argv[2])
function walk(buf, start, end, depth) {
  let p = start
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    let hdr = 8
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16 }
    if (size < 8 || p + size > end + (1 << 20)) break
    console.log('  '.repeat(depth) + type + ' (' + size + ')')
    if (['moov','trak','mdia','minf','stbl','edts','mvex','dinf'].includes(type)) walk(buf, p + hdr, p + size, depth + 1)
    if (type === 'mvhd') { const v = buf[p+hdr]; let o = p+hdr+4; let ts,d; if (v===1){o+=16;ts=buf.readUInt32BE(o);d=Number(buf.readBigUInt64BE(o+4))}else{o+=8;ts=buf.readUInt32BE(o);d=buf.readUInt32BE(o+4)} console.log('  '.repeat(depth+1)+`timescale=${ts} duration=${d} (${(d/ts).toFixed(3)}s)`) }
    if (type === 'mdhd') { const v = buf[p+hdr]; let o = p+hdr+4; let ts,d; if (v===1){o+=16;ts=buf.readUInt32BE(o);d=Number(buf.readBigUInt64BE(o+4))}else{o+=8;ts=buf.readUInt32BE(o);d=buf.readUInt32BE(o+4)} console.log('  '.repeat(depth+1)+`timescale=${ts} duration=${d} (${(d/ts).toFixed(3)}s)`) }
    if (type === 'hdlr') console.log('  '.repeat(depth+1)+'handler='+buf.toString('latin1', p+hdr+8, p+hdr+12))
    if (type === 'elst') { const v = buf[p+hdr]; const c = buf.readUInt32BE(p+hdr+4); let o = p+hdr+8; const e = []; for (let i=0;i<c;i++){ let sd,mt; if(v===1){sd=Number(buf.readBigUInt64BE(o));mt=Number(buf.readBigInt64BE(o+8));o+=20}else{sd=buf.readUInt32BE(o);mt=buf.readInt32BE(o+4);o+=12} e.push(`segDur=${sd} mediaTime=${mt}`) } console.log('  '.repeat(depth+1)+'elst: '+e.join(' | ')) }
    if (type === 'stts') { const c = buf.readUInt32BE(p+hdr+4); let o = p+hdr+8; let total=0,samples=0; for(let i=0;i<c;i++){const cc=buf.readUInt32BE(o),dd=buf.readUInt32BE(o+4);total+=cc*dd;samples+=cc;o+=8} console.log('  '.repeat(depth+1)+`stts total=${total} samples=${samples}`) }
    p += size
  }
}
walk(b, 0, b.length, 0)
