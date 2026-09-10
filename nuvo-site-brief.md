# Nuvo — бриф на сайт: лендинг + приложение

Nuvo — двойные инвестиции на токенизированные акции на Robinhood Chain. Сайт делаем **1 в 1 по структуре и стилю** референса IntegratedBio (3 скриншота) в его палитре: зелёный и бежевый. Всё содержимое своё: тексты Nuvo, своё сгенерированное видео, временный знак. Тексты, логотип и видео референса на сайт не переносим.

Скриншоты референса положи в `/reference` (`hero.png`, `steps.png`, `footer.png`) — по ним идёт сверка. В код они не попадают. Координаты ниже даны для окна 1905×927; значения с «≈» подгоняем на глаз.

## ⚠️ Главное ограничение этапа: никакого бэкенда

Порядок жёсткий: сначала готовый сайт под рабочий мейннет-продукт, потом отдельным этапом — контракты и весь бэкенд.

На этом этапе **не создавать**:

- контракты, `.sol`, Hardhat, Foundry, скрипты деплоя;
- `app/api/*`, server actions, которые пишут данные, собственные серверные эндпоинты;
- базы данных, ORM, миграции;
- индексаторы, кроны, воркеры, очереди;
- сервис котировок маркетмейкеров, серверную авторизацию, прокси для RPC и цен.

Что делаем вместо этого:

- весь фронтенд в финальном виде: все экраны, состояния и тексты;
- слой-адаптер с `MockClient` на демо-данных, в интерфейсе видна плашка `Demo data`;
- `ChainClient` — пустая заготовка с TODO;
- `abi.ts` — только TypeScript-типы и черновик ABI.

Если задача кажется невыполнимой без бэкенда — остановиться и спросить.

Сеть по умолчанию — мейннет Robinhood Chain; параметры сети, адрес USDG и адреса стоков берутся из env. Никаких тестнет-кранов и тестнет-плашек.

## 1. Что такое Nuvo

Продукт — это тикер + направление + целевая цена + недельный срок. Премия фиксируется при подписке и платится **в обоих исходах**. Меняется только то, в каком активе ты её получишь.

**Buy Low.** Кладёшь USDG, цель ниже рынка.
- Пятничное закрытие на цели или ниже: получаешь стоки по целевой цене, `D × (1 + r) / K` токенов.
- Выше цели: получаешь `D × (1 + r)` USDG.

**Sell High.** Кладёшь стоки, цель выше рынка.
- Закрытие на цели или выше: получаешь `Q × K × (1 + r)` USDG.
- Ниже цели: получаешь `Q × (1 + r)` стоков.

Обозначения: `D` — сумма в USDG, `Q` — количество стоков, `K` — целевая цена, `r` — премия за срок.

Расписание и правила (всё в конфиге, значения согласовать):

- подписка — с открытия рынка в понедельник до четверга 16:00 ET;
- экспирация — пятница 16:00 ET;
- расчёт — по референсу Chainlink на пятничном закрытии, не по цене пула;
- лестница целей: Buy Low −2 / −4 / −6 / −8%, Sell High +2 / +4 / +6 / +8% от текущего референса;
- досрочного выхода нет: депозит заблокирован до расчёта;
- если референс не обновился за N часов после экспирации — расчёт по первой свежей цене.

Количество стоков в UI показываем с учётом `uiMultiplier()` (ERC-8056).

Правила текстов:

- не писать guaranteed, risk-free, first, only;
- не выдумывать числа на лендинге;
- не намекать на связь с Robinhood Markets;
- никаких логотипов компаний — только тикеры.

Риск формулируем честно: в Buy Low можно получить акцию по цене выше рынка, в Sell High — упустить рост выше цели.

## 2. Стек и структура

Next.js (App Router) + TypeScript + Tailwind CSS v4. Анимации — `motion` (`motion/react`). Кошелёк — `wagmi` + `viem` + RainbowKit.

Шрифты через `next/font`:

- **Inter Tight** — заголовки и текст. Ближайшая бесплатная замена платному неогротеску референса.
- **Geist Mono** (пакет `geist`) — подписи, кнопки, счётчики; капсом, как у референса.

```
app/  layout.tsx  page.tsx  app/page.tsx  app/[ticker]/page.tsx  app/positions/page.tsx  icon.svg  terms/  risk/
components/  landing/{Header,Hero,Steps,Products,Footer,VideoBackground}.tsx  ui/{Mark,SplitButton,Chip,Counter}.tsx  app/…
lib/nuvo/  types.ts  client.ts  mock.ts  chain.ts  abi.ts  schedule.ts  config.ts
public/video/  bg-loop.mp4  bg-loop.webm  bg-poster.webp
reference/     скриншоты, не импортировать
```

## 3. Токены

### Цвета (сняты пипеткой)

| Токен | Hex | Где |
|---|---|---|
| `page` | #F7F7F5 | фон страницы вокруг hero, светлая секция |
| `ink` | #222F30 | тёмная кнопка, текст на светлом |
| `ink-text` | #243131 | пункты навигации |
| `lime` | #CEF79E | стрелочная часть кнопки |
| `lime-ink` | #445746 | стрелка на лайме |
| `nav` | #E9EBE6 | плашка навигации (≈ белый 85% + blur) |
| `plate` | #CCD0CF | плашка под логотипом после скролла (≈ белый 75% + blur) |
| `chip` | #1E2E26 | фон чипа-метки на видео (≈ rgba(20,35,28,.75)) |
| `dot` | #A7E26E | зелёный квадрат в чипе |
| `dim` | #4C5954 | «/ 03» в счётчике |
| `strip` | #EEEEEE | низ светлой секции над футером |
| `hair` | rgba(255,255,255,.22) | тонкие линии на видео |

Текст на видео — белый.

### Типографика (оценка по скриншотам)

| Роль | Шрифт | Размер | LH | Трекинг |
|---|---|---|---|---|
| H1 hero | Inter Tight 400 | 116px | 0.96 | −0.045em |
| Лид hero | Inter Tight 400 | 26px | 1.12 | −0.03em |
| Текст шага (секция 2) | Inter Tight 400 | 56px | 1.14 | −0.03em |
| Заявление в футере | Inter Tight 400 | 40px | 1.25 | −0.03em |
| Ссылки футера | Inter Tight 400 | 19px | 1.55 | −0.02em |
| Гигантское слово в футере | Inter Tight 500 | по ширине контейнера | 0.8 | −0.06em |
| Моно: навигация, кнопки, чипы, счётчик, копирайт | Geist Mono 500, капс | 13–14px | 1 | 0.02em |

### Сетка, радиусы

- Контейнер 1524px (на 1905 — x 191–1714), боковые поля на узких экранах 24px.
- Окно hero — отступ 12px от краёв окна браузера, радиус 24.
- Плашка навигации — радиус 10, внутренний отступ 4; активная кнопка внутри — радиус 6.
- Кнопки — радиус 8.
- Светлая секция — нижние углы 40.
- Чипы — радиус 6, счётчик — 999.

## 4. Фон — сгенерированное видео

Фон всего сайта — одно зацикленное видео, не код.

- **Слой.** `<video autoplay muted loop playsinline preload="metadata" poster>` в фиксированном слое на весь экран (`position: fixed; inset: 0; object-fit: cover; z-index: -1`). Секции поверх прозрачные, кроме светлой секции (6.4).
- **Окно hero.** На загрузке видео видно через скруглённое окно с отступом 12px и радиусом 24 — вокруг цвет `page`, как на скрине hero. При скролле первых ≈40vh окно раскрывается на весь экран: отступ 12 → 0, радиус 24 → 0. Делаем через `clip-path: inset(... round ...)` от `useScroll`.
- **Затемнение.** Над видео — градиент `rgba(10,22,16,.25)` к прозрачному, сильнее слева сверху. На референсе белый текст местами ложится на светлые места, у нас он должен читаться везде. На секции шагов — затемнение плотнее (.35).
- **Файлы.** MP4 (H.264) и WebM (VP9), 1920×1080 или больше, без звука, до ≈6 МБ каждый. Постер — первый кадр в WebP.
- **Фолбэки.** При `prefers-reduced-motion` и при `saveData` — только постер. Когда вкладка скрыта — пауза.

**Бесшовная петля.** Генераторы редко дают идеальный цикл, поэтому склеиваем кроссфейдом конца в начало. Пример для клипа длиной `D` = 8 с:

```
ffmpeg -i in.mp4 -filter_complex "[0:v]trim=0:1,setpts=PTS-STARTPTS[h];[0:v]trim=1,setpts=PTS-STARTPTS[b];[b][h]xfade=transition=fade:duration=1:offset=6[v]" -map "[v]" -an -c:v libx264 -crf 24 -pix_fmt yuv420p bg-loop.mp4
```

(`offset = D − 2`). WebM — тем же фильтром с `-c:v libvpx-vp9 -b:v 0 -crf 34`.

**Промт для Gemini (основной):**

```
Extreme macro shot of smooth organic forms made of frosted glass and satin: wide curved sheets and ribbons that bend and overlap like pages slowly turning. Palette: sage green, pale mint, warm beige, deep forest-green shadows, thin bronze-brown highlights along the edges. Very shallow depth of field, creamy bokeh, soft diffused light, subtle film grain. The camera drifts slowly and continuously in one direction; nothing enters or leaves the frame abruptly, no cuts, no flashes. Calm, premium mood. The upper-left third of the frame stays soft and low in contrast, because a large white headline will sit there; the lower-left corner stays calm for a line of text. No text, no logos, no people, no hands. 16:9, 8 seconds, the last frame as close as possible to the first.
```

**Вариант потемнее** (если основной слишком светлый под белый текст) — тот же промт, но палитру заменить на: `deep forest green and dark emerald dominate, with sage-green and warm beige surfaces catching soft light, bronze edges`.

Выбираем один клип на весь сайт. Видео референса не скачиваем и не повторяем кадр в кадр — генерируем своё в том же настроении.

## 5. Временный знак

Логотипа пока нет. Знак — контурный круг, пересечённый горизонтальной линией чуть ниже центра: «уровень», на котором исполняется продукт. Всё через один компонент `<Mark/>`, чтобы финальный логотип менялся в одном файле.

```svg
<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
  <circle cx="16" cy="16" r="12"/>
  <line x1="2" y1="18.5" x2="30" y2="18.5" stroke-linecap="round"/>
</svg>
```

Локап: знак 26px + отступ 10px + слово `Nuvo` (Inter Tight 400, 26px, трекинг −0.03em). На hero — белый. После скролла — `ink` на плашке `plate`, как на скрине шагов.

## 6. Лендинг

### 6.1 Шапка (фиксированная, поверх всего)

| Элемент | Позиция | Детали |
|---|---|---|
| Локап | x 191, центр по y ≈55 | после выхода из hero появляется плашка `plate` 204×54, радиус 10, с blur |
| Навигация | справа, x 1349–1714, y 29–82 | плашка `nav`, пункты Geist Mono 14px `ink-text` |

Пункты навигации: `HOW IT WORKS` · `PRODUCTS` · активная кнопка `LAUNCH APP` (фон `ink`, белый текст, ведёт в `/app`).

### 6.2 Hero (100vh, окно видео из раздела 4)

H1 слева сверху, x 191, верх заглавных ≈165, две строки через ≈112px:

> Name your price.
> Get paid to wait.

Лид внизу слева, x 191, низ ≈882, max-width 620:

> Dual investment on tokenized stocks. Buy below the market or sell above it, with a premium either way.

Кнопка-пара справа внизу (правый край 1714, y 836–884) — компонент `SplitButton`:
- тёмная часть `LAUNCH APP` (≈211×48);
- лаймовый квадрат 50×48 со стрелкой →;
- зазор 2px, стык скошен «/» (правый край тёмной и левый край лаймовой части под углом ≈8px, через `clip-path`).

### 6.3 How it works — закреплённая секция из трёх шагов

Секция закреплена на 3 × 100vh, шаги меняются скроллом.

| Элемент | Позиция | Детали |
|---|---|---|
| Чип | x 191, y 117, 126×30 | фон `chip`, квадрат `dot` 8px, Geist Mono 13px белым: `HOW IT WORKS` |
| Линия | на всю ширину, y 191 | 1px `hair`; белый отрезок слева растёт на 1/3 ширины за шаг |
| Счётчик | x 191, y 224, 96×40 | контур 1px белый .4; `01` белым, `/ 03` цветом `dim` |
| Текст шага | x 712, верх ≈232, ширина ≈850 | 56px белым |

Шаги:

1. `Pick a stock token and a direction. Buy Low sets a price under the market, Sell High sets one above it, and every product runs for one week.`
2. `The premium is fixed the moment you subscribe. It is paid on top of your deposit at settlement, whichever way the stock moves.`
3. `Settlement uses the Chainlink reference at Friday's close. Reach your price and you convert; fall short and you keep what you put in.`

### 6.4 Products — светлая секция (на скринах её нет, делаем в том же стиле)

Фон `page`, нижние углы 40, наезжает на футер. Внутри:

- чип `PRODUCTS` (светлый вариант: фон #E9EBE6, текст `ink`);
- заголовок 56px `ink`: `Two products. One decision.`;
- две белые карточки, радиус 16. В каждой — моно-подписи `YOU DEPOSIT` / `IF FRIDAY CLOSES AT YOUR PRICE` / `IF IT DOESN'T` и ответы 20px:
  - **Buy Low:** USDG / the stock at your price + premium / your USDG + premium;
  - **Sell High:** your stock / USDG at your price + premium / your stock + premium.
- под карточками строка 15px: `Your deposit is locked until settlement.`
- `SplitButton` `LAUNCH APP`.

Никаких чисел премий на лендинге.

### 6.5 Футер (раскрывается из-под светлой секции)

Футер фиксирован под контентом: светлая секция уезжает вверх, открывая его. На скрине футера сверху виден низ светлой секции — полоса `strip` со скруглёнными нижними углами.

| Элемент | Позиция | Детали |
|---|---|---|
| Заявление | x 191, y ≈160–255, max-width 700 | 40px белым: `Target prices for tokenized stocks, settled every Friday on Robinhood Chain.` |
| Кнопка | x 191, y 296 | `SplitButton` `LAUNCH APP` |
| NAVIGATE | x 1081, верх 155 | левая граница 1px `hair`, отступ 20; ссылки: How it works / Products / App |
| CONNECT | x 1374, верх 155 | ссылки: X / Telegram (заглушки) |
| Наверх | x 1667, y 157, ⌀48 | контурный круг 1px белый .4, стрелка ↑ |
| Слово `Nuvo` | во всю ширину контейнера | через SVG `<text textLength>`, чтобы точно заполнить ширину; низ букв на ≈40px выше копирайта |
| Копирайт | x 191, низ −30 | Geist Mono 13px капсом: `© 2026 NUVO. ALL RIGHTS RESERVED.` |

Вторая строка копирайта (согласовать): `NOT AFFILIATED WITH ROBINHOOD MARKETS. NOT AVAILABLE IN THE US AND OTHER RESTRICTED JURISDICTIONS.`

## 7. Анимации

Движение фона на скринах не видно, остальное — по нашему выбору, сдержанно.

- **Загрузка.** Строки H1 выезжают из-под маски снизу, 0.9s, шаг 0.12s. Шапка, лид и кнопка — fade 0.6s после.
- **Окно hero.** Раскрывается по скроллу (раздел 4).
- **Плашка логотипа.** Появляется fade 0.3s после выхода из hero.
- **Шаги.** При смене шага текст уходит вверх и растворяется, новый приходит снизу, 0.6s. Счётчик меняется так же. Отрезок линии растёт плавно.
- **Products.** Карточки — fade-up 0.7s, шаг 0.1s.
- **Футер.** Буквы гигантского слова поднимаются по одной при раскрытии, 0.8s, шаг 0.05s.
- **Ховеры.**
  - `SplitButton`: стрелка сдвигается на 3px вправо, тёмная часть светлеет до #2C3B3C, 0.2s.
  - Пункты навигации: фон #DDE0DA.
  - Ссылки футера: подчёркивание.
- **Reduced motion.** Только fade 0.2s, без масок и сдвигов.

## 8. Приложение

Приложение — те же токены на фоне `page`, без видео. Карточки белые, радиус 16. Основная кнопка — `SplitButton`. Buy Low помечаем `lime`, Sell High — бежевым ≈#E3D9CB. Цифры — `tabular-nums`.

Шапка приложения: локап (→ `/`), `Products` · `Positions`, справа `Connect wallet` (после подключения — адрес и баланс USDG). В режиме `mock` — плашка `Demo data`. Под шапкой — плашка недели: `Week of Sep 14–18` · `Subscriptions close Thu 4:00 PM ET` · отсчёт.

**`/app` — Products.**
- Переключатель `Buy Low` / `Sell High`.
- Таблица тикеров: тикер, референсная цена, лестница целей чипами — у каждого цель и премия за неделю (`1.2% · est. 62% APR`).
- Клик по чипу ведёт на страницу тикера с выбранной целью.
- Поиск по тикеру. На мобиле — карточки.

**`/app/[ticker]` — подписка.**

Слева:
- цена и мини-график (демо);
- блок исходов с живыми цифрами из суммы: `If Friday closes at or below $K: you get X NVDA` / `If it closes above: you get Y USDG`;
- правила (расчёт по Chainlink, депозит заблокирован, досрочного выхода нет);
- блок рисков.

Справа — панель:
- направление;
- лестница целей;
- сумма (USDG для Buy Low, стоки для Sell High), баланс и `Max`;
- премия;
- кнопка.

**`/app/positions`.** Вкладки:
- `Active` — до расчёта;
- `Settled` — с кнопкой `Claim`;
- `History`.

Пустое состояние: `No positions yet. Pick a product.`

Состояния кнопки подписки:

| Состояние | Кнопка / сообщение |
|---|---|
| Кошелёк не подключён | `Connect wallet` |
| Не та сеть | `Switch network` |
| Нет суммы | неактивна, `Enter an amount` |
| Не хватает средств | неактивна, `Not enough USDG in your wallet` (или тикера) |
| Нужен approve | `Approve USDG` / `Approve NVDA` |
| Котировка устарела (старше 30s) | `Refresh quote` |
| Готово | `Subscribe` |
| В пути | `Confirming…`, тост со ссылкой в explorer |
| Успех | тост `Subscribed`, позиция в Active |
| Ошибка / отмена | `Transaction rejected in wallet` / `Transaction failed. Try again.` |
| Подписка закрыта | неактивна, `Subscriptions are closed. Next week opens Monday.` |

При первом входе в `/app` — модалка с подтверждением юрисдикции и рисков (текст-заглушка, согласовать). Страницы `/terms` и `/risk` — заглушки.

## 9. Слой данных

`NuvoClient`:

- `getWeek()`
- `listProducts(direction, ticker?)`
- `getQuote(productId, amount)` → премия и срок жизни котировки
- `approve(token, amount)`
- `subscribe(productId, amount, quote)`
- `getPositions(address)`
- `claim(positionId)`

Режим — `NEXT_PUBLIC_NUVO_MODE=mock|chain`. `MockClient` отдаёт детерминированные демо-котировки, транзакции с задержкой 1.5s. В `mock` есть кнопка разработчика «перемотать неделю», чтобы проверить расчёт и `Claim`.

Черновик интерфейса контракта — чтобы следующий этап совпал с UI. Правки должны оставаться в `chain.ts` и `abi.ts`:

```solidity
interface INuvoDual {
    enum Direction { BuyLow, SellHigh }
    enum Status { Open, Locked, Settled }

    function subscribe(bytes32 productId, uint256 amount, bytes calldata signedQuote)
        external returns (uint256 positionId);
    function claim(uint256 positionId) external returns (address token, uint256 amount);

    function product(bytes32 productId) external view returns (
        bytes32 ticker, Direction direction, uint256 targetPrice,
        uint64 expiry, Status status, int256 settlePrice
    );
    function positionsOf(address user) external view returns (uint256[] memory);

    event Subscribed(uint256 indexed positionId, address indexed user, bytes32 indexed productId,
        uint256 amount, uint256 premiumBps);
    event Settled(bytes32 indexed productId, int256 settlePrice, bool converted);
    event Claimed(uint256 indexed positionId, address token, uint256 amount);
}
```

`signedQuote` — подписанная котировка маркетмейкера, её будет выдавать сервис котировок на этапе бэкенда. Сейчас её генерирует `MockClient`.

## 10. Адаптив и доступность

- **<1024.** Шаги не закрепляются: три блока подряд, текст 34px во всю ширину. Карточки Products — в колонку. Колонки футера — стопкой.
- **<768.**
  - H1 52px; лид 18px.
  - `SplitButton` на всю ширину.
  - Окно hero с отступом 8.
  - Навигация сворачивается в кнопку `MENU`, выпадает плашкой.
  - Для видео можно добавить вертикальную версию 1080×1920 через `<source media>`.
- **Доступность.**
  - Один `h1`.
  - Видео `aria-hidden`.
  - Фокус — 2px `lime` с отступом 3px.
  - Контраст белого текста обеспечивает затемнение из раздела 4 — проверить на самых светлых кадрах.

## 11. Приёмка

1. Скриншоты Playwright на 1905×927 в положениях референса: hero, шаг 01, футер. Наложить на `/reference` с прозрачностью 50%: положения ±6px, цвета — по разделу 3.
2. Видео: петля без рывка, вес ≤6 МБ, постер показывается до загрузки, при reduced motion видео не играет.
3. В режиме `mock` проходится полный путь: подключить кошелёк, выбрать продукт, подписаться, перемотать неделю, увидеть оба исхода, `Claim`.
4. Все состояния кнопки из раздела 8 воспроизводятся.
5. Нет ни текстов, ни логотипа, ни видео референса. В репозитории нет контрактов, `app/api` и серверного кода, который хранит данные.
6. 390×844 и 834×1194 без горизонтального скролла.

## 12. Открытые вопросы (заглушки в конфиге)

- модель заработка протокола (спред на премии или комиссия);
- список тикеров;
- лестница целей;
- минимальная и максимальная сумма на продукт;
- окно подписки;
- юридические тексты;
- ссылки на соцсети;
- покупать ли лицензию на платный шрифт вместо Inter Tight.
