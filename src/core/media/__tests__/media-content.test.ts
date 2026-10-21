/**
 * Поведение контентного слоя медиа (media-content.ts).
 *
 * Проверяем то, что видит вызывающий код: настоящий формат файла определяется
 * по первым байтам, а не по строке Content-Type; неизвестный тип получает
 * отказ (fail closed); расширение берётся только из карты самого модуля;
 * дефолтный лимит размера остаётся 10 МиБ.
 *
 * Модуль чистый: S3, БД, Redis и часы в нём не участвуют, поэтому мокать
 * нечего — логика файла работает настоящая.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEDIA_CONFIG,
  contentMatchesMagicBytes,
  getExtensionForContentType,
} from '../media-content';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const pdfBytes = Buffer.from('%PDF-1.7\n', 'ascii');

/** ISOBMFF-контейнер: размер бокса, "ftyp" и бренд. */
function isobmff(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp', 'ascii'),
    Buffer.from(brand, 'ascii'),
  ]);
}

describe('contentMatchesMagicBytes: формат по сигнатуре', () => {
  it('принимает файл, когда подпись совпадает с объявленным типом', () => {
    expect(contentMatchesMagicBytes('image/jpeg', jpegBytes)).toBe(true);
    expect(contentMatchesMagicBytes('image/png', pngBytes)).toBe(true);
    expect(contentMatchesMagicBytes('application/pdf', pdfBytes)).toBe(true);
  });

  it('узнаёт HEIC/HEIF по ISOBMFF-бренду и не путает его с обычным MP4', () => {
    expect(contentMatchesMagicBytes('image/heic', isobmff('heic'))).toBe(true);
    expect(contentMatchesMagicBytes('image/heif', isobmff('mif1'))).toBe(true);
    expect(contentMatchesMagicBytes('image/heic', isobmff('isom'))).toBe(false);
  });

  it('отвергает подмену типа: PNG-байты под видом JPEG и наоборот', () => {
    expect(contentMatchesMagicBytes('image/jpeg', pngBytes)).toBe(false);
    expect(contentMatchesMagicBytes('image/png', jpegBytes)).toBe(false);
  });

  it('отказывает на неизвестном типе, даже если байты выглядят как файл', () => {
    expect(contentMatchesMagicBytes('application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    expect(contentMatchesMagicBytes('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', 'ascii'))).toBe(false);
    expect(contentMatchesMagicBytes('', jpegBytes)).toBe(false);
  });

  it('отвергает обрезанный файл, у которого совпал только короткий префикс', () => {
    expect(contentMatchesMagicBytes('image/png', pngBytes.subarray(0, 4))).toBe(false);
    expect(contentMatchesMagicBytes('application/pdf', Buffer.from('%PDF', 'ascii'))).toBe(false);
    expect(contentMatchesMagicBytes('image/jpeg', Buffer.from([0xff, 0xd8]))).toBe(false);
  });
});

describe('DEFAULT_MEDIA_CONFIG: лимит и согласованность allowlist', () => {
  it('дефолтный лимит размера — 10 МиБ целым числом байт', () => {
    expect(DEFAULT_MEDIA_CONFIG.maxFileSize).toBe(10 * 1024 * 1024);
    expect(Number.isSafeInteger(DEFAULT_MEDIA_CONFIG.maxFileSize)).toBe(true);
  });

  it('каждый разрешённый тип имеет расширение и проходит проверку подписи', () => {
    const validBytes: Record<string, Buffer> = {
      'image/jpeg': jpegBytes,
      'image/png': pngBytes,
      'image/webp': Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP', 'ascii'),
      ]),
      'image/gif': Buffer.from('GIF89a...', 'ascii'),
      'image/heic': isobmff('heic'),
      'image/heif': isobmff('mif1'),
      'image/heic-sequence': isobmff('heix'),
      'application/pdf': pdfBytes,
      'application/msword': Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      [DOCX]: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    };

    const allowed = DEFAULT_MEDIA_CONFIG.allowedContentTypes ?? [];
    expect(allowed.length).toBeGreaterThan(0);

    for (const contentType of allowed) {
      expect(getExtensionForContentType(contentType), `расширение для ${contentType}`).not.toBe('');
      expect(validBytes[contentType], `нет образца подписи для ${contentType}`).toBeDefined();
      expect(
        contentMatchesMagicBytes(contentType, validBytes[contentType]),
        `подпись для ${contentType}`
      ).toBe(true);
    }
  });
});

describe('contentMatchesMagicBytes: дефект проверки ZIP-заголовка', () => {
  it.fails('отвергает ZIP-заголовок с неверным четвёртым байтом', () => {
    // дефект: для .docx сверяются только три байта (PK\x03/05/07), а четвёртый
    // не проверяется. 50 4B 03 07 не является заголовком ZIP (local file
    // header — 03 04, empty archive — 05 06, spanned — 07 08), но проходит.
    expect(contentMatchesMagicBytes(DOCX, Buffer.from([0x50, 0x4b, 0x03, 0x07]))).toBe(false);
  });
});
