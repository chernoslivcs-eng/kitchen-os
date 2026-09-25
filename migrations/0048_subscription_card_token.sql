-- Токен картки mono (план біллінгу mono, задача 1).
--
-- У LiqPay підписка жила на боці провайдера: ми казали «subscribe» і він сам
-- списував щомісяця. У mono такої підписки під нашу модель немає, тому картку
-- тримаємо ми: verification-інвойс токенізує її, а списує наш крон викликом
-- wallet/payment із цим токеном.
--
-- Колонка nullable і без замовчування навмисно: null означає «списувати нічим»
-- — саме за цією ознакою крон і НЕ бере дім у чергу на списання. Скасування
-- підписки ставить сюди null (а сам токен видаляється в mono через
-- DELETE /api/merchant/wallet/card).
ALTER TABLE household_subscription ADD COLUMN IF NOT EXISTS card_token text;

-- Той самий токен, але здобутий ДО того, як у людини зʼявився дім: намір із
-- лендінга. При bind він переїжджає в household_subscription.
ALTER TABLE payment_intent ADD COLUMN IF NOT EXISTS card_token text;
