// Порожня розмова за Prototype (Р140), рядок «факт дому» під чіпами. З Р146
// текст приходить із сервера (GET /v1/home-fact: шаблон одразу, модель — у
// фоні); ця логіка живе в @kitchen/domain як шаблон і на клієнті лишається
// fallback на випадок, коли ендпоінт не відповів.
export { homeFactTemplate as homeFact, type HomeFactTemplateInput as HomeFactInput } from '@kitchen/domain/home-fact'; // підшлях: барель домену тягне node:crypto
