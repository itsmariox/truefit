// Which characters does a TrueType font actually have? Reads the font's cmap table (formats 4 and 12). Pure, no dependencies.
// Why it matters: when a character is missing, Chrome silently prints it in another system font (arrows fall back to a CFF font, emoji to a colour
// font), and those are stored in the PDF as Type 3, which the ATS check refuses. Better to tell the user which characters to change, up front.
export function fontCoverage(font: Uint8Array): (codePoint: number) => boolean {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = v.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) { const o = 12 + i * 16; if (String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)) === "cmap") cmap = v.getUint32(o + 8); }
  if (cmap < 0) throw new Error("not a TrueType font: no cmap table");
  const n = v.getUint16(cmap + 2);
  let best: { off: number; format: number } | null = null;
  for (let i = 0; i < n; i++) {
    const platform = v.getUint16(cmap + 4 + i * 8), encoding = v.getUint16(cmap + 6 + i * 8), off = cmap + v.getUint32(cmap + 8 + i * 8), format = v.getUint16(off);
    if ((platform === 3 && encoding === 10 && format === 12) || (!best && ((platform === 3 && encoding === 1 && format === 4) || platform === 0))) { if (format === 12 || format === 4) best = { off, format }; }
  }
  if (!best) throw new Error("no usable Unicode cmap in the font");
  const { off, format } = best;
  if (format === 12) {
    const groups = v.getUint32(off + 12);
    return (cp) => { for (let g = 0; g < groups; g++) { const o = off + 16 + g * 12, s = v.getUint32(o), e = v.getUint32(o + 4); if (cp >= s && cp <= e) return v.getUint32(o + 8) + (cp - s) !== 0; } return false; };
  }
  const segX2 = v.getUint16(off + 6), seg = segX2 / 2, endO = off + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
  return (cp) => {
    if (cp > 0xffff) return false;
    for (let s = 0; s < seg; s++) {
      if (cp > v.getUint16(endO + s * 2)) continue;
      const start = v.getUint16(startO + s * 2); if (cp < start) return false;
      const delta = v.getInt16(deltaO + s * 2), ro = v.getUint16(rangeO + s * 2);
      if (ro === 0) return ((cp + delta) & 0xffff) !== 0;
      const gid = v.getUint16(rangeO + s * 2 + ro + (cp - start) * 2);
      return gid !== 0 && ((gid + delta) & 0xffff) !== 0;
    }
    return false;
  };
}
