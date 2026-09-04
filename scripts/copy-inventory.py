#!/usr/bin/env python3
# Інвентар копі Kitchen OS: витягує з TS/TSX рядкові літерали та JSX-текст із
# кирилицею, ігноруючи коментарі. Групує по екранах, рахує слова.
import re, os, sys, json
# Запуск: python3 scripts/copy-inventory.py → docs/copy/<дата>-ui-copy.md
from collections import OrderedDict, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CYR = re.compile(r'[А-Яа-яЇїІіЄєҐґ]')

def strip_comments_keep_lines(src):
    """Прибирає // і /* */ коментарі, не чіпаючи рядки в лапках; зберігає переноси."""
    out = []; i = 0; n = len(src); state = None  # None | "'" | '"' | '`' | 'line' | 'block'
    while i < n:
        ch = src[i]; nxt = src[i+1] if i+1 < n else ''
        if state is None:
            if ch == '/' and nxt == '/': state = 'line'; i += 2; continue
            if ch == '/' and nxt == '*': state = 'block'; i += 2; continue
            if ch in ('"', "'", '`'): state = ch; out.append(ch); i += 1; continue
            out.append(ch); i += 1; continue
        if state == 'line':
            if ch == '\n': state = None; out.append(ch)
            i += 1; continue
        if state == 'block':
            if ch == '*' and nxt == '/': state = None; i += 2; continue
            if ch == '\n': out.append(ch)
            i += 1; continue
        # усередині рядка
        out.append(ch)
        if ch == '\\': out.append(nxt); i += 2; continue
        if ch == state: state = None
        i += 1
    return ''.join(out)

def line_of(text, pos): return text.count('\n', 0, pos) + 1

STR_RE = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`", re.S)
# Текст між тегом і підстановкою теж текст: «СКОРО ЗГОРИТЬ · {…}» ховався від
# старого виразу, який брав лише > … <.
JSX_TEXT_RE = re.compile(r'[>}]([^<>{}]*?)[<{]')
ATTR_RE = re.compile(r'([A-Za-z-]+)=\s*$')

def classify(s, ctx_before):
    m = ATTR_RE.search(ctx_before[-40:])
    attr = m.group(1) if m else None
    if attr == 'placeholder': return 'плейсхолдер'
    if attr in ('aria-label', 'title', 'alt'): return 'підказка'
    if attr in ('label', 'ariaLabel'): return 'підпис'
    if re.search(r'toast|Toast', ctx_before[-80:]): return 'тост'
    if re.search(r'error|Error|throw new', ctx_before[-60:]): return 'помилка'
    if s.upper() == s and CYR.search(s) and len(s) > 3: return 'моно-мітка'
    return 'текст'

def words(s):
    t = re.sub(r'\{[^}]*\}', ' ', s)
    return len([w for w in re.split(r'\s+', t.strip()) if re.search(r'[A-Za-zА-Яа-яЇїІіЄєҐґ0-9]', w)])

def extract(path):
    src = open(path, encoding='utf-8').read()
    clean = strip_comments_keep_lines(src)
    found = []
    for m in STR_RE.finditer(clean):
        s = next(g for g in m.groups() if g is not None)
        if not CYR.search(s): continue
        s2 = s.replace('\\n', ' ').replace("\\'", "'").strip()
        if not s2: continue
        if len(s2) > 320 or re.search(r'\b(const|let|useState|useRef|return|className|import)\b|=>|\);', s2): continue
        # шаблонні вставки позначаємо
        s2 = re.sub(r'\$\{([^}]*)\}', lambda mm: '{' + mm.group(1).strip()[:18] + '}', s2)
        found.append((line_of(clean, m.start()), s2, classify(s2, clean[max(0, m.start()-80):m.start()])))
    if path.endswith('.tsx'):
        for m in JSX_TEXT_RE.finditer(clean):
            s = re.sub(r'\s+', ' ', m.group(1)).strip()
            if not CYR.search(s): continue
            # Ширший вираз [>}]…[<{] ловить і шматки коду: шаблонні рядки з $,
            # атрибути (placeholder="…" style=), тернарники. Це не текст — відсікаємо.
            if re.search(r'[`$\]]|="|=\'|\?\?|\?\.|\s\?\s|\s:\s|^[);,]|\w+=$', s): continue
            # <number>(0) … useState< — дженерики виглядають як JSX-текст
            if len(s) > 320 or re.search(r'\b(const|let|useState|useRef|return|className|import)\b|=>|\);', s): continue
            before = clean[max(0, m.start()-200):m.start()]
            kind = 'кнопка' if re.search(r'<(button|Button)\b[^>]*$', before) else 'текст'
            if s.upper() == s and len(s) > 3: kind = 'моно-мітка'
            found.append((line_of(clean, m.start()), s, kind))
    return found

SCREENS = OrderedDict([
    ('Лендинг (перша сторінка)', ['pages/Landing/']),
    ('Онбординг «Семен»', ['pages/Onboarding/']),
    ('Вхід, лист, запрошення', ['pages/SignIn/', 'pages/MagicLinkSent/', 'pages/Invite/', 'store/auth.ts']),
    ('Стрічка (чат)', ['pages/Feed/Feed.tsx', 'pages/Feed/panel-slots.ts']),
    ('Картки в стрічці', ['pages/Feed/cards.tsx', 'pages/Feed/artifacts.ts', 'pages/Feed/shopping-groups.ts']),
    ('Комора', ['pages/Pantry/', 'store/pantry.ts']),
    ('Рецепти й рецепт', ['pages/Recipes/', 'pages/Recipe/', 'lib/recipe.ts', 'lib/presets.ts']),
    ('Готування', ['pages/Cook/', 'lib/cook-session.ts', 'lib/cook-watch.tsx', 'store/cook.ts', 'lib/speech.ts']),
    ('Журнал готувань', ['pages/CookLog/']),
    ('Список покупок', ['pages/Shopping/']),
    ('Календар і подія', ['pages/Calendar/', 'components/EventArtifact/', 'lib/spans.ts', 'lib/when.ts', 'lib/tone.ts']),
    ('Профіль і дім', ['pages/Profile/']),
    ('Поділитись рецептом', ['pages/Share/', 'pages/SharedRecipe/']),
    ('Адмінка подій', ['pages/Admin/']),
    ('Спільні компоненти', ['components/']),
    ('Каркас і навігація', ['App.tsx', 'main.tsx', 'store/nav.ts', 'store/panel.ts', 'store/session.ts', 'theme.ts', 'pages/NotFound/']),
    ('Службове: одиниці, множина, API-клієнт', ['lib/units.ts', 'lib/plural.ts', 'api.ts']),
])

def screen_for(rel):
    for name, prefixes in SCREENS.items():
        if any(rel.startswith(p) or rel == p for p in prefixes): return name
    return 'Інше'

def main():
    web = os.path.join(ROOT, 'apps/web/src')
    by_screen = defaultdict(list)
    seen = set()
    for dp, _, fns in os.walk(web):
        for fn in sorted(fns):
            if not fn.endswith(('.ts', '.tsx')) or '.test.' in fn or fn.endswith('.d.ts'): continue
            path = os.path.join(dp, fn); rel = os.path.relpath(path, web)
            for line, s, kind in extract(path):
                key = (s, rel)
                if key in seen: continue
                seen.add(key)
                by_screen[screen_for(rel)].append((s, kind, words(s), f'{rel}:{line}'))

    # API: листи + помилки, які доходять до людини
    api = os.path.join(ROOT, 'services/api/src')
    api_rows = []
    for dp, _, fns in os.walk(api):
        for fn in sorted(fns):
            if not fn.endswith('.ts') or 'test' in fn: continue
            path = os.path.join(dp, fn); rel = os.path.relpath(path, api)
            clean = strip_comments_keep_lines(open(path, encoding='utf-8').read())
            if rel == 'mailer.ts':
                seen_mail = set()
                for m in STR_RE.finditer(clean):
                    s = next(g for g in m.groups() if g is not None)
                    if not CYR.search(s) or s.lstrip().startswith('['): continue
                    s2 = re.sub(r'\$\{([^}]*)\}', lambda mm: '{' + mm.group(1).strip()[:18] + '}', s.replace('\\n', ' '))
                    s2 = re.sub(r'<[^>]+>', '', s2).strip()
                    if not s2 or s2 in seen_mail: continue
                    seen_mail.add(s2)
                    api_rows.append((s2, 'лист', words(s2), f'{rel}:{line_of(clean, m.start())}'))
            for m in re.finditer(r"(?:error|message|reason)\s*:\s*(['\"`])((?:(?!\1).)*)\1", clean):
                s = m.group(2)
                if CYR.search(s):
                    api_rows.append((s, 'помилка API', words(s), f'{rel}:{line_of(clean, m.start())}'))

    manifest = json.load(open(os.path.join(ROOT, 'apps/web/public/manifest.webmanifest'), encoding='utf-8'))
    pwa = [(manifest.get('name', ''), 'назва', words(manifest.get('name', '')), 'manifest.webmanifest'),
           (manifest.get('short_name', ''), 'коротка назва', words(manifest.get('short_name', '')), 'manifest.webmanifest'),
           (manifest.get('description', ''), 'опис', words(manifest.get('description', '')), 'manifest.webmanifest')]

    total = sum(len(v) for v in by_screen.values()) + len(api_rows) + len(pwa)
    multi = sum(1 for v in by_screen.values() for r in v if r[2] >= 2) + sum(1 for r in api_rows if r[2] >= 2) + sum(1 for r in pwa if r[2] >= 2)

    out = []
    out.append('# Kitchen OS · інвентар копі\n')
    out.append('Дата зрізу: 2026-09-04, гілка `main`. Джерело — код вебу `apps/web/src`, листи й помилки з `services/api/src`, маніфест PWA. Промпти моделі сюди не входять: це не інтерфейсний текст, а поведінка.\n')
    out.append('Як зібрано: з кожного файлу взято рядкові літерали та JSX-текст із кирилицею, коментарі відкинуто. Кожен рядок один раз на файл. Тип угадано з контексту: `кнопка`, `плейсхолдер`, `підказка` (aria/title/alt), `тост`, `помилка`, `моно-мітка` (капс-підписи), інакше `текст`. Фігурні дужки `{…}` — місце підстановки з коду.\n')
    out.append(f'**Разом: {total} рядків, із них {multi} на два слова й більше.** У кожній секції спершу таблиця «два слова й більше», під нею одним рядком — однослівні.\n')
    out.append('Стовпець «Де» — файл:рядок відносно `apps/web/src` (для API — `services/api/src`). Правити варто в самому файлі; після правки цей документ перегенерується скриптом.\n')

    def section(title, rows):
        if not rows: return
        out.append(f'\n## {title}\n')
        rows_sorted = sorted(rows, key=lambda r: (r[3].split(':')[0], int(r[3].split(':')[1]) if ':' in r[3] and r[3].split(':')[1].isdigit() else 0))
        multi_rows = [r for r in rows_sorted if r[2] >= 2]
        single = [r for r in rows_sorted if r[2] < 2]
        if multi_rows:
            out.append('| № | Текст | Тип | Слів | Де |')
            out.append('|---|---|---|---|---|')
            for i, (s, kind, w, where) in enumerate(multi_rows, 1):
                cell = s.replace('|', '\\|')
                out.append(f'| {i} | {cell} | {kind} | {w} | `{where}` |')
        if single:
            uniq = []
            for s, _, _, _ in single:
                if s not in uniq: uniq.append(s)
            out.append('\nОднослівні: ' + ' · '.join(u.replace('|', '\\|') for u in uniq))

    for name in list(SCREENS.keys()) + ['Інше']:
        section(name, by_screen.get(name, []))
    section('Листи й помилки API (те, що бачить людина)', api_rows)
    section('PWA-маніфест', pwa)

    dest = os.path.join(ROOT, 'docs/copy/2026-09-04-ui-copy.md')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print(dest, total, multi)

main()
