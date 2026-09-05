// /profile: одна дорога, дві сторінки. Ознака прапора PROFILE_V2 для клієнта
// — форма відповіді GET /v1/profile (`fields` → v6), окремого ендпоінта
// прапорів нема. Стара сторінка (Profile.tsx) лишається без змін.

import { useEffect, useState } from 'react';
import { api, isProfileV2, type ProfileAnyResponse } from '../../api';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { ProfilePage } from './Profile';
import { ProfileV2 } from './ProfileV2';

export const pickProfilePage = (r: ProfileAnyResponse): 'v1' | 'v2' => (isProfileV2(r) ? 'v2' : 'v1');

export function ProfileRoute() {
  const [res, setRes] = useState<ProfileAnyResponse | 'error' | null>(null);
  useEffect(() => {
    let alive = true;
    api.profileAny().then((r) => { if (alive) setRes(r); }).catch(() => { if (alive) setRes('error'); });
    return () => { alive = false; };
  }, []);
  if (res === null) return <div className="screen-view" style={{ padding: 24 }}><SkeletonRows rows={5} /></div>;
  if (res === 'error' || !isProfileV2(res)) return <ProfilePage />;
  return <ProfileV2 initial={res} />;
}
