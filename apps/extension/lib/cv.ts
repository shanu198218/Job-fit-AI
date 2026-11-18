import type { CandidateProfile } from '@jobfit/shared-types';
import { extractSkills } from '../../../packages/matching-engine/src/index.ts';

const maxFileSize = 8 * 1024 * 1024;

export async function parseCv(file: File): Promise<CandidateProfile> {
  if (!/\.(pdf|docx)$/i.test(file.name) || !file.size || file.size > maxFileSize) {
    throw new Error('Choose a PDF or DOCX file up to 8 MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (/\.pdf$/i.test(file.name)) {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Invalid PDF.');
    const [pdf, worker] = await Promise.all([
      import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdf.getDocument({ data: bytes, useWasm: false });
    try {
      const document = await task.promise;
      if (document.numPages > 30) throw new Error('Choose a PDF with at most 30 pages.');
      const pages = [];
      for (let i = 1; i <= document.numPages; i++) {
        const page = await document.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''));
        page.cleanup();
      }
      text = pages.join('\n');
    } finally {
      await task.destroy();
    }
  } else {
    if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('Invalid DOCX.');
    validateArchive(bytes);
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ arrayBuffer: bytes.buffer })).value;
  }
  if (!text.trim()) throw new Error('No readable text found. Choose a text-based PDF or DOCX.');
  return extractProfile(text);
}

function validateArchive(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer);
  const invalid = () => new Error('Invalid or oversized DOCX archive.');
  let end = bytes.length - 22;
  const min = Math.max(0, end - 65_535);
  while (end >= min && (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length)) end--;
  if (end < min) throw invalid();
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  let size = 0;
  if (!count || count > 256) throw invalid();
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalid();
    size += view.getUint32(offset + 24, true);
    if (size > 24 * 1024 * 1024) throw invalid();
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (offset !== end) throw invalid();
}

export function extractProfile(input: string): CandidateProfile {
  const lines = input.slice(0, 80_000).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const evidence = lines.filter(line => !/@|https?:|\b(?:address|phone|email|references|avenue|postal code)\b|(?:\d[\s().+-]*){7,}/i.test(line))
    .filter(line => /\b(?:skills|technologies|tools|stack|languages|fluent|certification|certified|degree|bachelor|master|university|diploma|experience|engineer|developer|designed|built|implemented|project|worked|managed|analyst|maintained|led|delivered|collaborated|tested)\b/i.test(line)
      || extractSkills(line).length > 0)
    .slice(0, 32).map(line => line.slice(0, 260));
  const claim = evidence.join('\n').match(/\b(\d{1,2})\s*\+?\s+years?\s+(?:of\s+)?(?:professional\s+|commercial\s+|relevant\s+)?experience\b/i);
  return { country: '', authorizedCountries: [], experienceYears: claim ? Number(claim[1]) : null, skills: extractSkills(evidence.join('\n')), evidence,
    ...(claim ? { experienceSource: 'CV' as const } : {}) };
}

