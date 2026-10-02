// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { captureSignupSource, getSignupSource, clearSignupSource } from './signup-source';

beforeEach(() => { localStorage.clear(); clearSignupSource(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('джерело реєстрації в браузері', () => {
  it('мічений захід запамʼятовується й читається назад', () => {
    expect(captureSignupSource('?utm_source=Instagram&utm_medium=bio&utm_campaign=launch&utm_content=reel-1&ref=olena'))
      .toEqual({ utm_source: 'instagram', utm_medium: 'bio', utm_campaign: 'launch', utm_content: 'reel-1', ref: 'olena' });
    expect(getSignupSource()).toEqual({ utm_source: 'instagram', utm_medium: 'bio', utm_campaign: 'launch', utm_content: 'reel-1', ref: 'olena' });
    expect(JSON.parse(localStorage.getItem('kos_src')!)).toEqual(getSignupSource());
  });

  it('перший дотик виграє: другий мічений захід не перезаписує', () => {
    captureSignupSource('?utm_source=linkedin&utm_campaign=post');
    expect(captureSignupSource('?utm_source=ads&utm_medium=cpc')).toEqual({ utm_source: 'linkedin', utm_campaign: 'post' });
    expect(getSignupSource()).toEqual({ utm_source: 'linkedin', utm_campaign: 'post' });
  });

  it('захід без міток нічого не кладе і першого дотику не займає', () => {
    expect(captureSignupSource('?next=/app')).toBeNull();
    expect(localStorage.getItem('kos_src')).toBeNull();
    expect(captureSignupSource('?ref=expert')).toEqual({ ref: 'expert' });
  });

  it('захід без міток після міченого теж нічого не стирає', () => {
    captureSignupSource('?utm_source=linkedin');
    captureSignupSource('');
    expect(getSignupSource()).toEqual({ utm_source: 'linkedin' });
  });

  it('у сховище лягає лише вичищене; чужі параметри й пошта не проходять', () => {
    captureSignupSource('?utm_source=News%20Letter&utm_content=john@gmail.com&fbclid=IwAR1&intent=ord_1');
    expect(localStorage.getItem('kos_src')).toBe('{"utm_source":"news_letter"}');
  });

  it('підмінений руками запис чиститься на читанні', () => {
    localStorage.setItem('kos_src', JSON.stringify({ utm_source: 'A B<script>', email: 'x@y.z', utm_medium: 'x'.repeat(100) }));
    expect(getSignupSource()).toEqual({ utm_source: 'a_bscript', utm_medium: 'x'.repeat(64) });
    localStorage.setItem('kos_src', '{не json');
    expect(getSignupSource()).toBeNull();
  });

  it('після clearSignupSource наступний мічений захід знову перший', () => {
    captureSignupSource('?utm_source=linkedin');
    clearSignupSource();
    expect(getSignupSource()).toBeNull();
    expect(captureSignupSource('?utm_source=ads')).toEqual({ utm_source: 'ads' });
  });

  it('приватний режим (запис кидає): мітки живуть до кінця вкладки', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(captureSignupSource('?utm_source=linkedin')).toEqual({ utm_source: 'linkedin' });
    expect(getSignupSource()).toEqual({ utm_source: 'linkedin' });
    expect(captureSignupSource('?utm_source=ads')).toEqual({ utm_source: 'linkedin' });
  });
});
