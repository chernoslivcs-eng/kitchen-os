// Слоти панелі артефактів: куди картка порталить свій підвал і шапку.
// Окремий модуль, бо їх імпортує і cards.tsx, і EventArtifact, а cards.tsx
// імпортує EventArtifact — контексти в самому cards.tsx замкнули б цикл.
import { createContext } from 'react';

export const PanelFootSlot = createContext<HTMLElement | null>(null);
// V7: у смузі максимум ДВІ кнопки. Третя — та, що про навігацію, а не про
// роботу з артефактом («У рецепти», «Поділитись») — переїжджає в шапку
// іконкою. Той самий механізм слота, що й для низу.
export const PanelHeadSlot = createContext<HTMLElement | null>(null);
