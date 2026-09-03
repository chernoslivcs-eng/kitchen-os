// Лендинг v5 = перша сторінка входу. Тексти — з канвасу «Лендинг v5 - ланцюг»
// (єдине джерело), розкладки порогів — з «Лендинг v5 - адаптив»:
// ≥1280 як канвас; 768–1279 фрагменти щільніше, без ниток; <768 без сесії,
// стрічки зі снапом замість сіток, таблиця «як зазвичай / тут» — парами.
// Ілюстрації секцій — слоти /landing/ill-*.png (кладуться у public/landing).

import { useState } from 'react';
import { Hero, Mark } from './Hero';
import { useMagicLink } from './useMagicLink';
import styles from './Landing.module.css';

function Ill({ name, h }: { name: string; h: number }) {
  const [gone, setGone] = useState(false);
  return (
    <div className={styles.ill} style={{ height: h }}>
      {!gone && <img src={`/landing/${name}.png`} alt="" style={{ maxHeight: h }} onError={() => setGone(true)} />}
    </div>
  );
}

const Kick = ({ children, tone }: { children: React.ReactNode; tone?: 'amber' | 'dim' }) => (
  <span className={`${styles.kick} ${tone === 'amber' ? styles['kick-amber'] : tone === 'dim' ? styles['kick-dim'] : ''}`}>{children}</span>
);

function Icon({ d }: { d: React.ReactNode }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#58754e" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">{d}</svg>;
}

function FinalForm() {
  const { email, setEmail, error, loading, submit } = useMagicLink();
  return (
    <>
      <form className={`${styles.pill} ${styles['pill-final']}`} onSubmit={submit} noValidate>
        <input type="email" inputMode="email" autoComplete="email" placeholder="Твій email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        <button type="submit" disabled={loading}>{loading ? 'Надсилаю…' : 'Почати з того, що є'}</button>
      </form>
      {error && <div className={`${styles['form-error']} ${styles['form-error-light']}`}>{error}</div>}
    </>
  );
}

export function Landing() {
  const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toSignIn = () => document.getElementById('signin')?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });

  return (
    <div className={styles.page} id="top">
      <Hero still={still} />

      <div className={styles.container}>
        <div id="how" className={styles.sheet}>
          <div className={styles.grip}><span /></div>

          {/* БОЛІ */}
          <section className={styles.sec}>
            <div className={styles['sec-head']}><Kick>ПРОБЛЕМА</Kick><h2 className={styles.h2}>Продукти є. Вечері немає.</h2></div>
            <div className={`${styles.grid3} ${styles.snap}`}>
              <div className={`${styles.tile} ${styles['tile-tall']}`}>
                <Ill name="ill-pain-1" h={240} />
                <div className={styles['tile-text']}><div className={styles.h3}>Не знаєш, що приготувати</div><p>Після робочого дня дивишся в холодильник і намагаєшся скласти вечерю з того, що бачиш. Часто перемагає знайоме — або доставка.</p></div>
              </div>
              <div className={`${styles.tile} ${styles['tile-tall']}`}>
                <Ill name="ill-pain-2" h={240} />
                <div className={styles['tile-text']}><div className={styles.h3}>Купуєш те, що вже є</div><p>Щось стоїть за банкою, щось лежить у морозилці, щось давно відкрите. У магазині про це згадати складно.</p></div>
              </div>
              <div className={`${styles.tile} ${styles['tile-tall']}`}>
                <Ill name="ill-pain-3" h={240} />
                <div className={styles['tile-text']}><div className={styles.h3}>Рецепт знову веде в магазин</div><p>Знайшов страву — бракує трьох інгредієнтів. Замість відповіді на «що приготувати зараз?» отримуєш новий список покупок.</p></div>
              </div>
            </div>
          </section>

          {/* РОЗВОРОТ */}
          <section className={`${styles.sec} ${styles['sec-alt']} ${styles.center}`}>
            <div className={styles.turn}><span className={styles['turn-light']}>Інші додатки починаються з рецепта і ведуть у магазин.</span><span className={styles['turn-bold']}>Kitchen OS починається з твоєї кухні й веде до столу.</span></div>
            <div className={`${styles.grid3} ${styles.left}`}>
              <div className={`${styles.tile} ${styles['tile-paper']}`}>
                <div className={styles['tile-text']}><Kick>01 · ПАМʼЯТАЄ</Kick><div className={styles.h3}>Знає, що вже є</div><p>Що куплено, що відкрите, скільки приблизно залишилось і що варто використати першим.</p></div>
                <div className={styles.pers}><div className={styles.fragl}>
                  <div className={styles['fl-head']}><span className={styles.mono}>ХОЛОДИЛЬНИК</span><span className={styles.mono}>26</span></div>
                  <div className={styles['fl-row']}><span className={`${styles.mono} ${styles.amberInk}`}>d</span><div><span>Помідори</span><span className={styles.mono}>400 г · лежать 3 дні</span></div><span className={`${styles.mono} ${styles.amberInk}`}>3 ДНІ</span></div>
                  <div className={styles['fl-row']}><span className={styles.mono}>f</span><div><span>Фует</span><span className={styles.mono}>160 г · відкрито</span></div></div>
                  <div className={styles['fl-row']}><span className={styles.mono}>f</span><div><span>Пармезан</span><span className={styles.mono}>90 г · відкрито</span></div></div>
                  <div className={styles['fl-row']}><span className={styles.mono}>s</span><div><span>Спагеті</span><span className={styles.mono}>500 г · ціле</span></div></div>
                </div></div>
              </div>
              <div className={`${styles.tile} ${styles['tile-paper']}`}>
                <div className={styles['tile-text']}><Kick>02 · ПРОПОНУЄ</Kick><div className={styles.h3}>Відповідає на «що приготувати зараз?»</div><p>Не сорок рецептів пасти, а конкретна пропозиція під продукти вдома, твій час і побажання.</p></div>
                <div className={`${styles.pers} ${styles['pers-col']}`}>
                  <div className={styles['ask-bubble']}>що на вечерю?</div>
                  <div className={`${styles.fragl} ${styles['fragl-pad']} ${styles.swR}`}>
                    <div className={styles['fl-head']}><span className={styles.mono}>ПРОПОЗИЦІЯ</span><span className={styles.mono}>20 ХВ</span></div>
                    <span className={styles['fl-title']}>Паста з помідорами й фуетом</span>
                    <span className={styles['fl-sub']}>8 з 8 інгредієнтів удома · ≈ 540 ккал</span>
                    <span className={styles['fl-amber']}>Помідори лежать три дні — краще сьогодні</span>
                    <div className={styles['fl-actions']}><span className={styles['btn-dark']}>Взяти в роботу</span><span className={styles['btn-line']}>Уточнити</span></div>
                  </div>
                </div>
              </div>
              <div className={`${styles.tile} ${styles['tile-paper']}`}>
                <div className={styles['tile-text']}><Kick>03 · НЕ ЗАБУВАЄ</Kick><div className={styles.h3}>Після вечері знає, що залишилось</div><p>Ти підтверджуєш приготування — Kitchen OS оновлює кухню. Наступна рекомендація починається вже не з нуля.</p></div>
                <div className={styles.pers}><div className={`${styles.fragl} ${styles['fragl-pad']} ${styles.swB}`}>
                  <div className={styles['fl-head']}><span className={styles.mono}>ПРИГОТОВАНО · ЧТ 19:40</span><span className={styles.stars}>★★★★☆</span></div>
                  <div className={styles['fl-big']}><span>8 з 8</span><span className={styles['fl-sub']}>з того, що було вдома</span></div>
                  <div className={styles['fl-list']}>
                    <div><span>Помідори</span><span className={styles.mono}>400 → 0 г</span></div>
                    <div><span>Фует</span><span className={styles.mono}>160 → 60 г</span></div>
                    <div><span>Пармезан</span><span className={styles.mono}>90 → 60 г</span></div>
                    <div><span>Спагеті</span><span className={styles.mono}>500 → 300 г</span></div>
                  </div>
                  <span className={styles['fl-quote']}>«Фует не пересушувати»</span>
                </div></div>
              </div>
            </div>
          </section>

          {/* ЩО ВМІЄ */}
          <section id="features" className={styles.sec}>
            <div className={styles['sec-head']}><Kick>ЩО ВМІЄ</Kick><h2 className={styles.h2}>Уся кухня — в одному контексті.</h2></div>
            <div className={`${styles.grid4} ${styles.snap}`}>
              <div className={styles.feat}>
                <div className={styles.pers}><div className={`${styles.fragl} ${styles['fl-zones']}`}><span className={styles['zone-on']}>d</span><span>f</span><span>z</span><span>s</span><span>p</span><span>n</span></div></div>
                <Kick>КОМОРА</Kick><div className={styles.h4}>Памʼятає, що в тебе є</div><p>Холодильник, морозилка, комора й усе інше — разом із кількістю та станом продуктів.</p>
              </div>
              <div className={styles.feat}>
                <div className={styles.pers}><div className={`${styles.fragl} ${styles['fl-checks']} ${styles.swR}`}><div><i />Фарш яловичий 500 г</div><div><i />Моцарела 125 г</div></div></div>
                <Kick>НАПОВНЕННЯ</Kick><div className={styles.h4}>Додає без ручного обліку</div><p>Фото полиці, чек, PDF або фраза «купив фарш і моцарелу».</p>
              </div>
              <div className={styles.feat}>
                <div className={styles.pers}><div className={`${styles.fragl} ${styles['fl-timer']} ${styles.swB}`}><span className={styles.mono}>07:42</span><span className={styles.bar}><span /></span></div></div>
                <Kick>ГОТУВАННЯ</Kick><div className={styles.h4}>Веде під час готування</div><p>Кроки й таймери — там само, де ти вибрав страву.</p>
              </div>
              <div className={styles.feat}>
                <div className={styles.pers}><div className={`${styles.fragl} ${styles['fl-nutr']}`}><span>Шакшука на двох</span><span className={styles.mono}>≈ 420 ккал · Б 24 · Ж 14 · В 48</span></div></div>
                <Kick>ПОЖИВНІСТЬ</Kick><div className={styles.h4}>Рахує під твоє завдання</div><p>«Швидкий сніданок на двох приблизно на 400 ккал» — можна сказати саме так.</p>
              </div>
              <div className={styles.feat}>
                <div className={styles.pers}><div className={`${styles.fragl} ${styles['fl-list-sm']} ${styles.swR}`}><div><span>Фета 200 г</span><span className={styles.mono}>89 ₴</span></div><div><s>Оливкова олія</s><span className={`${styles.mono} ${styles.sageInk}`}>ВЖЕ Є</span></div></div></div>
                <Kick>СПИСОК</Kick><div className={styles.h4}>Купуєш тільки те, чого бракує</div><p>Відсутні інгредієнти йдуть у список. Те, що вже є вдома, — ні.</p>
              </div>
              <div className={styles.feat}>
                <div className={styles['memory-row']}><span className={styles['fl-quote']}>«Фует не пересушувати»</span><span className={styles.stars}>★★★★☆</span></div>
                <Kick>ПАМʼЯТЬ</Kick><div className={styles.h4}>Памʼятає, що тобі сподобалось</div><p>Страви, оцінки й твої примітки залишаються для наступного разу.</p>
              </div>
              <div className={styles.feat}>
                <div className={styles['variety-row']}><s>Паста з помідорами</s><span className={styles.mono}>ГОТУВАВ У ВТ</span></div>
                <Kick>РІЗНОМАНІТТЯ</Kick><div className={styles.h4}>Не пропонує одне й те саме</div><p>Те, що готував недавно, відходить на другий план.</p>
              </div>
              <div className={styles.feat}>
                <div className={styles['fast-tag']}><span className={styles.mono}>◷ ПІСТ · ДЕНЬ 12 З 40</span></div>
                <Kick>КАЛЕНДАР</Kick><div className={styles.h4}>Враховує календар</div><p>Плани, свята, пости й інші правила можуть змінювати наступну пропозицію.</p>
              </div>
            </div>
          </section>

          {/* ЗАПЕРЕЧЕННЯ 1 · ОБЛІК */}
          <section id="account" className={`${styles.sec} ${styles['sec-alt']}`}>
            <div className={styles['sec-head2']}>
              <div className={styles['sec-head']}><Kick>ОБЛІК</Kick><h2 className={styles.h2}>Облік, який не треба вести.</h2></div>
              <p className={styles.lead}>Цифрова комора перестає працювати, щойно її доводиться постійно обслуговувати вручну.</p>
            </div>
            <div className={styles.table}>
              <div className={`${styles['t-cell']} ${styles['t-head']}`}><span className={styles.mono}>ЯК ЗАЗВИЧАЙ</span></div>
              <div className={`${styles['t-cell']} ${styles['t-head']} ${styles['t-right']}`}><span className={`${styles.mono} ${styles.sageInk}`}>ТУТ</span></div>
              <div className={`${styles['t-cell']} ${styles['t-old']}`}>Додаєш кожен продукт руками</div>
              <div className={`${styles['t-cell']} ${styles['t-right']}`}>Фото, чек, PDF або звичайна фраза</div>
              <div className={`${styles['t-cell']} ${styles['t-old']}`}>Після кожного готування виправляєш залишки</div>
              <div className={`${styles['t-cell']} ${styles['t-right']}`}>Підтвердив страву — Kitchen OS оновив їх за тобою</div>
              <div className={`${styles['t-cell']} ${styles['t-old']}`}>Одна помилка поступово псує всю базу</div>
              <div className={`${styles['t-cell']} ${styles['t-right']} ${styles['t-split']}`}><span>Якщо система не впевнена — вона показує це, а не вигадує точність</span><span className={styles.conf}><span>томат</span><span className={styles.mono}>60%</span></span></div>
              <div className={`${styles['t-cell']} ${styles['t-old']} ${styles['t-last']}`}>Треба знати все до грама</div>
              <div className={`${styles['t-cell']} ${styles['t-right']} ${styles['t-last']}`}>Достатньо знати стільки, скільки потрібно для нормального рішення</div>
            </div>
          </section>

          {/* ЗАПЕРЕЧЕННЯ 2 · ЧАТ */}
          <section className={`${styles.sec} ${styles.split}`}>
            <div className={styles['sec-head']}>
              <Kick>ЧОМУ НЕ ПРОСТО ЧАТ</Kick>
              <h2 className={styles.h2}>Чат може придумати рецепт. Kitchen OS памʼятає кухню.</h2>
              <p className={styles.lead}>Чат починає з того, що ти написав зараз. Kitchen OS вже знає:</p>
            </div>
            <div className={styles['split-right']}>
              <div className={styles.knows}>
                <div><Icon d={<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M5 10h14" /></>} />що є вдома</div>
                <div><Icon d={<><path d="M7 9h10v11H7z" /><path d="M9 9V6h6v3" /></>} />що відкрите</div>
                <div><Icon d={<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>} />що залишилось після вчорашнього</div>
                <div><Icon d={<path d="M4 6h16M4 12h16M4 18h10" />} />що ти готував останнім часом</div>
                <div><Icon d={<path d="M12 4l2.4 5 5.6.7-4 3.9 1 5.4-5-2.7-5 2.7 1-5.4-4-3.9 5.6-.7z" />} />що тобі сподобалось</div>
                <div><Icon d={<><circle cx="12" cy="12" r="8" /><path d="M6.5 6.5l11 11" /></>} />що тобі не можна або не хочеться їсти</div>
              </div>
              <div className={styles.quoteCard}><div className={styles['quote-text']}>Рецепт закінчується після вечері. Кухня — ні.</div><Ill name="ill-phone" h={170} /></div>
            </div>
          </section>

          {/* ТРИ ПРАВИЛА */}
          <section id="rules" className={`${styles.sec} ${styles['sec-alt']}`}>
            <div className={styles['sec-head']}><Kick>ДОВІРА</Kick><h2 className={styles.h2}>Три правила.</h2></div>
            <div className={styles.grid3}>
              <div className={`${styles.tile} ${styles['tile-paper']} ${styles.rule}`}>
                <Kick tone="dim">01</Kick><div className={styles.h3}>Не вгадує мовчки</div><p>Якщо Kitchen OS у чомусь не впевнений — ти це бачиш.</p>
                <div className={styles['rule-foot']}><span className={styles.conf}><span>томат</span><span className={styles.mono}>ДОМИСЛЕНО 60%</span></span></div>
              </div>
              <div className={`${styles.tile} ${styles['tile-paper']} ${styles.rule}`}>
                <Kick tone="dim">02</Kick><div className={styles.h3}>Не списує за припущенням</div><p>Ти підтверджуєш, що приготував страву. Після цього кухня оновлюється.</p>
                <div className={`${styles['rule-foot']} ${styles['fl-actions']}`}><span className={styles['btn-dark']}>Приготував</span><span className={styles['btn-line']}>Ще ні</span></div>
              </div>
              <div className={`${styles.tile} ${styles['tile-paper']} ${styles.rule}`}>
                <Kick tone="dim">03</Kick><div className={styles.h3}>Алергії — жорсткі. Побажання — гнучкі.</div><p>Те, що небезпечно, не потрапляє в рекомендації. Те, що просто не любиш, можна враховувати мʼякше.</p>
                <div className={`${styles['rule-foot']} ${styles.allergen}`}><span>Креветки, 500 г</span><span className={styles.mono}>АЛЕРГЕН · ОЛЯ</span></div>
              </div>
            </div>
          </section>

          {/* ДІМ */}
          <section id="home" className={`${styles.sec} ${styles.split}`}>
            <div className={styles['sec-head']}>
              <Kick>ДІМ</Kick><h2 className={styles.h2}>Одна кухня. Кілька людей.</h2>
              <p className={styles.lead}>Kitchen OS знає, для кого зараз готує.</p>
              <Ill name="ill-assistant-person" h={260} />
            </div>
            <div className={styles.grid2}>
              <div className={styles.tile}>
                <Kick>СПІЛЬНЕ</Kick><div className={styles['tile-lead']}>Продукти, покупки й календар.</div>
                <div className={styles.feed}>
                  <div><span className={styles.avatar} style={{ background: '#8f5c78', color: '#fff' }}>О</span><span className={styles.dimText}>Оля додала</span><span className={styles.arrow}>→</span><span>Фета 200 г</span></div>
                  <div><span className={styles.avatar} style={{ background: '#c9a86a' }}>Т</span><span className={styles.dimText}>Тарас приготував</span><span className={styles.arrow}>→</span><span>Шакшука · списано 5</span></div>
                  <div><span className={styles.avatar} style={{ background: '#58754e', color: '#f8f9fa' }}>М</span><span className={styles.dimText}>Марта в календар</span><span className={styles.arrow}>→</span><span>Гості в пʼятницю</span></div>
                </div>
              </div>
              <div className={styles.tile}>
                <Kick tone="amber">ОСОБИСТЕ</Kick><div className={styles['tile-lead']}>Смаки, алергії, обране та історія.</div>
                <div className={styles.feed}>
                  <div><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a8483d" strokeWidth="1.4" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M6.5 6.5l11 11" /></svg><span className={styles.dimText}>Не їм</span><span className={styles.arrow}>→</span><span>свинину</span></div>
                  <div><span className={styles['glyph-plum']}>◷</span><span className={styles.dimText}>Піст</span><span className={styles.arrow}>→</span><span>до 19 квітня · тільки пісне</span></div>
                  <div><span className={styles['glyph-amber']}>★</span><span className={styles.dimText}>Люблю</span><span className={styles.arrow}>→</span><span>оливки · частіше в пропозиціях</span></div>
                </div>
              </div>
            </div>
          </section>

          {/* ЦІНА */}
          <section id="price" className={`${styles.sec} ${styles['sec-alt']}`}>
            <div className={styles['sec-head2']}>
              <div className={styles['sec-head']}><Kick>ЦІНА</Kick><h2 className={styles.h2}>Платиш за продукт, а не за рекламу всередині.</h2></div>
              <p className={styles.lead}>Рекомендація залежить від того, що є у твоїй кухні — не від того, який бренд заплатив за місце в ній.</p>
            </div>
            <div className={`${styles.plans} ${styles.snap}`}>
              <div className={`${styles.plan} ${styles['plan-solo']}`}>
                <div className={styles['plan-head']}><Kick tone="dim">ОДНОМУ</Kick></div>
                <Ill name="ill-plan-solo" h={150} />
                <div className={styles.price}><span>$5</span><span>на місяць</span></div>
                <div className={styles['plan-list']}><div><i />Комора, рекомендації, готування</div><div><i />Календар і журнал</div><div><i />Без реклами всередині</div></div>
                <button type="button" className={styles['plan-btn']} onClick={toSignIn}>Почати з того, що є</button>
              </div>
              <div className={`${styles.plan} ${styles['plan-home']}`}>
                <div className={styles['plan-ring']} />
                <div className={styles['plan-head']}>
                  <span className={styles.kick} style={{ color: '#cfd9c4' }}>ДІМ · ДВОЄ І БІЛЬШЕ</span>
                  <div className={styles.avatars}><span style={{ background: '#c99ab4' }}>О</span><span style={{ background: '#c9a86a' }}>Т</span><span style={{ background: '#f6efe0' }}>+</span></div>
                </div>
                <div className={styles['plan-ill-cream']}><Ill name="ill-plan-home" h={150} /></div>
                <div className={styles.price}><span>$7</span><span>на місяць · на всіх</span></div>
                <div className={styles['plan-list']}><div><i />Усе з «Одному» · спільна кухня</div><div><i />Спільний список</div><div><i />Окремі смаки й обмеження для кожного</div></div>
                <button type="button" className={`${styles['plan-btn']} ${styles['plan-btn-cream']}`} onClick={toSignIn}>Почати з того, що є</button>
              </div>
              <div className={`${styles.plan} ${styles['plan-year']}`}>
                <div className={styles['plan-head']}><Kick tone="dim">РІК · ДІМ</Kick><span className={styles.gift}>2 МІСЯЦІ В ПОДАРУНОК</span></div>
                <Ill name="ill-plan-year" h={150} />
                <div className={styles.price}><span>$70</span><span><s>$84</s> · на рік</span></div>
                <div className={styles['plan-list']}><div><i />Усе з тарифу «Дім»</div><div><i />Один платіж на рік</div><div><i />Без реклами всередині</div></div>
                <button type="button" className={styles['plan-btn']} onClick={toSignIn}>Почати з того, що є</button>
              </div>
            </div>
          </section>
        </div>

        {/* ФІНАЛ — поза білою підложкою, на шавлії сторінки */}
        <section className={styles.final}>
          <h2 className={styles['final-h2']}>Що на вечерю — з того, що вже є.</h2>
          <p>Додай кілька продуктів фото, чеком або просто словами. Kitchen OS почне не з анкети й не з каталогу рецептів. Почне з твоєї кухні.</p>
          <FinalForm />
          <footer className={styles.footer}>
            <div className={styles['footer-brand']}>
              <div className={styles.logo}><Mark size={26} /><span>Kitchen<em> OS</em></span></div>
              <span>Кухня, яка памʼятає. Без реклами й проплачених пропозицій усередині.</span>
            </div>
            <div className={styles['footer-col']}><span className={styles.kick} style={{ color: '#cfd9c4' }}>ПРОДУКТ</span><a href="#how">Як це працює</a><a href="#features">Що вміє</a><a href="#price">Ціна</a><a href="#home">Дім</a></div>
            <div className={styles['footer-col']}><span className={styles.kick} style={{ color: '#cfd9c4' }}>ДОВІРА</span><a href="#rules">Три правила</a><a href="#account">Облік</a><span>Приватність</span><span>Умови</span></div>
            <div className={styles['footer-col']}><span className={styles.kick} style={{ color: '#cfd9c4' }}>ЗВʼЯЗОК</span><span>hello@kitchen.os</span><span>Telegram</span><span>Instagram</span></div>
          </footer>
          <div className={styles['footer-bar']}><span className={styles.mono}>© 2026 KITCHEN OS · V1.0</span><span className={styles.mono}>БЕЗ РЕКЛАМИ ВСЕРЕДИНІ</span></div>
        </section>
      </div>
    </div>
  );
}
