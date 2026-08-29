// Абстракція над сховищем байтів. Постгрес тримає метадані (URL, kind, hint),
// байти живуть тут. Для MVP — локальна ФС, у проді — S3-сумісне.
//
// URL повертається як `fs://<basename>` або `s3://<bucket>/<key>` — не HTTP.
// HTTP-подача файлів — окремий шар (nginx перед bucket, або signed URL) — не наша відповідальність.

import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface StoredBytes {
  url: string;
  bytes: number;
}

export interface AttachmentStore {
  put(id: string, buffer: Buffer, content_type: string): Promise<StoredBytes>;
  get(url: string): Promise<{ buffer: Buffer; content_type: string | null }>;
  del(url: string): Promise<void>;
}

// Локальна ФС. Дефолт: <cwd>/storage/attachments/. Перезаписуємо через env.
export class LocalFSStore implements AttachmentStore {
  constructor(private dir: string = resolve(process.env.ATTACHMENT_DIR ?? './storage/attachments')) {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  async put(id: string, buffer: Buffer, content_type: string): Promise<StoredBytes> {
    const ext = extForContentType(content_type);
    const filename = `${id}${ext}`;
    const path = join(this.dir, filename);
    writeFileSync(path, buffer);
    // content_type кодуємо в query — щоб на відновленні знати, як його віддавати
    const url = `fs://${filename}?ct=${encodeURIComponent(content_type)}`;
    return { url, bytes: buffer.byteLength };
  }

  async get(url: string): Promise<{ buffer: Buffer; content_type: string | null }> {
    const parsed = parseFsUrl(url);
    if (!parsed) throw new Error(`bad fs url: ${url}`);
    const path = join(this.dir, parsed.filename);
    if (!existsSync(path)) throw new Error(`file not found: ${path}`);
    return { buffer: readFileSync(path), content_type: parsed.content_type };
  }

  async del(url: string): Promise<void> {
    const parsed = parseFsUrl(url);
    if (!parsed) return;
    const path = join(this.dir, parsed.filename);
    if (existsSync(path)) unlinkSync(path);
  }
}

function parseFsUrl(url: string): { filename: string; content_type: string | null } | null {
  if (!url.startsWith('fs://')) return null;
  const rest = url.slice(5);
  const [filename, query] = rest.split('?', 2);
  if (!filename) return null;
  const content_type = query
    ? new URLSearchParams(query).get('ct')
    : null;
  return { filename, content_type };
}

function extForContentType(ct: string): string {
  if (ct.startsWith('image/jpeg')) return '.jpg';
  if (ct.startsWith('image/png')) return '.png';
  if (ct.startsWith('image/webp')) return '.webp';
  if (ct.startsWith('application/pdf')) return '.pdf';
  if (ct.startsWith('text/')) return '.txt';
  return '';
}

// Vercel Blob — обʼєктне сховище на серверлес-платформі. Vercel filesystem
// read-only (крім /tmp, ефемерне між викликами), тож у проді ми не можемо
// використовувати LocalFS. Використовуємо, коли задано BLOB_READ_WRITE_TOKEN.
//
// Ми зберігаємо ВНУТРІШНІЙ URL виду `blob://<pathname>` у БД (щоб міграція між
// провайдерами була простою — залежність від Vercel-URL захована в цьому шарі).
// Клієнту віддаємо fetch-through `/v1/attachments/:id/bytes`, тому клієнту не
// потрібен прямий доступ до Vercel-URL.
export class VercelBlobStore implements AttachmentStore {
  constructor(private token: string = process.env.BLOB_READ_WRITE_TOKEN ?? '') {
    if (!this.token) throw new Error('BLOB_READ_WRITE_TOKEN not set');
  }

  async put(id: string, buffer: Buffer, content_type: string): Promise<StoredBytes> {
    const { put } = await import('@vercel/blob');
    const ext = extForContentType(content_type);
    const pathname = `attachments/${id}${ext}`;
    // access: 'public' — Vercel не підтримує private; access-контроль у нас на
    // рівні /v1/attachments/:id/bytes (перевіряємо user_id власника). Публічний
    // URL важко-вгадуваний (id — UUIDv4), тож несанкціонований доступ малоймовірний.
    const result = await put(pathname, buffer, {
      access: 'public',
      contentType: content_type,
      token: this.token,
      addRandomSuffix: false,
    });
    // Зберігаємо саме внутрішній URL — pathname достатньо, щоб потім знайти обʼєкт.
    // content_type кодуємо в query, як і LocalFSStore, щоб on-demand відновити його.
    const url = `blob://${pathname}?ct=${encodeURIComponent(content_type)}&public=${encodeURIComponent(result.url)}`;
    return { url, bytes: buffer.byteLength };
  }

  async get(url: string): Promise<{ buffer: Buffer; content_type: string | null }> {
    const parsed = parseBlobUrl(url);
    if (!parsed) throw new Error(`bad blob url: ${url}`);
    // Vercel не має SDK-методу «GET blob by pathname», але зберігає у public URL,
    // який ми запамʼятали у query-параметрі. Fetch тим URL.
    if (!parsed.publicUrl) throw new Error(`blob url missing public reference: ${url}`);
    const res = await fetch(parsed.publicUrl);
    if (!res.ok) throw new Error(`blob fetch failed ${res.status}: ${url}`);
    const ab = await res.arrayBuffer();
    return { buffer: Buffer.from(ab), content_type: parsed.content_type };
  }

  async del(url: string): Promise<void> {
    const parsed = parseBlobUrl(url);
    if (!parsed?.publicUrl) return;
    const { del } = await import('@vercel/blob');
    await del(parsed.publicUrl, { token: this.token });
  }
}

function parseBlobUrl(url: string): { pathname: string; content_type: string | null; publicUrl: string | null } | null {
  if (!url.startsWith('blob://')) return null;
  const rest = url.slice(7);
  const [pathname, query] = rest.split('?', 2);
  if (!pathname) return null;
  const params = query ? new URLSearchParams(query) : null;
  return {
    pathname,
    content_type: params?.get('ct') ?? null,
    publicUrl: params?.get('public') ?? null,
  };
}

// Для тестів — інмемори реалізація. Не пише на диск, живе в мапі.
export class InMemoryStore implements AttachmentStore {
  private mem = new Map<string, { buffer: Buffer; content_type: string }>();

  async put(id: string, buffer: Buffer, content_type: string): Promise<StoredBytes> {
    const url = `mem://${id}`;
    this.mem.set(url, { buffer, content_type });
    return { url, bytes: buffer.byteLength };
  }

  async get(url: string): Promise<{ buffer: Buffer; content_type: string | null }> {
    const entry = this.mem.get(url);
    if (!entry) throw new Error(`not found: ${url}`);
    return { buffer: entry.buffer, content_type: entry.content_type };
  }

  async del(url: string): Promise<void> {
    this.mem.delete(url);
  }
}
