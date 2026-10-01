// Єдине місце зі шляхами до файлів ролика (LANDING-VIDEO-BRIEF-0930). Фінальні
// файли — на Vercel Blob (сховище kitchen-os-attachments, публічне), завантажені
// 30.09 з out/showreel/out/kitchen-os-showreel-{web,loop-8s,poster}.*. CSP
// (vercel.json, media-src) дозволяє *.public.blob.vercel-storage.com.
// 01.10: перерендер фіналу (кнопка «Почати») — новий файл під -v2, старий
// («-web.mp4», без v2) лишається в Blob незайманим через довгий CDN-кеш.
export const VIDEO_FULL = 'https://ua7xxtrdfoin43i7.public.blob.vercel-storage.com/video/kitchen-os-showreel-web-v2.mp4';
export const VIDEO_BUBBLE = 'https://ua7xxtrdfoin43i7.public.blob.vercel-storage.com/video/kitchen-os-showreel-loop-8s.mp4';
export const VIDEO_POSTER = 'https://ua7xxtrdfoin43i7.public.blob.vercel-storage.com/video/kitchen-os-showreel-poster.jpg';
