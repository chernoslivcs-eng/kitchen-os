import { describe, it, expect } from 'vitest';
import { cleanMark, cleanSignupMarks, signupMarksFromSearch, signupMarksToSearch, SIGNUP_MARK_MAX } from './signup-source.js';

describe('cleanMark', () => {
  it('нижній регістр, пробіли → _, зайві символи геть', () => {
    expect(cleanMark('Instagram')).toBe('instagram');
    expect(cleanMark('  Launch Oct  ')).toBe('launch_oct');
    expect(cleanMark('stories/reel#3?x=1')).toBe('storiesreel3x1');
    expect(cleanMark('expert.olena-k_2')).toBe('expert.olena-k_2');
  });

  it('обрізає до 64 символів', () => {
    expect(cleanMark('a'.repeat(200))).toBe('a'.repeat(SIGNUP_MARK_MAX));
  });

  it('порожнє й не-рядок — не мітка', () => {
    expect(cleanMark('')).toBeNull();
    expect(cleanMark('   ')).toBeNull();
    expect(cleanMark('кирилиця')).toBeNull();
    expect(cleanMark(undefined)).toBeNull();
    expect(cleanMark(42)).toBeNull();
    expect(cleanMark(['a', 'b'])).toBeNull();
  });

  // Розсилки підставляють адресу одержувача в utm_content. Чистка зробила б із
  // неї «john.doegmail.com» — ті самі персональні дані, лише без равлика.
  it('значення з @ відкидає цілком, а не чистить', () => {
    expect(cleanMark('john.doe@gmail.com')).toBeNull();
  });
});

describe('cleanSignupMarks', () => {
  it('бере тільки пʼять відомих ключів', () => {
    expect(cleanSignupMarks({
      utm_source: 'LinkedIn', utm_medium: 'social', utm_campaign: 'launch', utm_content: 'post-1', ref: 'olena',
      utm_term: 'x', fbclid: 'IwAR123', gclid: 'abc', email: 'a@b.c',
    })).toEqual({ utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'launch', utm_content: 'post-1', ref: 'olena' });
  });

  it('порожні мітки не лишають ключів; жодної мітки — null', () => {
    expect(cleanSignupMarks({ utm_source: 'ads', utm_medium: '' })).toEqual({ utm_source: 'ads' });
    expect(cleanSignupMarks({ utm_source: '!!!' })).toBeNull();
    expect(cleanSignupMarks({})).toBeNull();
    expect(cleanSignupMarks(null)).toBeNull();
    expect(cleanSignupMarks('utm_source=x')).toBeNull();
  });
});

describe('signupMarksFromSearch / signupMarksToSearch', () => {
  it('читає мітки з адреси поруч з іншими параметрами', () => {
    expect(signupMarksFromSearch('?utm_source=Instagram&utm_medium=bio&next=%2Fapp&intent=ord_1'))
      .toEqual({ utm_source: 'instagram', utm_medium: 'bio' });
    expect(signupMarksFromSearch('?ref=Expert+Olena')).toEqual({ ref: 'expert_olena' });
  });

  it('без міток — null', () => {
    expect(signupMarksFromSearch('')).toBeNull();
    expect(signupMarksFromSearch('?next=/app')).toBeNull();
  });

  it('туди й назад дає те саме', () => {
    const marks = { utm_source: 'linkedin', utm_campaign: 'launch', ref: 'olena' };
    expect(signupMarksFromSearch(`?${signupMarksToSearch(marks)}`)).toEqual(marks);
    expect(signupMarksToSearch(null)).toBe('');
  });
});
