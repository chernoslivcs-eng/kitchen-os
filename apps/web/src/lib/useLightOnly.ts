// FIXES-V3 №2: екран поза входом (лендінг, /sent, запрошення, недійсний лінк)
// тримає світлу тему, поки змонтований; на виході повертає тему застосунку
// (ОС або вибір із профілю). Layout-ефект — щоб перший кадр не блимнув темним
// при переході всередині SPA (вихід з акаунта → лендінг).
import { useLayoutEffect } from 'react';
import { setLightOnly } from '../theme';

export function useLightOnly(): void {
  useLayoutEffect(() => {
    setLightOnly(true);
    return () => setLightOnly(false);
  }, []);
}
