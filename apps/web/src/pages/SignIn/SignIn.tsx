// Етап 9 (лендінг v3): екран SignIn прибрано — «Вхід = лендінг, окремого /signin
// нема» (HANDOFF §7a); маршруту /signin не було вже до цього. Лишається Mark:
// його беруть MagicLinkSent і Invite, які переїдуть на Auth.dc.html наступним
// етапом («Перевір пошту» / «Запрошення в дім») — тоді зникне й ця тека.

export function Mark({ size = 30, color = '#f2f4f0' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="19" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray="104 15" transform="rotate(-58 24 24)" />
      <circle cx="24" cy="24" r="6" fill={color} />
    </svg>
  );
}
