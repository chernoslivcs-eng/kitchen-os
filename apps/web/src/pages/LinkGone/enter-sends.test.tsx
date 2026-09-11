// @vitest-environment jsdom
//
// FIXES-V3 №1: Enter у полі пошти надсилає лінк — не лише клік по кнопці.
// Для цього поле мусить лежати у <form>, а відправка форми — викликати ту
// саму дію, що й кнопка. Перевіряються всі три місця з полем пошти для входу:
// лендінг (hero і фінал — один SignInForm) і «лінк застарів / спрацював».
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { SignInForm } from '../Landing/SignInForm';
import { LinkExpiredPage } from './LinkGone';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
const request = vi.fn(async () => {});

beforeEach(() => {
  request.mockClear();
  useAuth.setState({ requestMagicLink: request });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"google":false}', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
});

async function mount(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter>{el}</MemoryRouter>); });
}

/** Набрати пошту і відправити форму так, як це робить Enter у полі. */
async function typeAndSubmit(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const form = input.closest('form');
  expect(form, 'поле пошти лежить у <form>').not.toBeNull();
  await act(async () => { form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

describe('№1 · Enter у полі пошти надсилає лінк', () => {
  it('лендінг: поле у формі, кнопка — submit, відправка форми викликає requestMagicLink', async () => {
    await mount(<SignInForm />);
    const input = host!.querySelector<HTMLInputElement>('input[type="email"]')!;
    expect(input.closest('form')!.querySelector('button[type="submit"]')).not.toBeNull();
    await typeAndSubmit(input, 'dev@local.test');
    expect(request).toHaveBeenCalledWith('dev@local.test', null);
  });

  it('«лінк застарів»: поле у формі, відправка форми надсилає новий лінк', async () => {
    await mount(<LinkExpiredPage />);
    const input = host!.querySelector<HTMLInputElement>('[data-link-email]')!;
    await typeAndSubmit(input, 'dev@local.test');
    expect(request).toHaveBeenCalledWith('dev@local.test');
  });
});
