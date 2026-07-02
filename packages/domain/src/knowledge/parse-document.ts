let inflateFn: ((data: Uint8Array) => Uint8Array) | undefined;

export function setInflateSync(fn: (data: Uint8Array) => Uint8Array): void {
  inflateFn = fn;
}

function getInflateSync(): (data: Uint8Array) => Uint8Array {
  if (!inflateFn) {
    throw new Error('inflateSync not registered. Call setInflateSync first.');
  }
  return inflateFn;
}

export function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const bytes = new Uint8Array(Math.trunc((len * 3) / 4));

  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const w = lookup[clean.charCodeAt(i)] || 0;
    const x = lookup[clean.charCodeAt(i + 1)] || 0;
    const y = lookup[clean.charCodeAt(i + 2)] || 0;
    const z = lookup[clean.charCodeAt(i + 3)] || 0;

    bytes[p++] = (w << 2) | (x >> 4);
    if (p < bytes.length) bytes[p++] = ((x & 15) << 4) | (y >> 2);
    if (p < bytes.length) bytes[p++] = ((y & 3) << 6) | z;
  }

  return bytes;
}

function decodePdfString(str: string): string {
  const out = str.replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  return out
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\r')
    .replaceAll('\\t', '\t')
    .replaceAll('\\b', '\b')
    .replaceAll('\\f', '\f')
    .replaceAll('\\(', '(')
    .replaceAll('\\)', ')')
    .replaceAll('\\\\', '\\');
}

export function extractTextFromPdf(pdfBytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): string {
  const pdfString = new TextDecoder('latin1').decode(pdfBytes);
  if (!pdfString.startsWith('%PDF')) {
    return new TextDecoder('utf-8').decode(pdfBytes);
  }

  let fullText = '';
  let streamIdx = 0;

  while (true) {
    streamIdx = pdfString.indexOf('stream', streamIdx);
    if (streamIdx === -1) break;

    const dictStart = pdfString.lastIndexOf('<<', streamIdx);
    const dictEnd = pdfString.lastIndexOf('>>', streamIdx);
    if (dictStart === -1 || dictEnd === -1 || dictStart > dictEnd) {
      streamIdx += 6;
      continue;
    }

    const dict = pdfString.slice(dictStart, dictEnd + 2);
    const isFlate = dict.includes('/FlateDecode');

    const endstreamIdx = pdfString.indexOf('endstream', streamIdx);
    if (endstreamIdx === -1) break;

    let dataStart = streamIdx + 6;
    if (pdfString.charCodeAt(dataStart) === 13) dataStart++; // \r
    if (pdfString.charCodeAt(dataStart) === 10) dataStart++; // \n

    let dataEnd = endstreamIdx;
    if (pdfString.charCodeAt(dataEnd - 1) === 10) dataEnd--; // \n
    if (pdfString.charCodeAt(dataEnd - 1) === 13) dataEnd--; // \r

    if (dataStart >= dataEnd) {
      streamIdx = endstreamIdx + 9;
      continue;
    }

    const streamData = pdfBytes.slice(dataStart, dataEnd);

    let decompressed: Uint8Array;
    if (isFlate) {
      try {
        decompressed = inflate(streamData);
      } catch (e) {
        streamIdx = endstreamIdx + 9;
        continue;
      }
    } else {
      decompressed = streamData;
    }

    const decompressedStr = new TextDecoder('utf-8', { fatal: false }).decode(decompressed);

    const btEtRegex = /BT[\s\S]*?ET/g;
    let btEtMatch;
    while ((btEtMatch = btEtRegex.exec(decompressedStr)) !== null) {
      const block = btEtMatch[0]!;

      const tjRegex = /\[([\s\S]*?)\]\s*TJ/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        const arrayContent = tjMatch[1]!;
        const strRegex = /\((.*?)\)/g;
        let strMatch;
        while ((strMatch = strRegex.exec(arrayContent)) !== null) {
          fullText += decodePdfString(strMatch[1]!) + ' ';
        }
      }

      const tjSingleRegex = /\((.*?)\)\s*Tj/g;
      let tjSingleMatch;
      while ((tjSingleMatch = tjSingleRegex.exec(block)) !== null) {
        fullText += decodePdfString(tjSingleMatch[1]!) + '\n';
      }
    }

    streamIdx = endstreamIdx + 9;
  }

  return fullText.trim();
}

function findSequence(bytes: Uint8Array, seq: Uint8Array, start: number): number {
  for (let i = start; i <= bytes.length - seq.length; i++) {
    let match = true;
    for (let j = 0; j < seq.length; j++) {
      if (bytes[i + j] !== seq[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function extractTextFromXml(xml: string): string {
  const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
  let match;
  let text = '';
  while ((match = wtRegex.exec(xml)) !== null) {
    text += decodeXmlEntities(match[1]!) + ' ';
  }
  return text.trim();
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function extractTextFromDocx(docxBytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): string {
  if (docxBytes[0] !== 0x50 || docxBytes[1] !== 0x4b || docxBytes[2] !== 0x03 || docxBytes[3] !== 0x04) {
    return new TextDecoder('utf-8').decode(docxBytes);
  }

  let offset = 0;
  while (offset < docxBytes.length - 30) {
    if (
      docxBytes[offset] === 0x50 &&
      docxBytes[offset + 1] === 0x4b &&
      docxBytes[offset + 2] === 0x03 &&
      docxBytes[offset + 3] === 0x04
    ) {
      const compression = docxBytes[offset + 8]! | (docxBytes[offset + 9]! << 8);
      const compressedSize =
        docxBytes[offset + 18]! |
        (docxBytes[offset + 19]! << 8) |
        (docxBytes[offset + 20]! << 16) |
        (docxBytes[offset + 21]! << 24);
      const filenameLen = docxBytes[offset + 26]! | (docxBytes[offset + 27]! << 8);
      const extraLen = docxBytes[offset + 28]! | (docxBytes[offset + 29]! << 8);

      const filenameBytes = docxBytes.slice(offset + 30, offset + 30 + filenameLen);
      const filename = new TextDecoder('utf-8').decode(filenameBytes);

      const dataStart = offset + 30 + filenameLen + extraLen;
      const dataEnd = dataStart + compressedSize;

      if (filename === 'word/document.xml') {
        const compressedData = docxBytes.slice(dataStart, dataEnd);
        let xmlBytes: Uint8Array;
        if (compression === 8) {
          xmlBytes = inflate(compressedData);
        } else {
          xmlBytes = compressedData;
        }
        const xmlText = new TextDecoder('utf-8').decode(xmlBytes);
        return extractTextFromXml(xmlText);
      }

      offset = dataEnd;
    } else {
      const nextSign = findSequence(docxBytes, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), offset + 1);
      if (nextSign === -1) break;
      offset = nextSign;
    }
  }

  throw new Error('word/document.xml not found in DOCX');
}

export function parseDocument(content: string, type: string): string {
  if (type === 'pdf') {
    if (content.startsWith('JVBERi')) {
      const bytes = base64ToBytes(content);
      return extractTextFromPdf(bytes, getInflateSync());
    }
    return content;
  }
  if (type === 'docx') {
    if (content.startsWith('UEsDB')) {
      const bytes = base64ToBytes(content);
      return extractTextFromDocx(bytes, getInflateSync());
    }
    return content;
  }
  return content;
}
