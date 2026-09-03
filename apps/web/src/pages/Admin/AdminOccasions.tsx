// Адмінка v0 (фаза 4): «день томатів» без деплою.
//
// Свідомо гола. Під цей екран нема макета — і малювати йому вигадану форму
// самому означало б повторити те, за що вже поправляли двічі цього тижня
// («Мене турбують оці типи карточок»). Тому тут лише Input і Button з
// наявної системи, без нового шару рішень: якщо колись з'явиться бриф на
// адмінку, цей файл переписується, а не шліфується.
//
// Немає в TabBar і в шухляді навмисно: не для користувача. Доступ — лише
// прямим посиланням, і сервер відповідає 404 всім, крім пошти з ADMIN_EMAILS
// — той самий 404, що на чужу подію: адмінка не мусить видавати, що вона
// існує.

import { useEffect, useState, type FormEvent } from 'react';
import { api, type AdminOccasion, type AdminOccasionInput } from '../../api';
import { Input } from '../../components/Input/Input';
import { Button } from '../../components/Button/Button';

const empty: AdminOccasionInput = {
  id: '', title: '', meaning: '', rule: { from: '', to: '' },
  buy: [], seeds: [], upcoming_title: '', source: 'Kitchen OS',
};

export function AdminOccasionsPage() {
  const [occasions, setOccasions] = useState<AdminOccasion[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState<AdminOccasionInput>(empty);
  // buy/seeds редагуються рядком через кому — форма тримає масив, людина
  // пише текст; список — окремий стан, синхронізований лише в моменти
  // «почав редагувати» / «почав заново», а не на кожен символ.
  const [buyText, setBuyText] = useState('');
  const [seedsText, setSeedsText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.admin.occasions.list()
      .then(({ occasions }) => setOccasions(occasions))
      .catch(() => setDenied(true));
  };
  useEffect(load, []);

  if (denied) {
    return <div style={{ padding: 24, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)' }}>404</div>;
  }
  if (!occasions) return null;

  const startEdit = (o: AdminOccasion) => {
    setEditingId(o.id);
    setForm({
      id: o.id, title: o.title, meaning: o.meaning, rule: o.rule,
      buy: o.buy, seeds: o.seeds, upcoming_title: o.upcoming_title ?? '', source: o.source,
    });
    setBuyText(o.buy.join(', '));
    setSeedsText(o.seeds.join(', '));
    setErr(null);
  };
  const startNew = () => {
    setEditingId(null);
    setForm(empty);
    setBuyText('');
    setSeedsText('');
    setErr(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const body = {
      ...form,
      buy: buyText.split(',').map((s) => s.trim()).filter(Boolean),
      seeds: seedsText.split(',').map((s) => s.trim()).filter(Boolean),
      upcoming_title: form.upcoming_title || null,
    };
    setBusy(true);
    try {
      if (editingId) await api.admin.occasions.patch(editingId, body);
      else await api.admin.occasions.create(body);
      startNew();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не вийшло');
    } finally {
      setBusy(false);
    }
  };

  const publish = async (id: string, on: boolean) => {
    await (on ? api.admin.occasions.publish(id) : api.admin.occasions.unpublish(id));
    load();
  };
  const remove = async (id: string) => {
    await api.admin.occasions.remove(id);
    if (editingId === id) startNew();
    load();
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h1 style={{ fontFamily: 'var(--font-body)', fontSize: 20, fontWeight: 600, color: 'var(--fg)' }}>
        Адмінка · редакційні події
      </h1>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Input placeholder="id (латиниця-дефіс), напр. tomato-day-2027" value={form.id}
          disabled={!!editingId}
          onChange={(e) => setForm({ ...form, id: e.target.value })} />
        <Input placeholder="назва" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input placeholder="сенс — одне-два речення, модель цитує майже дослівно" value={form.meaning}
          onChange={(e) => setForm({ ...form, meaning: e.target.value })} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Input placeholder="від MM-DD" value={form.rule.from} style={{ width: 120 }}
            onChange={(e) => setForm({ ...form, rule: { ...form.rule, from: e.target.value } })} />
          <Input placeholder="до MM-DD" value={form.rule.to} style={{ width: 120 }}
            onChange={(e) => setForm({ ...form, rule: { ...form.rule, to: e.target.value } })} />
        </div>
        <Input placeholder="варто докупити, через кому" value={buyText}
          onChange={(e) => setBuyText(e.target.value)} />
        <Input placeholder="що з цього варити, через кому" value={seedsText}
          onChange={(e) => setSeedsText(e.target.value)} />
        <Input placeholder="джерело (підпис, видно людині)" value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })} />
        {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" loading={busy}>{editingId ? 'Зберегти правку' : 'Створити чернетку'}</Button>
          {editingId && <Button type="button" variant="text" onClick={startNew}>Скасувати</Button>}
        </div>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {occasions.length === 0 && (
          <div style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Порожньо.</div>
        )}
        {occasions.map((o) => (
          <div key={o.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%',
              background: o.published_at ? 'var(--accent)' : 'var(--fg-dim)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg)' }}>{o.title}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-dim)' }}>
                {o.id} · {o.rule.from}…{o.rule.to} · {o.published_at ? 'опубліковано' : 'чернетка'}
              </div>
            </div>
            <Button type="button" variant="text" size="md" onClick={() => startEdit(o)}>Редагувати</Button>
            <Button type="button" variant="text" size="md" onClick={() => publish(o.id, !o.published_at)}>
              {o.published_at ? 'Зняти' : 'Опублікувати'}
            </Button>
            <Button type="button" variant="text" size="md" onClick={() => remove(o.id)}>Видалити</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
