import { beforeAll, describe, expect, it } from 'vitest';
import { parseDocument, setInflateSync } from './parse-document';

describe('parseDocument', () => {
  beforeAll(async () => {
    // Register inflateSync using node:zlib
    // Since this test runs in Node (via Vitest), we can dynamically import it.
    // This keeps the test clean and verifies the integration.
    const zlib = await import('node:zlib');
    setInflateSync((data) => zlib.inflateSync(data));
  });

  it('passes through text and md content directly', () => {
    expect(parseDocument('hello world', 'txt')).toBe('hello world');
    expect(parseDocument('# Title\n\nContent', 'md')).toBe('# Title\n\nContent');
  });

  it('falls back to raw content for PDF if it does not look like a base64 PDF', () => {
    expect(parseDocument('hello pdf', 'pdf')).toBe('hello pdf');
  });

  it('falls back to raw content for DOCX if it does not look like a base64 DOCX', () => {
    expect(parseDocument('hello docx', 'docx')).toBe('hello docx');
  });

  it('extracts text from an uncompressed PDF', () => {
    // Construct a mock PDF
    const pdfStr =
      '%PDF-1.4\n' +
      '1 0 obj\n' +
      '<< /Length 40 >>\n' +
      'stream\n' +
      'BT\n' +
      '(Hello PDF World!) Tj\n' +
      'ET\n' +
      'endstream\n' +
      'endobj\n' +
      '%%EOF';
    
    // Convert to base64
    const base64 = Buffer.from(pdfStr, 'latin1').toString('base64');
    const result = parseDocument(base64, 'pdf');
    expect(result).toBe('Hello PDF World!');
  });

  it('extracts text from an uncompressed DOCX (stored ZIP)', () => {
    // Construct a mock DOCX ZIP file with word/document.xml
    const xmlContent = '<w:document><w:body><w:p><w:r><w:t>Hello DOCX World!</w:t></w:r></w:p></w:body></w:document>';
    const xmlBytes = Buffer.from(xmlContent, 'utf-8');
    
    const filename = 'word/document.xml';
    const filenameBytes = Buffer.from(filename, 'utf-8');
    
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // Signature
    header.writeUInt16LE(10, 4); // Version
    header.writeUInt16LE(0, 6); // Flags
    header.writeUInt16LE(0, 8); // Compression method (0 = stored)
    header.writeUInt32LE(0, 10); // Mod time
    header.writeUInt32LE(0, 14); // CRC
    header.writeUInt32LE(xmlBytes.length, 18); // Compressed size
    header.writeUInt32LE(xmlBytes.length, 22); // Uncompressed size
    header.writeUInt16LE(filenameBytes.length, 26); // Filename len
    header.writeUInt16LE(0, 28); // Extra len

    const docxBytes = Buffer.concat([header, filenameBytes, xmlBytes]);
    const base64 = docxBytes.toString('base64');

    const result = parseDocument(base64, 'docx');
    expect(result).toBe('Hello DOCX World!');
  });
});
