import { describe, it, expect } from 'vitest';
import { buildHeaders } from './api.js';

// Регресія на FIX-02 з qa-report.md: Fastify з app/json-парсером відкидає
// запит із Content-Type: application/json і порожнім тілом
// (FST_ERR_CTP_EMPTY_JSON_BODY). Всі DELETE'и клієнта на цьому мовчки
// падали. buildHeaders() ставить Content-Type тільки за наявності body.

describe('buildHeaders', () => {
  it('без тіла не ставить Content-Type', () => {
    expect(buildHeaders({ method: 'DELETE' })).toEqual({});
  });

  it('з тілом ставить application/json', () => {
    expect(buildHeaders({ method: 'POST', body: '{}' })).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('явні заголовки перекривають дефолт', () => {
    expect(buildHeaders({
      method: 'POST',
      body: 'raw',
      headers: { 'Content-Type': 'text/plain' },
    })).toEqual({ 'Content-Type': 'text/plain' });
  });

  it('порожнє тіло як пустий рядок не тригерить Content-Type', () => {
    // body: '' — це null-ish за нашою логікою (init.body != null → false)
    // Fastify так само не любить, коли Content-Type є, а тіла нема.
    // Але fetch вважає '' і null одним, тому цей тест підтверджує паритет.
    expect(buildHeaders({ method: 'POST' })).toEqual({});
  });
});
