repo: chernoslivcs-eng/kitchen-os
branch: main
path: apps/web/src

## Last sync
date: 2026-09-10T18:34:00Z
prev-date: 2026-09-10T10:00:02Z
### Updated in this project
- Prototype: pantry filter rails from pages/Pantry/filter.ts (SORTS / CUTS), calendar month, tabs
- Admin token map (AdminShell.module.css, Pulse.module.css) → HANDOFF.md; Profile 390 filled → Screens
- Package D5: Recipes library + Recipe page (Recipes.tsx, Recipe.tsx) → Screens 1440/390
- Package D4: Profile (ProfileV2.tsx, lib/profile-copy.ts) → Screens: 1440, 390 first day, delete sheet
- Package D3: Calendar (Calendar.tsx two axes, legendLabel rules) → Screens, desktop weeks-as-cards
- Package D2: Profile (ProfileV2.tsx / profile-copy.ts / domain/profile-fields.ts) → Screens
- Package D1: Recipes library + Recipe page (Recipes.tsx / Recipe.tsx) → Screens
- Package C3: Onboarding «Семен» (Kitchen OS - Onboarding.dc.html) from Onboarding.tsx, 11 cards, illustrations semen-01..11
- Package C2: Auth family (Kitchen OS - Auth.dc.html) from SignIn.tsx / MagicLinkSent.tsx / Invite.tsx — RingField dropped, landing language
- Package C1: Landing redesign (Kitchen OS - Landing.dc.html) from Landing.tsx / Hero.tsx, copy verbatim
- Package B: Journal (CookLog.tsx) and SharedRecipe.tsx → Screens
- Package A: PeriodArtifact (series/event) from PeriodArtifact.tsx + lib/period.ts, VoiceWave, GlobalCookAlarm (cook-watch.tsx) → Components
- COPY.md: canon from ErrorState/copy.ts, lib/profile-copy.ts, pages/Feed/cards.tsx; mocks aligned («Не впевнений», «✓ у списку», «N додамо додому», wait phases)
- Recipe artifact panel added to Screens per cards.tsx RecipeLinkCard (Рецепт → · Готувати →)
- Drag-n-drop copy (D1–D3) taken from DropZone/DropCard.tsx: «Зараз прийму», «Ти можеш відпустити. Він не втече.», «Більше 5 за раз не візьму»
- Wait-state copy from Feed.tsx: ДУМАЮ / РОЗБИРАЮ, 45 s → «Ще тримаю» / «Довгий чек, ще тримаю»
- Recreated as-is screens (Current) and redesign directions 1–3, Components, Screens, Responsive, Cook and Share, Errors, Icons, Motion

## Screen map
| Screen | Repo files |
|---|---|
| Current · Стрічка + панель | pages/Feed/Feed.tsx, Feed.module.css, components/ArtifactPanel/*, components/TabBar/*, components/AppHeader/* |
| Current · Комора | pages/Pantry/*, BatchCard.tsx |
| Current · Список / Рецепти / Календар / Профіль | pages/Shopping/*, pages/Recipes/*, pages/Calendar/*, pages/Profile/* |
| Tokens (напрям 1–2) | styles/tokens.css, styles/reset.css, theme.ts |
| Redesign v3 · Chat / Pantry / Cook | Feed.tsx (turns, artifacts, wait states), Pantry, Cook |
| Responsive · D drag-n-drop | components/DropZone/DropCard.tsx, useDropZone.ts, dropzone.test.tsx |
| Components · сліди / чек / стани дії | pages/Feed/cards.tsx, artifacts.ts, lib/card-modes |
| Screens · артефакт «Рецепт» | pages/Feed/cards.tsx (RecipeLinkCard) |
| COPY.md | components/ErrorState/copy.ts, lib/profile-copy.ts, pages/Feed/cards.tsx, Feed.tsx, DropZone/DropCard.tsx |
