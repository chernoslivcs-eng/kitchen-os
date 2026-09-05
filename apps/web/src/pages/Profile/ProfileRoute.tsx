// /profile: завантажує GET /v1/profile і рендерить сторінку v6 (ProfileV2).
// Крок 11: стара сторінка (Profile.tsx) і перемикач за формою відповіді
// прибрані — профіль один.

import { useEffect, useState } from 'react';
import { api, type ProfileV2Response } from '../../api';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { ProfileV2 } from './ProfileV2';

export function ProfileRoute() {
  const [res, setRes] = useState<ProfileV2Response | 'error' | null>(null);
  useEffect(() => {
    let alive = true;
    api.profileV2.get().then((r) => { if (alive) setRes(r); }).catch(() => { if (alive) setRes('error'); });
    return () => { alive = false; };
  }, []);
  if (res === null) return <div className="screen-view" style={{ padding: 24 }}><SkeletonRows rows={5} /></div>;
  if (res === 'error') {
    return (
      <div className="screen-view" style={{ padding: 24 }}>
        <p>Профіль не завантажився. Оновити сторінку.</p>
      </div>
    );
  }
  return <ProfileV2 initial={res} />;
}
