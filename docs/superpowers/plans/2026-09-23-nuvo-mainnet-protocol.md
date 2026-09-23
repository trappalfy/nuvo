# Nuvo Mainnet Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поставить на Robinhood Chain контракты изолированных пулов двойных инвестиций и перевести на них готовый сайт, чтобы подписка, расчёт и выплата шли на мейннете без сервера.

**Architecture:** `NuvoPoolFactory` ведёт реестр «токен → пул» и календарь экспираций. `NuvoPool` — по одному на тикер, хранит USDG и токен акции, ведёт три раздельных учёта (инвентарь вкладчиков, депозиты подписчиков, паи) и рассчитывается по цене Chainlink на момент экспирации. `PremiumModel` — неизменяемая таблица премий. Сайт получает всё, что нужно экрану, одним view-вызовом `preview()` и больше не ходит в сервис котировок.

**Tech Stack:** Solidity 0.8.28, Foundry (forge 1.5.1), OpenZeppelin Contracts v5 (SafeERC20, Ownable2Step, ReentrancyGuard), Chainlink AggregatorV3. Фронтенд — Next.js 16 App Router, viem 2, wagmi 2, TypeScript 5.9.

**Spec:** `docs/superpowers/specs/2026-09-23-nuvo-protocol-design.md` — читать вместе с планом.

## Global Constraints

- Solidity ровно `0.8.28`, объявление `pragma solidity 0.8.28;` без `^`. Если компилятор скажет «stack too deep» — включить `via_ir = true` в `foundry.toml`, а не дробить формулы наугад.
- Переводы токенов только через `SafeERC20` (`safeTransfer`, `safeTransferFrom`). Ни `transfer`, ни `send`, ни низкоуровневых вызовов для денег.
- Внутренние вычисления в WAD (1e18). Любое деление округляется вниз, то есть в пользу пула. Остаток остаётся в пуле и принадлежит вкладчикам.
- Десятичные: USDG 6, токен акции 18, фид 8. Контракт читает их у контрактов, а не зашивает. Актив больше чем с 18 десятичными не поддерживается: фабрика такой пул не создаёт.
- Цена фида — за **токен**, множитель ERC-8056 в ней уже учтён. Ни в контракте, ни на сайте `uiMultiplier` в арифметику сумм не входит.
- `settle` и `claim` не останавливаются ничем: ни паузой, ни сменой владельца, ни ролью guardian. Пауза действует только на `subscribe` и `addLiquidity`.
- Ни одна роль не может забрать депозиты подписчиков или свободный инвентарь вкладчиков. Владелец выводит только накопленную комиссию протокола (`feesUsdg`, `feesToken`).
- `MIN_LEAD = 24 hours` строго: подписка идёт в ближайшую экспирацию, до которой осталось **больше** 24 часов. Это в точности правило сайта `now < closesAt`.
- `MAX_FEE_BPS = 2000`, на старте `feeBps = 0`.
- Фронтенд читает окружение только литералами `process.env.NEXT_PUBLIC_*`: Next инлайнит в браузерный бандл только их.
- Фронтенд не добавляет ни одной npm-зависимости и не пересобирает дерево. Только `npm ci`. `package.json` и `package-lock.json` не трогать: прошлая попытка пересчитать дерево сломала сборку.
- Next 16 App Router: `params` — промис (`use(params)`), `useSearchParams` работает только под `Suspense`.
- Коммит после каждой задачи, сообщения в настоящем времени, как в истории репозитория: `feat: …`, `fix: …`, `test: …`.

## Два уточнения к спецификации

Оба всплыли при переводе спецификации в код. Наблюдаемое поведение прежнее, но читать стоит вместе с ней.

1. **Позиция не хранит исход.** В спецификации у позиции есть поля `settled`, `payoutAsset`, `payoutAmount`. В коде их нет: расчётная цена хранится одна на экспирацию, а исход и сумма выводятся при выплате и читаются вью-функцией `positionPayout`. Иначе `settle` пришлось бы обходить все позиции недели, и расчёт дорожал бы с ростом числа подписчиков — при достаточном их числе он перестал бы помещаться в блок, то есть деньги заперло бы именно в тот момент, когда протокол работает хорошо.
2. **Допустимый возраст цены разделён по назначению, а не по часам биржи.** Контракт не знает расписания торгов, а публиковать второй календарь ради этого дорого. Поэтому порогов два: `maxPriceAge` (80 часов) — для подписки и операций вкладчика, он покрывает выходные и праздники; `maxPriceAgeSettle` (6 часов) — для расчёта, и меряется он относительно момента экспирации, а не текущего. Сломавшийся посреди торгового дня фид ловится не порогом, а паузой guardian.

## Review Focus

Пять входных условий, которые спецификация подразумевает, но ни одна задача не проверила бы сама. Тест на каждое добавлен в задачу, которой принадлежит код.

1. `distanceBps >= 10000` на Buy Low даёт страйк 0 и деление на ноль при расчёте конверсии — подписка обязана отклоняться на входе (Задача 5).
2. Подписка ровно в момент отсечки (`expiry - now == 24 hours`) обязана уходить в следующую экспирацию, иначе контракт и сайт расходятся на границе четверга (Задача 5).
3. Фид, вернувший `answer <= 0` или `updatedAt == 0`, обязан отклонять любое чтение цены, а не считать по мусору (Задача 4).
4. Повторный `claim` и `claim` чужой позиции обязаны отклоняться: иначе позиция выплачивается дважды и съедает чужие деньги (Задача 7).
5. `removeLiquidity`, когда вкладчик единственный или когда весь инвентарь заморожен, обязан отклоняться понятной ошибкой, а не делить на ноль и не выдавать замороженное (Задача 4 — вырожденные доли, Задача 5 — замороженный инвентарь).

## File Structure

Контракты живут в `NUVO/contracts/`, отдельным проектом Foundry внутри того же репозитория. Сборка сайта их не видит.

```
contracts/
  foundry.toml              компилятор и remappings
  .env.example              RPC и ключи для скриптов и форк-теста
  lib/                      вендорённые зависимости (forge-std, ds-test, openzeppelin-contracts)
  src/
    NuvoPool.sol            пул на один тикер: инвентарь, подписки, расчёт, выплата, паи
    NuvoPoolFactory.sol     реестр пулов и календарь экспираций
    PremiumModel.sol        неизменяемая таблица премий
    interfaces/
      IAggregatorV3.sol     Chainlink
      IPremiumModel.sol     премия по (направление, расстояние)
      INuvoPoolFactory.sol  то, что пулу нужно от фабрики: nextExpiry
    libraries/
      Units.sol             WAD и перевод десятичных
  test/
    mocks/MockERC20.sol     токен с настраиваемыми десятичными
    mocks/MockFeed.sol      фид с историей раундов
    mocks/MockFactory.sol   календарь без фабрики, для тестов пула
    Units.t.sol
    PremiumModel.t.sol
    NuvoPool.liquidity.t.sol
    NuvoPool.subscribe.t.sol
    NuvoPool.settle.t.sol
    NuvoPool.claim.t.sol
    NuvoPool.admin.t.sol
    NuvoPoolFactory.t.sol
    invariant/PoolInvariants.t.sol
    invariant/PoolHandler.sol
    fork/Mainnet.t.sol
  script/Deploy.s.sol
```

На сайте меняются слой данных (`lib/nuvo/*`), экран подписки, экран позиций, и добавляется раздел вкладчика (`app/app/pool/page.tsx`).

---

### Task 1: Каркас Foundry

**Files:**
- Create: `contracts/foundry.toml`, `contracts/.env.example`, `contracts/test/Smoke.t.sol`
- Create: `contracts/lib/` (вендорённые зависимости)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: ничего.
- Produces: рабочий `forge test` из каталога `contracts/`, remappings `forge-std/`, `ds-test/`, `@openzeppelin/contracts/`.

- [ ] **Step 1: Вендорить зависимости**

Подмодули здесь не годятся: репозиторий собирается на Vercel, и сорвавшийся клон подмодуля уронит деплой сайта. Копируем исходники и снимаем с них `.git`.

```bash
cd /c/Users/chaiz/Desktop/Recess/NUVO
mkdir -p contracts/lib
git clone --depth 1 https://github.com/foundry-rs/forge-std contracts/lib/forge-std
git clone --depth 1 https://github.com/dapphub/ds-test contracts/lib/ds-test
git clone --depth 1 https://github.com/OpenZeppelin/openzeppelin-contracts contracts/lib/openzeppelin-contracts
rm -rf contracts/lib/forge-std/.git contracts/lib/ds-test/.git contracts/lib/openzeppelin-contracts/.git
find contracts/lib/openzeppelin-contracts -mindepth 1 -maxdepth 1 ! -name contracts ! -name LICENSE -exec rm -rf {} +
find contracts/lib/forge-std -mindepth 1 -maxdepth 1 ! -name src ! -name LICENSE-MIT ! -name LICENSE-APACHE -exec rm -rf {} +
find contracts/lib/ds-test -mindepth 1 -maxdepth 1 ! -name src ! -name LICENSE -exec rm -rf {} +
```

- [ ] **Step 2: Конфиг**

`contracts/foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
solc = "0.8.28"
optimizer = true
optimizer_runs = 200
remappings = [
    "forge-std/=lib/forge-std/src/",
    "ds-test/=lib/ds-test/src/",
    "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
]

[fmt]
line_length = 110
```

`contracts/.env.example`:

```bash
# Robinhood Chain mainnet
RPC_URL=https://rpc.mainnet.chain.robinhood.com
# Тестнет, chain id 46630
TESTNET_RPC_URL=
# Ключ деплоера. В мейннете владельцем ставим мультиподпись, не этот адрес.
PRIVATE_KEY=
# Пара для форк-теста: токен акции и его фид из reference-data-directory
FORK_TOKEN=
FORK_FEED=
```

- [ ] **Step 3: Артефакты сборки мимо гита**

В корневом `.gitignore` уже есть `out/`, он закроет и `contracts/out/`. Добавить рядом строку для кеша Foundry:

```
cache/
```

- [ ] **Step 4: Дымовой тест**

`contracts/test/Smoke.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SmokeTest is Test {
    function test_toolchainCompiles() public pure {
        assertTrue(type(IERC20).interfaceId != bytes4(0));
    }
}
```

- [ ] **Step 5: Прогнать**

Run: `cd contracts && forge test -vv`
Expected: PASS, один тест.

- [ ] **Step 6: Коммит**

```bash
cd /c/Users/chaiz/Desktop/Recess/NUVO
git add .gitignore contracts
git commit -m "chore: foundry project for the protocol contracts"
```

---

### Task 2: Единицы, интерфейсы, моки

**Files:**
- Create: `contracts/src/libraries/Units.sol`, `contracts/src/interfaces/IAggregatorV3.sol`, `contracts/src/interfaces/IPremiumModel.sol`, `contracts/src/interfaces/INuvoPoolFactory.sol`
- Create: `contracts/test/mocks/MockERC20.sol`, `contracts/test/mocks/MockFeed.sol`, `contracts/test/mocks/MockFactory.sol`
- Test: `contracts/test/Units.t.sol`
- Delete: `contracts/test/Smoke.t.sol`

**Interfaces:**
- Consumes: каркас из Задачи 1.
- Produces:
  - `library Units { uint256 constant WAD = 1e18; toWad(uint256 amount, uint8 decimals) → uint256; fromWad(uint256 wad, uint8 decimals) → uint256 }`
  - `interface IAggregatorV3 { decimals() → uint8; latestRoundData() → (uint80,int256,uint256,uint256,uint80); getRoundData(uint80) → (uint80,int256,uint256,uint256,uint80) }`
  - `interface IPremiumModel { premiumBps(uint8 direction, uint16 distanceBps) → uint16 }`
  - `interface INuvoPoolFactory { nextExpiry(uint64 minLead) → uint64 }`
  - `MockERC20(string name, string symbol, uint8 decimals)` с `mint(address,uint256)`
  - `MockFeed(uint8 decimals)` с `push(int256 answer, uint256 updatedAt) → uint80` и `latestRound()`
  - `MockFactory` с `setExpiries(uint64[])` и той же `nextExpiry`, что у настоящей фабрики

- [ ] **Step 1: Написать падающий тест**

`contracts/test/Units.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Units} from "../src/libraries/Units.sol";

contract UnitsTest is Test {
    function test_toWadScalesSixDecimals() public pure {
        assertEq(Units.toWad(1_000_000, 6), 1e18);
    }

    function test_toWadLeavesEighteenDecimals() public pure {
        assertEq(Units.toWad(1e18, 18), 1e18);
    }

    function test_fromWadFloors() public pure {
        // 1.9999995 в WAD -> 1.999999 USDG: вниз, в пользу пула
        assertEq(Units.fromWad(1_999_999_500_000_000_000, 6), 1_999_999);
    }

    function test_roundTripNeverGrows() public pure {
        uint256 wad = Units.toWad(Units.fromWad(1_999_999_999_999_999_999, 6), 6);
        assertLe(wad, 1_999_999_999_999_999_999);
    }
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd contracts && forge test --match-path test/Units.t.sol`
Expected: FAIL — `Units.sol` не существует, компиляция не проходит.

- [ ] **Step 3: Реализовать библиотеку**

`contracts/src/libraries/Units.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Перевод между базовыми единицами токена и внутренним WAD (1e18).
/// @dev Суммы протокола укладываются в 1e30, поэтому произведения в WAD далеки
///      от переполнения uint256 и считаются без mulDiv с полной точностью.
library Units {
    uint256 internal constant WAD = 1e18;

    error TooManyDecimals();

    function toWad(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 18) revert TooManyDecimals();
        return amount * (10 ** (18 - decimals));
    }

    /// @dev Вниз: недостача от округления остаётся в пуле, а не у пользователя.
    function fromWad(uint256 wad, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 18) revert TooManyDecimals();
        return wad / (10 ** (18 - decimals));
    }
}
```

- [ ] **Step 4: Интерфейсы**

`contracts/src/interfaces/IAggregatorV3.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80);
}
```

`contracts/src/interfaces/IPremiumModel.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPremiumModel {
    /// @param direction 0 — Buy Low, 1 — Sell High
    /// @param distanceBps расстояние до цели от текущей цены, в сотых долях процента
    /// @return премия за неделю в bps; 0 значит, что рунга нет в продаже
    function premiumBps(uint8 direction, uint16 distanceBps) external view returns (uint16);
}
```

`contracts/src/interfaces/INuvoPoolFactory.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface INuvoPoolFactory {
    /// @notice Первая опубликованная экспирация, до которой осталось строго больше minLead секунд.
    /// @return 0, если календарь кончился.
    function nextExpiry(uint64 minLead) external view returns (uint64);
}
```

- [ ] **Step 5: Моки**

`contracts/test/mocks/MockERC20.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

`contracts/test/mocks/MockFeed.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// @notice Фид с историей раундов. Несуществующий раунд отваливается, как
///         настоящий прокси Chainlink, чтобы try/catch в пуле проверялся всерьёз.
contract MockFeed is IAggregatorV3 {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 private immutable _decimals;
    uint80 public latestRound;
    mapping(uint80 => Round) private _rounds;

    constructor(uint8 d) {
        _decimals = d;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function push(int256 answer, uint256 updatedAt) external returns (uint80) {
        latestRound += 1;
        _rounds[latestRound] = Round(answer, updatedAt);
        return latestRound;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[latestRound];
        return (latestRound, r.answer, r.updatedAt, r.updatedAt, latestRound);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[roundId];
        require(r.updatedAt != 0, "No data present");
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }
}
```

`contracts/test/mocks/MockFactory.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INuvoPoolFactory} from "../../src/interfaces/INuvoPoolFactory.sol";

contract MockFactory is INuvoPoolFactory {
    uint64[] public expiries;

    function setExpiries(uint64[] calldata list) external {
        delete expiries;
        for (uint256 i = 0; i < list.length; i++) expiries.push(list[i]);
    }

    function nextExpiry(uint64 minLead) external view returns (uint64) {
        uint64 threshold = uint64(block.timestamp) + minLead;
        for (uint256 i = 0; i < expiries.length; i++) {
            if (expiries[i] > threshold) return expiries[i];
        }
        return 0;
    }
}
```

- [ ] **Step 6: Прогнать**

```bash
cd contracts && rm test/Smoke.t.sol && forge test --match-path test/Units.t.sol -vv
```
Expected: PASS, четыре теста.

- [ ] **Step 7: Коммит**

```bash
git add contracts && git commit -m "feat: units, feed and premium interfaces, test mocks"
```

---

### Task 3: PremiumModel

Таблица премий, заданная при деплое и неизменяемая. Менять ставки — значит задеплоить новую модель и назначить её пулу с задержкой (Задача 8). Так требование «смена модели премий с задержкой» выполняется без отдельного таймлока внутри модели.

**Files:**
- Create: `contracts/src/PremiumModel.sol`
- Test: `contracts/test/PremiumModel.t.sol`

**Interfaces:**
- Consumes: `IPremiumModel` (Задача 2).
- Produces: `PremiumModel(uint8[] directions, uint16[] distances, uint16[] bps)`, реализует `premiumBps(uint8,uint16) view returns (uint16)`, ошибки `BadRate()`, `LengthMismatch()`, константа `MAX_BPS = 5000`.

- [ ] **Step 1: Написать падающий тест**

`contracts/test/PremiumModel.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PremiumModel} from "../src/PremiumModel.sol";

contract PremiumModelTest is Test {
    PremiumModel internal model;

    function setUp() public {
        uint8[] memory dirs = new uint8[](4);
        uint16[] memory dist = new uint16[](4);
        uint16[] memory bps = new uint16[](4);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        (dirs[1], dist[1], bps[1]) = (0, 400, 85);
        (dirs[2], dist[2], bps[2]) = (1, 200, 110);
        (dirs[3], dist[3], bps[3]) = (1, 400, 80);
        model = new PremiumModel(dirs, dist, bps);
    }

    function test_returnsTheRateForAKnownRung() public view {
        assertEq(model.premiumBps(0, 200), 120);
        assertEq(model.premiumBps(1, 400), 80);
    }

    function test_unknownRungIsZero() public view {
        assertEq(model.premiumBps(0, 300), 0);
        assertEq(model.premiumBps(1, 9_999), 0);
    }

    function test_rejectsBadDirectionOnDeploy() public {
        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (2, 200, 120);
        vm.expectRevert(PremiumModel.BadRate.selector);
        new PremiumModel(dirs, dist, bps);
    }

    function test_rejectsDistanceAtOrAboveHundredPercent() public {
        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (0, 10_000, 120);
        vm.expectRevert(PremiumModel.BadRate.selector);
        new PremiumModel(dirs, dist, bps);
    }
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd contracts && forge test --match-path test/PremiumModel.t.sol`
Expected: FAIL — `PremiumModel.sol` не существует.

- [ ] **Step 3: Реализовать**

`contracts/src/PremiumModel.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPremiumModel} from "./interfaces/IPremiumModel.sol";

/// @notice Таблица недельных премий, заданная при деплое. Менять нечего:
///         новая сетка ставок — новый контракт, который пул принимает с задержкой.
contract PremiumModel is IPremiumModel {
    uint16 public constant MAX_BPS = 5_000;

    error BadRate();
    error LengthMismatch();

    mapping(uint8 => mapping(uint16 => uint16)) private _rate;

    constructor(uint8[] memory directions, uint16[] memory distances, uint16[] memory bps) {
        if (directions.length != distances.length || distances.length != bps.length) revert LengthMismatch();
        for (uint256 i = 0; i < directions.length; i++) {
            if (directions[i] > 1) revert BadRate();
            if (distances[i] == 0 || distances[i] >= 10_000) revert BadRate();
            if (bps[i] == 0 || bps[i] > MAX_BPS) revert BadRate();
            _rate[directions[i]][distances[i]] = bps[i];
        }
    }

    function premiumBps(uint8 direction, uint16 distanceBps) external view returns (uint16) {
        return _rate[direction][distanceBps];
    }
}
```

- [ ] **Step 4: Прогнать**

Run: `cd contracts && forge test --match-path test/PremiumModel.t.sol -vv`
Expected: PASS, четыре теста.

- [ ] **Step 5: Коммит**

```bash
git add contracts && git commit -m "feat: premium model as a table fixed at deploy"
```

---

### Task 4: NuvoPool — хранилище, цена, паи вкладчиков

Здесь появляется сам пул: неизменяемые адреса, три учёта, чтение цены и ввод-вывод вкладчиков. Подписок ещё нет, значит и замороженного инвентаря нет: он появится в Задаче 5, но поля и деление на свободное и замороженное закладываются сразу, чтобы потом не переписывать учёт.

**Files:**
- Create: `contracts/src/NuvoPool.sol`
- Test: `contracts/test/NuvoPool.liquidity.t.sol`

**Interfaces:**
- Consumes: `Units`, `IAggregatorV3`, `IPremiumModel`, `INuvoPoolFactory` (Задача 2), `PremiumModel` (Задача 3) как один из возможных аргументов `Params.premiumModel`.
- Produces:
  - `struct NuvoPool.Params { address usdg; address token; address feed; address premiumModel; address factory; address owner; address guardian; uint16 maxPremiumBps; uint64 maxPriceAge; uint64 maxPriceAgeSettle; uint256 minDepositValueWad; uint256 maxPositionValueWad; uint256 maxExpiryLockValueWad; uint16 maxLockedShareBps; }`
  - `constructor(Params memory p)`
  - `addLiquidity(uint256 usdgIn, uint256 tokenIn, uint256 minShares) returns (uint256 shares)`
  - `removeLiquidity(uint256 shares, uint256 minUsdgOut, uint256 minTokenOut) returns (uint256 usdgOut, uint256 tokenOut)`
  - публичные `usdg()`, `token()`, `feed()`, `factory()`, `sharesOf(address)`, `totalShares()`, `freeUsdg()`, `lockedUsdg()`, `freeToken()`, `lockedToken()`, `depositsUsdg()`, `depositsToken()`, `feesUsdg()`, `feesToken()`
  - view `poolValueWad() → uint256`, `freeValueWad() → uint256`, `priceWad() → (uint256 price, uint256 updatedAt)`
  - ошибки `BadPrice()`, `StalePrice()`, `Slippage()`, `BadShares()`, `InventoryLocked()`, `NothingToDo()`, `TooSmall()`, `Paused()`

- [ ] **Step 1: Написать падающий тест**

`contracts/test/NuvoPool.liquidity.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

contract PoolLiquidityTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    PremiumModel internal model;
    NuvoPool internal pool;

    address internal owner = address(0xA11CE);
    address internal lp1 = address(0xB0B);
    address internal lp2 = address(0xCAFE);

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        factory = new MockFactory();

        uint8[] memory dirs = new uint8[](2);
        uint16[] memory dist = new uint16[](2);
        uint16[] memory bps = new uint16[](2);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        (dirs[1], dist[1], bps[1]) = (1, 200, 110);
        model = new PremiumModel(dirs, dist, bps);

        feed.push(100e8, block.timestamp); // $100 за токен

        pool = new NuvoPool(
            NuvoPool.Params({
                usdg: address(usdg),
                token: address(stock),
                feed: address(feed),
                premiumModel: address(model),
                factory: address(factory),
                owner: owner,
                guardian: owner,
                maxPremiumBps: 1_000,
                maxPriceAge: 80 hours,
                maxPriceAgeSettle: 6 hours,
                minDepositValueWad: 10e18,
                maxPositionValueWad: 100_000e18,
                maxExpiryLockValueWad: 500_000e18,
                maxLockedShareBps: 8_000
            })
        );

        usdg.mint(lp1, 1_000_000e6);
        usdg.mint(lp2, 1_000_000e6);
        stock.mint(lp1, 1_000e18);

        // Разрешения выдаются здесь, чтобы в тестах vm.expectRevert приходился
        // ровно на addLiquidity, а не на approve внутри вспомогательного метода.
        address[2] memory lps = [lp1, lp2];
        for (uint256 i = 0; i < lps.length; i++) {
            vm.startPrank(lps[i]);
            usdg.approve(address(pool), type(uint256).max);
            stock.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _add(address who, uint256 u, uint256 t) internal returns (uint256) {
        vm.prank(who);
        return pool.addLiquidity(u, t, 0);
    }

    function test_firstDepositValuesBothAssetsAndLocksTheFloor() public {
        uint256 shares = _add(lp1, 10_000e6, 50e18);
        // 10 000 USDG + 50 токенов по $100 = 15 000 в WAD
        assertEq(pool.totalShares(), 15_000e18);
        assertEq(shares, 15_000e18 - 1e15);
        assertEq(pool.sharesOf(address(pool)), 1e15, "floor shares stay in the pool forever");
        assertEq(pool.poolValueWad(), 15_000e18);
        assertEq(pool.freeUsdg(), 10_000e6);
        assertEq(pool.freeToken(), 50e18);
    }

    function test_secondDepositIsProportional() public {
        _add(lp1, 10_000e6, 50e18);
        uint256 shares = _add(lp2, 1_000e6, 0);
        assertEq(shares, 1_000e18);
        assertEq(pool.poolValueWad(), 16_000e18);
    }

    function test_withdrawPaysTheFreeSideInProportion() public {
        _add(lp1, 10_000e6, 50e18);
        uint256 shares = _add(lp2, 1_000e6, 0);

        vm.prank(lp2);
        (uint256 usdgOut, uint256 tokenOut) = pool.removeLiquidity(shares, 0, 0);

        // 1/16 свободного инвентаря: 11 000 USDG и 50 токенов
        assertEq(usdgOut, 687_500_000);
        assertEq(tokenOut, 3.125e18);
        assertEq(pool.sharesOf(lp2), 0);
        assertEq(pool.poolValueWad(), 15_000e18);
    }

    function test_withdrawRespectsMinimums() public {
        _add(lp1, 10_000e6, 50e18);
        uint256 shares = _add(lp2, 1_000e6, 0);
        vm.prank(lp2);
        vm.expectRevert(NuvoPool.Slippage.selector);
        pool.removeLiquidity(shares, 1_000e6, 0);
    }

    function test_rejectsMoreSharesThanOwned() public {
        _add(lp1, 10_000e6, 50e18);
        vm.prank(lp2);
        vm.expectRevert(NuvoPool.BadShares.selector);
        pool.removeLiquidity(1, 0, 0);
    }

    function test_rejectsZeroShares() public {
        _add(lp1, 10_000e6, 50e18);
        vm.prank(lp1);
        vm.expectRevert(NuvoPool.BadShares.selector);
        pool.removeLiquidity(0, 0, 0);
    }

    function test_soleDepositorCanTakeEverythingBackButTheFloor() public {
        uint256 shares = _add(lp1, 10_000e6, 50e18);
        vm.prank(lp1);
        (uint256 usdgOut, uint256 tokenOut) = pool.removeLiquidity(shares, 0, 0);
        // всё, кроме запертой доли: 1e15 из 15 000e18 стоимости
        assertApproxEqRel(usdgOut, 10_000e6, 1e12);
        assertApproxEqRel(tokenOut, 50e18, 1e12);
        assertEq(pool.totalShares(), 1e15);
        assertGt(pool.poolValueWad(), 0, "the floor keeps the pool from being re-scaled");
    }

    function test_rejectsDepositThatIsAllRoundedAway() public {
        vm.expectRevert(NuvoPool.TooSmall.selector);
        _add(lp1, 0, 0);
    }

    // Review Focus 3: фид без цены не считается
    function test_rejectsNonPositivePrice() public {
        feed.push(0, block.timestamp);
        vm.expectRevert(NuvoPool.BadPrice.selector);
        _add(lp1, 10_000e6, 0);
    }

    function test_rejectsStalePrice() public {
        vm.warp(block.timestamp + 81 hours);
        vm.expectRevert(NuvoPool.StalePrice.selector);
        _add(lp1, 10_000e6, 0);
    }
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd contracts && forge test --match-path test/NuvoPool.liquidity.t.sol`
Expected: FAIL — `NuvoPool.sol` не существует.

- [ ] **Step 3: Реализовать пул**

`contracts/src/NuvoPool.sol` — первая часть файла. Ошибки и события объявляются сразу все, чтобы следующие задачи только добавляли функции, а не правили шапку.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IPremiumModel} from "./interfaces/IPremiumModel.sol";
import {INuvoPoolFactory} from "./interfaces/INuvoPoolFactory.sol";
import {Units} from "./libraries/Units.sol";

/// @title Изолированный пул двойных инвестиций на один тикер.
/// @notice Внутри три раздельных учёта:
///         1. инвентарь вкладчиков — free/locked, из него платятся премии и конверсии;
///         2. депозиты подписчиков — deposits*, их нельзя потратить ни на что другое;
///         3. паи вкладчиков — доля в инвентаре.
///         Балансы считаются по внутренним счётчикам, а не по balanceOf, поэтому
///         перевод токенов напрямую на контракт ничего не меняет и не двигает цену пая.
contract NuvoPool is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant BUY_LOW = 0;
    uint8 public constant SELL_HIGH = 1;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    /// @notice Подписка идёт в экспирацию, до которой осталось строго больше суток.
    uint64 public constant MIN_LEAD = 24 hours;
    /// @notice Смена модели премий вступает в силу не раньше этого срока.
    uint256 public constant MODEL_DELAY = 2 days;
    uint16 public constant MAX_FEE_BPS = 2_000;
    /// @notice Доля, которая остаётся в пуле навсегда: не даёт обнулить масштаб пая.
    uint256 internal constant FLOOR_SHARES = 1e15;

    struct Params {
        address usdg;
        address token;
        address feed;
        address premiumModel;
        address factory;
        address owner;
        address guardian;
        uint16 maxPremiumBps;
        uint64 maxPriceAge;
        uint64 maxPriceAgeSettle;
        uint256 minDepositValueWad;
        uint256 maxPositionValueWad;
        uint256 maxExpiryLockValueWad;
        uint16 maxLockedShareBps;
    }

    struct Position {
        address owner;
        uint8 direction;
        uint16 premiumBps;
        uint64 expiry;
        bool claimed;
        uint256 deposit;
        uint256 strikeWad;
        uint256 lockUsdg;
        uint256 lockToken;
    }

    struct Preview {
        uint64 expiry;
        uint16 premiumBps;
        uint256 strikeWad;
        uint256 priceWad;
        uint256 priceUpdatedAt;
        uint256 ifConverted;
        uint256 ifNot;
        uint256 lockUsdg;
        uint256 lockToken;
        uint8 code; // 0 — можно подписываться, иначе причина отказа
    }

    IERC20 public immutable usdg;
    IERC20 public immutable token;
    IAggregatorV3 public immutable feed;
    INuvoPoolFactory public immutable factory;
    uint8 public immutable usdgDecimals;
    uint8 public immutable tokenDecimals;
    uint8 public immutable feedDecimals;
    uint16 public immutable maxPremiumBps;

    IPremiumModel public premiumModel;
    IPremiumModel public pendingModel;
    uint256 public pendingModelEta;

    address public guardian;
    bool public paused;
    uint16 public feeBps;

    uint64 public maxPriceAge;
    uint64 public maxPriceAgeSettle;
    uint256 public minDepositValueWad;
    uint256 public maxPositionValueWad;
    uint256 public maxExpiryLockValueWad;
    uint16 public maxLockedShareBps;

    uint256 public freeUsdg;
    uint256 public lockedUsdg;
    uint256 public freeToken;
    uint256 public lockedToken;
    uint256 public depositsUsdg;
    uint256 public depositsToken;
    uint256 public feesUsdg;
    uint256 public feesToken;

    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    mapping(uint64 => uint256) public settlePriceWad;
    mapping(uint64 => uint256) public lockedValueAt;

    Position[] internal _positions;
    mapping(address => uint256[]) internal _byOwner;

    error BadPrice();
    error StalePrice();
    error Slippage();
    error BadShares();
    error InventoryLocked();
    error NothingToDo();
    error TooSmall();
    error Paused();
    error Unavailable(uint8 code);
    error BadDirection();
    error Expired();
    error StrikeMoved();
    error TransferMismatch();
    error NotYours();
    error NotSettled();
    error AlreadyClaimed();
    error AlreadySettled();
    error NotExpired();
    error NotTheSettleRound();
    error NotAllowed();
    error TooHigh();
    error TooEarly();
    error NothingPending();

    event LiquidityAdded(address indexed lp, uint256 usdgIn, uint256 tokenIn, uint256 shares);
    event LiquidityRemoved(address indexed lp, uint256 usdgOut, uint256 tokenOut, uint256 shares);
    event Subscribed(
        uint256 indexed id,
        address indexed owner,
        uint8 direction,
        uint256 deposit,
        uint256 strikeWad,
        uint16 premiumBps,
        uint64 expiry
    );
    event Settled(uint64 indexed expiry, uint256 priceWad, uint256 updatedAt);
    event Claimed(uint256 indexed id, address indexed owner, address asset, uint256 amount, bool converted);
    event FeesWithdrawn(address indexed to, uint256 usdgAmount, uint256 tokenAmount);
    event PausedSet(bool paused, address by);
    event GuardianSet(address guardian);
    event ModelScheduled(address model, uint256 eta);
    event ModelSet(address model);
    event FeeSet(uint16 bps);
    event LimitsSet(
        uint64 maxPriceAge,
        uint64 maxPriceAgeSettle,
        uint256 minDepositValueWad,
        uint256 maxPositionValueWad,
        uint256 maxExpiryLockValueWad,
        uint16 maxLockedShareBps
    );

    constructor(Params memory p) Ownable(p.owner) {
        usdg = IERC20(p.usdg);
        token = IERC20(p.token);
        feed = IAggregatorV3(p.feed);
        factory = INuvoPoolFactory(p.factory);
        premiumModel = IPremiumModel(p.premiumModel);
        guardian = p.guardian;
        maxPremiumBps = p.maxPremiumBps;

        usdgDecimals = IERC20Metadata(p.usdg).decimals();
        tokenDecimals = IERC20Metadata(p.token).decimals();
        feedDecimals = IAggregatorV3(p.feed).decimals();
        if (usdgDecimals > 18 || tokenDecimals > 18 || feedDecimals > 18) revert Units.TooManyDecimals();

        _setLimits(
            p.maxPriceAge,
            p.maxPriceAgeSettle,
            p.minDepositValueWad,
            p.maxPositionValueWad,
            p.maxExpiryLockValueWad,
            p.maxLockedShareBps
        );
        emit GuardianSet(p.guardian);
    }

    // --- цена ---

    /// @notice Текущая цена за токен в WAD и момент её обновления.
    function priceWad() public view returns (uint256 price, uint256 updatedAt) {
        (, int256 answer,, uint256 at,) = feed.latestRoundData();
        if (answer <= 0 || at == 0) revert BadPrice();
        price = uint256(answer) * (10 ** (18 - feedDecimals));
        updatedAt = at;
    }

    /// @dev Цена, пригодная для подписки и для оценки пая.
    function _freshPrice() internal view returns (uint256 price) {
        uint256 at;
        (price, at) = priceWad();
        if (block.timestamp > at + maxPriceAge) revert StalePrice();
    }

    // --- стоимость ---

    function _value(uint256 usdgAmount, uint256 tokenAmount, uint256 price) internal view returns (uint256) {
        return Units.toWad(usdgAmount, usdgDecimals) + (Units.toWad(tokenAmount, tokenDecimals) * price) / WAD;
    }

    /// @notice Стоимость инвентаря вкладчиков: свободное плюс замороженное.
    ///         Депозиты подписчиков и накопленная комиссия сюда не входят.
    function poolValueWad() public view returns (uint256) {
        (uint256 price,) = priceWad();
        return _value(freeUsdg + lockedUsdg, freeToken + lockedToken, price);
    }

    function freeValueWad() public view returns (uint256) {
        (uint256 price,) = priceWad();
        return _value(freeUsdg, freeToken, price);
    }

    // --- паи вкладчиков ---

    function addLiquidity(uint256 usdgIn, uint256 tokenIn, uint256 minShares)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (paused) revert Paused();
        uint256 price = _freshPrice();
        uint256 addWad = _value(usdgIn, tokenIn, price);

        if (totalShares == 0) {
            if (addWad <= FLOOR_SHARES) revert TooSmall();
            shares = addWad - FLOOR_SHARES;
            totalShares = addWad;
            sharesOf[address(this)] = FLOOR_SHARES;
        } else {
            uint256 valueWad = _value(freeUsdg + lockedUsdg, freeToken + lockedToken, price);
            if (valueWad == 0) revert TooSmall();
            shares = (addWad * totalShares) / valueWad;
            if (shares == 0) revert TooSmall();
            totalShares += shares;
        }
        if (shares < minShares) revert Slippage();
        sharesOf[msg.sender] += shares;

        if (usdgIn > 0) {
            _pullExactly(usdg, usdgIn);
            freeUsdg += usdgIn;
        }
        if (tokenIn > 0) {
            _pullExactly(token, tokenIn);
            freeToken += tokenIn;
        }
        emit LiquidityAdded(msg.sender, usdgIn, tokenIn, shares);
    }

    /// @notice Сжигает паи и отдаёт долю из свободной части обоих активов.
    ///         Замороженное под открытые позиции недоступно до расчёта.
    function removeLiquidity(uint256 shares, uint256 minUsdgOut, uint256 minTokenOut)
        external
        nonReentrant
        returns (uint256 usdgOut, uint256 tokenOut)
    {
        if (shares == 0 || shares > sharesOf[msg.sender]) revert BadShares();
        uint256 price = _freshPrice();

        uint256 owed = (_value(freeUsdg + lockedUsdg, freeToken + lockedToken, price) * shares) / totalShares;
        uint256 freeValue = _value(freeUsdg, freeToken, price);
        if (freeValue == 0 || owed > freeValue) revert InventoryLocked();

        usdgOut = (freeUsdg * owed) / freeValue;
        tokenOut = (freeToken * owed) / freeValue;
        if (usdgOut < minUsdgOut || tokenOut < minTokenOut) revert Slippage();

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        freeUsdg -= usdgOut;
        freeToken -= tokenOut;

        if (usdgOut > 0) usdg.safeTransfer(msg.sender, usdgOut);
        if (tokenOut > 0) token.safeTransfer(msg.sender, tokenOut);
        emit LiquidityRemoved(msg.sender, usdgOut, tokenOut, shares);
    }

    /// @dev Учёт ведётся по счётчикам, поэтому токен, удерживающий комиссию с
    ///      перевода, разошёлся бы с ними. Такой перевод отклоняется.
    function _pullExactly(IERC20 asset, uint256 amount) internal {
        uint256 before = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.balanceOf(address(this)) - before != amount) revert TransferMismatch();
    }

    /// @dev Общая точка для конструктора и сеттера из Задачи 8.
    function _setLimits(
        uint64 priceAge,
        uint64 priceAgeSettle,
        uint256 minDeposit,
        uint256 maxPosition,
        uint256 maxExpiryLock,
        uint16 lockedShareBps
    ) internal {
        if (priceAge == 0 || priceAge > 7 days) revert TooHigh();
        if (priceAgeSettle == 0 || priceAgeSettle > 24 hours) revert TooHigh();
        if (lockedShareBps > BPS) revert TooHigh();
        maxPriceAge = priceAge;
        maxPriceAgeSettle = priceAgeSettle;
        minDepositValueWad = minDeposit;
        maxPositionValueWad = maxPosition;
        maxExpiryLockValueWad = maxExpiryLock;
        maxLockedShareBps = lockedShareBps;
        emit LimitsSet(priceAge, priceAgeSettle, minDeposit, maxPosition, maxExpiryLock, lockedShareBps);
    }
}
```

- [ ] **Step 4: Прогнать**

Run: `cd contracts && forge test --match-path test/NuvoPool.liquidity.t.sol -vv`
Expected: PASS, десять тестов.

- [ ] **Step 5: Коммит**

```bash
git add contracts && git commit -m "feat: pool inventory, price reads and liquidity shares"
```

---

### Task 5: NuvoPool — расчёт условий и подписка

`preview` и `subscribe` считают одно и то же одним и тем же кодом: `preview` возвращает причину отказа числом, `subscribe` на том же числе откатывается. Поэтому экран подписки и контракт не могут разойтись.

**Files:**
- Modify: `contracts/src/NuvoPool.sol` (добавить блок «условия и подписка» перед `_setLimits`)
- Test: `contracts/test/NuvoPool.subscribe.t.sol`

**Interfaces:**
- Consumes: всё из Задачи 4, `Preview` и `Position` уже объявлены там.
- Produces:
  - константы `CODE_OK = 0`, `CODE_PAUSED = 1`, `CODE_NO_EXPIRY = 2`, `CODE_BAD_PRICE = 3`, `CODE_STALE_PRICE = 4`, `CODE_NO_PREMIUM = 5`, `CODE_ZERO_AMOUNT = 6`, `CODE_BELOW_MIN = 7`, `CODE_ABOVE_MAX = 8`, `CODE_EXPIRY_FULL = 9`, `CODE_NO_INVENTORY = 10`, `CODE_TOO_MUCH_LOCKED = 11`, `CODE_BAD_DISTANCE = 12`
  - `preview(uint8 direction, uint16 distanceBps, uint256 amount) view returns (Preview memory)`
  - `subscribe(uint8 direction, uint16 distanceBps, uint256 amount, uint256 limitStrikeWad, uint64 deadline) returns (uint256 id)`
  - `position(uint256 id) view returns (Position memory)`, `positionsOf(address) view returns (uint256[] memory)`, `positionCount() view returns (uint256)`

- [ ] **Step 1: Написать падающий тест**

`contracts/test/NuvoPool.subscribe.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

contract PoolSubscribeTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    NuvoPool internal pool;

    address internal owner = address(0xA11CE);
    address internal lp = address(0xB0B);
    address internal user = address(0xD00D);

    uint64 internal expiry1;
    uint64 internal expiry2;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        factory = new MockFactory();

        uint8[] memory dirs = new uint8[](2);
        uint16[] memory dist = new uint16[](2);
        uint16[] memory bps = new uint16[](2);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        (dirs[1], dist[1], bps[1]) = (1, 200, 110);
        PremiumModel model = new PremiumModel(dirs, dist, bps);

        feed.push(100e8, block.timestamp);

        expiry1 = uint64(block.timestamp + 3 days);
        expiry2 = uint64(block.timestamp + 10 days);
        uint64[] memory list = new uint64[](2);
        (list[0], list[1]) = (expiry1, expiry2);
        factory.setExpiries(list);

        pool = new NuvoPool(
            NuvoPool.Params({
                usdg: address(usdg),
                token: address(stock),
                feed: address(feed),
                premiumModel: address(model),
                factory: address(factory),
                owner: owner,
                guardian: owner,
                maxPremiumBps: 1_000,
                maxPriceAge: 80 hours,
                maxPriceAgeSettle: 6 hours,
                minDepositValueWad: 100e18,
                maxPositionValueWad: 50_000e18,
                maxExpiryLockValueWad: 500_000e18,
                maxLockedShareBps: 8_000
            })
        );

        usdg.mint(lp, 1_000_000e6);
        stock.mint(lp, 10_000e18);
        usdg.mint(user, 100_000e6);
        stock.mint(user, 1_000e18);

        vm.startPrank(lp);
        usdg.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        pool.addLiquidity(100_000e6, 1_000e18, 0);
        vm.stopPrank();

        vm.startPrank(user);
        usdg.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_buyLowLocksBothOutcomes() public {
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));

        NuvoPool.Position memory p = pool.position(id);
        assertEq(p.owner, user);
        assertEq(p.strikeWad, 98e18, "strike is 2% under the reference");
        assertEq(p.premiumBps, 120);
        assertEq(p.expiry, expiry1);
        assertEq(p.deposit, 1_000e6);
        // D x (1 + r) / K = 1012 / 98 токенов, вниз
        assertEq(p.lockToken, 10_326_530_612_244_897_959);
        // D x r премии в USDG
        assertEq(p.lockUsdg, 12e6);

        assertEq(pool.lockedToken(), p.lockToken);
        assertEq(pool.lockedUsdg(), p.lockUsdg);
        assertEq(pool.freeToken(), 1_000e18 - p.lockToken);
        assertEq(pool.freeUsdg(), 100_000e6 - p.lockUsdg);
        assertEq(pool.depositsUsdg(), 1_000e6);
        assertEq(usdg.balanceOf(address(pool)), 101_000e6);
    }

    function test_sellHighLocksBothOutcomes() public {
        vm.prank(user);
        uint256 id = pool.subscribe(1, 200, 10e18, 0, uint64(block.timestamp + 300));

        NuvoPool.Position memory p = pool.position(id);
        assertEq(p.strikeWad, 102e18);
        // Q x K x (1 + r) = 10.11 x 102 USDG
        assertEq(p.lockUsdg, 1_031_220_000);
        // Q x r премии в токенах
        assertEq(p.lockToken, 110_000_000_000_000_000);
        assertEq(pool.depositsToken(), 10e18);
    }

    function test_previewMatchesWhatSubscribeStores() public {
        NuvoPool.Preview memory q = pool.preview(0, 200, 1_000e6);
        assertEq(q.code, 0);
        assertEq(q.ifNot, 1_012e6, "deposit plus premium in USDG");
        assertEq(q.ifConverted, 10_326_530_612_244_897_959);

        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
        NuvoPool.Position memory p = pool.position(id);
        assertEq(p.lockToken, q.ifConverted);
        assertEq(p.strikeWad, q.strikeWad);
        assertEq(p.premiumBps, q.premiumBps);
    }

    // Review Focus 1
    function test_rejectsDistanceAtOrAboveHundredPercent() public {
        assertEq(pool.preview(0, 10_000, 1_000e6).code, pool.CODE_BAD_DISTANCE());
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(NuvoPool.Unavailable.selector, pool.CODE_BAD_DISTANCE()));
        pool.subscribe(0, 10_000, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
    }

    function test_rejectsUnknownDirection() public {
        assertEq(pool.preview(2, 200, 1_000e6).code, pool.CODE_BAD_DISTANCE());
    }

    // Review Focus 2: ровно на отсечке подписка уходит в следующую экспирацию
    function test_atTheCutoffTheNextExpiryIsUsed() public {
        vm.warp(expiry1 - 24 hours);
        feed.push(100e8, block.timestamp);
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
        assertEq(pool.position(id).expiry, expiry2);
    }

    function test_oneSecondBeforeTheCutoffTheNearExpiryIsUsed() public {
        vm.warp(expiry1 - 24 hours - 1);
        feed.push(100e8, block.timestamp);
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
        assertEq(pool.position(id).expiry, expiry1);
    }

    function test_rejectsWhenTheCalendarIsOut() public {
        vm.warp(expiry2);
        feed.push(100e8, block.timestamp);
        assertEq(pool.preview(0, 200, 1_000e6).code, pool.CODE_NO_EXPIRY());
    }

    function test_rejectsBelowTheMinimum() public {
        assertEq(pool.preview(0, 200, 50e6).code, pool.CODE_BELOW_MIN());
    }

    function test_rejectsAboveThePositionCap() public {
        assertEq(pool.preview(0, 200, 60_000e6).code, pool.CODE_ABOVE_MAX());
    }

    function test_rejectsWhenInventoryIsShort() public {
        // 20 000 USDG по страйку 98 требует больше токенов, чем есть в пуле
        assertEq(pool.preview(0, 200, 40_000e6).code, pool.CODE_NO_INVENTORY());
    }

    function test_rejectsWhenTooMuchOfTheInventoryWouldBeLocked() public {
        // maxLockedShareBps = 8000: подписка, замораживающая больше 80% стоимости, отклоняется
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(NuvoPool.Unavailable.selector, pool.CODE_TOO_MUCH_LOCKED()));
        pool.subscribe(1, 200, 900e18, 0, uint64(block.timestamp + 300));
    }

    function test_rejectsWhenTheStrikeMovedPastTheLimit() public {
        feed.push(110e8, block.timestamp); // цена ушла вверх, страйк Buy Low тоже
        vm.prank(user);
        vm.expectRevert(NuvoPool.StrikeMoved.selector);
        pool.subscribe(0, 200, 1_000e6, 98e18, uint64(block.timestamp + 300));
    }

    function test_rejectsAfterTheDeadline() public {
        vm.prank(user);
        vm.expectRevert(NuvoPool.Expired.selector);
        pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp - 1));
    }

    function test_rejectsAnUnknownRung() public {
        assertEq(pool.preview(0, 600, 1_000e6).code, pool.CODE_NO_PREMIUM());
    }

    // Review Focus 5: замороженный инвентарь вкладчику не выдаётся
    function test_liquidityLockedBySubscriptionsCannotBeWithdrawn() public {
        vm.prank(user);
        pool.subscribe(1, 200, 700e18, 0, uint64(block.timestamp + 300));
        uint256 shares = pool.sharesOf(lp);
        vm.prank(lp);
        vm.expectRevert(NuvoPool.InventoryLocked.selector);
        pool.removeLiquidity(shares, 0, 0);
    }

    function test_positionsOfListsTheOwnersPositions() public {
        vm.startPrank(user);
        uint256 a = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
        uint256 b = pool.subscribe(1, 200, 10e18, 0, uint64(block.timestamp + 300));
        vm.stopPrank();
        uint256[] memory ids = pool.positionsOf(user);
        assertEq(ids.length, 2);
        assertEq(ids[0], a);
        assertEq(ids[1], b);
        assertEq(pool.positionCount(), 2);
    }
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd contracts && forge test --match-path test/NuvoPool.subscribe.t.sol`
Expected: FAIL — `preview`, `subscribe`, `position` не объявлены.

- [ ] **Step 3: Реализовать**

Добавить в `contracts/src/NuvoPool.sol` после блока паёв. Константы кодов — рядом с остальными константами в начале контракта.

```solidity
    uint8 public constant CODE_OK = 0;
    uint8 public constant CODE_PAUSED = 1;
    uint8 public constant CODE_NO_EXPIRY = 2;
    uint8 public constant CODE_BAD_PRICE = 3;
    uint8 public constant CODE_STALE_PRICE = 4;
    uint8 public constant CODE_NO_PREMIUM = 5;
    uint8 public constant CODE_ZERO_AMOUNT = 6;
    uint8 public constant CODE_BELOW_MIN = 7;
    uint8 public constant CODE_ABOVE_MAX = 8;
    uint8 public constant CODE_EXPIRY_FULL = 9;
    uint8 public constant CODE_NO_INVENTORY = 10;
    uint8 public constant CODE_TOO_MUCH_LOCKED = 11;
    uint8 public constant CODE_BAD_DISTANCE = 12;
```

```solidity
    // --- условия подписки ---

    /// @notice Всё, что нужно экрану подписки, одним вызовом. Не откатывается:
    ///         причина отказа приходит числом в code.
    function preview(uint8 direction, uint16 distanceBps, uint256 amount)
        external
        view
        returns (Preview memory)
    {
        return _quote(direction, distanceBps, amount);
    }

    function subscribe(
        uint8 direction,
        uint16 distanceBps,
        uint256 amount,
        uint256 limitStrikeWad,
        uint64 deadline
    ) external nonReentrant returns (uint256 id) {
        if (block.timestamp > deadline) revert Expired();

        Preview memory p = _quote(direction, distanceBps, amount);
        if (p.code != CODE_OK) revert Unavailable(p.code);
        // Страйк считается от живой цены. Подписчик задаёт границу, за которую
        // цена не должна была уехать между просмотром и транзакцией.
        if (direction == BUY_LOW ? p.strikeWad > limitStrikeWad : p.strikeWad < limitStrikeWad) {
            revert StrikeMoved();
        }

        freeUsdg -= p.lockUsdg;
        lockedUsdg += p.lockUsdg;
        freeToken -= p.lockToken;
        lockedToken += p.lockToken;
        lockedValueAt[p.expiry] += _value(p.lockUsdg, p.lockToken, p.priceWad);

        id = _positions.length;
        _positions.push(
            Position({
                owner: msg.sender,
                direction: direction,
                premiumBps: p.premiumBps,
                expiry: p.expiry,
                claimed: false,
                deposit: amount,
                strikeWad: p.strikeWad,
                lockUsdg: p.lockUsdg,
                lockToken: p.lockToken
            })
        );
        _byOwner[msg.sender].push(id);

        if (direction == BUY_LOW) {
            _pullExactly(usdg, amount);
            depositsUsdg += amount;
        } else {
            _pullExactly(token, amount);
            depositsToken += amount;
        }

        emit Subscribed(id, msg.sender, direction, amount, p.strikeWad, p.premiumBps, p.expiry);
    }

    function position(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }

    function positionsOf(address who) external view returns (uint256[] memory) {
        return _byOwner[who];
    }

    function positionCount() external view returns (uint256) {
        return _positions.length;
    }

    // --- внутренняя кухня расчёта условий ---

    function _quote(uint8 direction, uint16 distanceBps, uint256 amount)
        internal
        view
        returns (Preview memory p)
    {
        if (direction > SELL_HIGH || distanceBps == 0 || distanceBps >= BPS) {
            p.code = CODE_BAD_DISTANCE;
            return p;
        }

        p.expiry = factory.nextExpiry(MIN_LEAD);

        (bool ok, uint256 price, uint256 at) = _tryPrice();
        p.priceWad = price;
        p.priceUpdatedAt = at;

        if (ok) {
            p.strikeWad = _strike(direction, distanceBps, price);
            p.premiumBps = _modelBps(direction, distanceBps);
            if (p.premiumBps > 0 && p.strikeWad > 0) {
                p.ifConverted = _converted(direction, amount, p.strikeWad, p.premiumBps);
                p.ifNot = _kept(amount, p.premiumBps);
                (p.lockUsdg, p.lockToken) = _locks(direction, amount, p.strikeWad, p.premiumBps);
            }
        }

        p.code = _code(direction, amount, p, ok);
    }

    function _code(uint8 direction, uint256 amount, Preview memory p, bool priceOk)
        internal
        view
        returns (uint8)
    {
        if (paused) return CODE_PAUSED;
        if (p.expiry == 0) return CODE_NO_EXPIRY;
        if (!priceOk || p.strikeWad == 0) return CODE_BAD_PRICE;
        if (block.timestamp > p.priceUpdatedAt + maxPriceAge) return CODE_STALE_PRICE;
        if (p.premiumBps == 0 || p.premiumBps > maxPremiumBps) return CODE_NO_PREMIUM;
        if (amount == 0) return CODE_ZERO_AMOUNT;

        uint256 depositValue = direction == BUY_LOW
            ? Units.toWad(amount, usdgDecimals)
            : (Units.toWad(amount, tokenDecimals) * p.priceWad) / WAD;
        if (depositValue < minDepositValueWad) return CODE_BELOW_MIN;
        if (maxPositionValueWad != 0 && depositValue > maxPositionValueWad) return CODE_ABOVE_MAX;

        if (maxExpiryLockValueWad != 0) {
            uint256 lockValue = _value(p.lockUsdg, p.lockToken, p.priceWad);
            if (lockedValueAt[p.expiry] + lockValue > maxExpiryLockValueWad) return CODE_EXPIRY_FULL;
        }
        if (p.lockUsdg > freeUsdg || p.lockToken > freeToken) return CODE_NO_INVENTORY;
        if (maxLockedShareBps != 0) {
            uint256 total = _value(freeUsdg + lockedUsdg, freeToken + lockedToken, p.priceWad);
            uint256 after_ = _value(lockedUsdg + p.lockUsdg, lockedToken + p.lockToken, p.priceWad);
            if (after_ * BPS > total * maxLockedShareBps) return CODE_TOO_MUCH_LOCKED;
        }
        return CODE_OK;
    }

    /// @dev Чтение без отката: preview должен отвечать и при мёртвом фиде.
    function _tryPrice() internal view returns (bool ok, uint256 price, uint256 at) {
        try feed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer > 0 && updatedAt > 0) {
                return (true, uint256(answer) * (10 ** (18 - feedDecimals)), updatedAt);
            }
        } catch {}
        return (false, 0, 0);
    }

    function _modelBps(uint8 direction, uint16 distanceBps) internal view returns (uint16) {
        try premiumModel.premiumBps(direction, distanceBps) returns (uint16 b) {
            return b;
        } catch {
            return 0;
        }
    }

    function _strike(uint8 direction, uint16 distanceBps, uint256 price) internal pure returns (uint256) {
        return direction == BUY_LOW
            ? (price * (BPS - distanceBps)) / BPS
            : (price * (BPS + distanceBps)) / BPS;
    }

    /// @notice Выплата, если цена дошла до страйка, в базовых единицах другого актива.
    function _converted(uint8 direction, uint256 amount, uint256 strikeWad, uint16 bps)
        internal
        view
        returns (uint256)
    {
        if (direction == BUY_LOW) {
            // D x (1 + r) / K
            uint256 grossWad = (Units.toWad(amount, usdgDecimals) * (BPS + bps)) / BPS;
            return Units.fromWad((grossWad * WAD) / strikeWad, tokenDecimals);
        }
        // Q x K x (1 + r)
        uint256 qWad = (Units.toWad(amount, tokenDecimals) * (BPS + bps)) / BPS;
        return Units.fromWad((qWad * strikeWad) / WAD, usdgDecimals);
    }

    /// @notice Выплата, если не дошла: депозит плюс премия, в активе депозита.
    function _kept(uint256 amount, uint16 bps) internal pure returns (uint256) {
        return amount + (amount * bps) / BPS;
    }

    /// @dev Замок под конверсию — во встречном активе, замок под отказ — премия
    ///      в активе депозита. Оба берутся из свободного инвентаря вкладчиков.
    function _locks(uint8 direction, uint256 amount, uint256 strikeWad, uint16 bps)
        internal
        view
        returns (uint256 lockUsdgOut, uint256 lockTokenOut)
    {
        if (direction == BUY_LOW) {
            lockTokenOut = _converted(direction, amount, strikeWad, bps);
            lockUsdgOut = (amount * bps) / BPS;
        } else {
            lockUsdgOut = _converted(direction, amount, strikeWad, bps);
            lockTokenOut = (amount * bps) / BPS;
        }
    }
```

- [ ] **Step 4: Прогнать**

Run: `cd contracts && forge test --match-path test/NuvoPool.subscribe.t.sol -vv`
Expected: PASS, семнадцать тестов.

- [ ] **Step 5: Коммит**

```bash
git add contracts && git commit -m "feat: subscription terms and the preview the site reads"
```

---

### Task 6: NuvoPool — расчёт недели

Цена расчёта хранится одна на экспирацию, позиции сверяют с ней свой страйк. Поэтому `settle` не обходит позиции и стоит одинаково при любом их числе.

Правило выбора раунда: берётся цена, действовавшая в момент экспирации, то есть последний раунд не позже неё, и притом не протухший. Между пятничным закрытием и понедельничным открытием фид стоит, поэтому обычный `settle()` работает все выходные. Если фид молчал через экспирацию дольше допустимого, расчёт ждёт и делается первым же свежим раундом после неё — через `settleWithRound`.

**Files:**
- Modify: `contracts/src/NuvoPool.sol`
- Test: `contracts/test/NuvoPool.settle.t.sol`

**Interfaces:**
- Consumes: `settlePriceWad`, `maxPriceAgeSettle`, `feedDecimals` (Задача 4).
- Produces: `settle(uint64 expiry)`, `settleWithRound(uint64 expiry, uint80 roundId)`, событие `Settled`.

- [ ] **Step 1: Написать падающий тест**

`contracts/test/NuvoPool.settle.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

contract PoolSettleTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    NuvoPool internal pool;
    uint64 internal expiry;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        factory = new MockFactory();

        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        PremiumModel model = new PremiumModel(dirs, dist, bps);

        feed.push(100e8, block.timestamp);
        expiry = uint64(block.timestamp + 3 days);
        uint64[] memory list = new uint64[](1);
        list[0] = expiry;
        factory.setExpiries(list);

        pool = new NuvoPool(
            NuvoPool.Params({
                usdg: address(usdg),
                token: address(stock),
                feed: address(feed),
                premiumModel: address(model),
                factory: address(factory),
                owner: address(this),
                guardian: address(this),
                maxPremiumBps: 1_000,
                maxPriceAge: 80 hours,
                maxPriceAgeSettle: 6 hours,
                minDepositValueWad: 100e18,
                maxPositionValueWad: 50_000e18,
                maxExpiryLockValueWad: 500_000e18,
                maxLockedShareBps: 8_000
            })
        );
    }

    function test_rejectsBeforeTheExpiry() public {
        vm.expectRevert(NuvoPool.NotExpired.selector);
        pool.settle(expiry);
    }

    function test_takesThePriceInEffectAtTheExpiry() public {
        feed.push(97e8, expiry - 30 minutes); // последняя котировка перед закрытием
        vm.warp(expiry + 2 hours);
        pool.settle(expiry);
        assertEq(pool.settlePriceWad(expiry), 97e18);
    }

    function test_worksAllWeekendWhileTheFeedStandsStill() public {
        feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 40 hours);
        pool.settle(expiry);
        assertEq(pool.settlePriceWad(expiry), 97e18);
    }

    function test_refusesToSettleTwice() public {
        feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        pool.settle(expiry);
        vm.expectRevert(NuvoPool.AlreadySettled.selector);
        pool.settle(expiry);
    }

    function test_latestRoundAfterTheExpiryIsNotTheSettleRound() public {
        feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 40 hours);
        feed.push(105e8, expiry + 39 hours); // рынок снова открылся, никто не рассчитал
        vm.expectRevert(NuvoPool.NotTheSettleRound.selector);
        pool.settle(expiry);
    }

    function test_theMissedWeekIsSettledByTheHistoricRound() public {
        uint80 closeRound = feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 40 hours);
        feed.push(105e8, expiry + 39 hours);
        pool.settleWithRound(expiry, closeRound);
        assertEq(pool.settlePriceWad(expiry), 97e18);
    }

    function test_aRoundFromLongBeforeTheCloseDoesNotSettleTheWeek() public {
        // фид умер за сутки до экспирации: расчёт ждёт свежей цены
        feed.push(97e8, expiry - 24 hours);
        vm.warp(expiry + 1 hours);
        vm.expectRevert(NuvoPool.StalePrice.selector);
        pool.settle(expiry);
    }

    function test_afterASilentFeedTheFirstFreshRoundSettlesTheWeek() public {
        feed.push(97e8, expiry - 24 hours);
        vm.warp(expiry + 30 hours);
        uint80 first = feed.push(101e8, expiry + 29 hours);
        pool.settleWithRound(expiry, first);
        assertEq(pool.settlePriceWad(expiry), 101e18);
    }

    function test_aLaterRoundCannotReplaceAGoodOne() public {
        uint80 closeRound = feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 40 hours);
        uint80 later = feed.push(105e8, expiry + 39 hours);
        assertEq(closeRound + 1, later);
        vm.expectRevert(NuvoPool.NotTheSettleRound.selector);
        pool.settleWithRound(expiry, later);
    }

    function test_rejectsARoundWithoutAPrice() public {
        uint80 bad = feed.push(0, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        vm.expectRevert(NuvoPool.BadPrice.selector);
        pool.settleWithRound(expiry, bad);
    }
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd contracts && forge test --match-path test/NuvoPool.settle.t.sol`
Expected: FAIL — `settle` не объявлена.

- [ ] **Step 3: Реализовать**

Добавить в `contracts/src/NuvoPool.sol`:

```solidity
    // --- расчёт недели ---

    /// @notice Рассчитать экспирацию по текущему раунду фида. Открыто всем.
    function settle(uint64 expiry) external {
        (uint80 roundId,,,,) = feed.latestRoundData();
        _settle(expiry, roundId);
    }

    /// @notice То же, но раундом, выбранным вручную: если неделю не рассчитали
    ///         до того, как фид пошёл дальше, или если он молчал через экспирацию.
    function settleWithRound(uint64 expiry, uint80 roundId) external {
        _settle(expiry, roundId);
    }

    function _settle(uint64 expiry, uint80 roundId) internal {
        if (expiry == 0 || block.timestamp < expiry) revert NotExpired();
        if (settlePriceWad[expiry] != 0) revert AlreadySettled();

        (bool ok, uint256 price, uint256 at) = _roundAt(roundId);
        if (!ok) revert BadPrice();

        if (at <= expiry) {
            // Цена, действовавшая в момент экспирации: после неё не должно быть
            // раунда, успевшего до экспирации.
            (bool hasNext, uint256 nextAt) = _roundTime(roundId + 1);
            if (hasNext && nextAt <= expiry) revert NotTheSettleRound();
            // Фид, замолчавший задолго до закрытия, неделю не рассчитывает: ждём свежей цены.
            if (at + maxPriceAgeSettle < expiry) revert StalePrice();
        } else {
            // Фид молчал через экспирацию: неделю рассчитывает первый раунд после неё,
            // и только если предыдущий был слишком стар, чтобы считать по нему.
            (bool hasPrev, uint256 prevAt) = _roundTime(roundId - 1);
            if (hasPrev) {
                if (prevAt > expiry) revert NotTheSettleRound();
                if (prevAt + maxPriceAgeSettle >= expiry) revert NotTheSettleRound();
            }
        }

        settlePriceWad[expiry] = price;
        emit Settled(expiry, price, at);
    }

    function _roundAt(uint80 roundId) internal view returns (bool ok, uint256 price, uint256 at) {
        try feed.getRoundData(roundId) returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer > 0 && updatedAt > 0) {
                return (true, uint256(answer) * (10 ** (18 - feedDecimals)), updatedAt);
            }
        } catch {}
        return (false, 0, 0);
    }

    /// @dev Соседний раунд может не существовать, а после смены агрегатора
    ///      нумерация раундов начинается заново и соседа не найти. В обоих
    ///      случаях считаем, что соседа нет.
    function _roundTime(uint80 roundId) internal view returns (bool ok, uint256 at) {
        (bool found,, uint256 updatedAt) = _roundAt(roundId);
        return (found, updatedAt);
    }
```

- [ ] **Step 4: Прогнать**

Run: `cd contracts && forge test --match-path test/NuvoPool.settle.t.sol -vv`
Expected: PASS, десять тестов.

- [ ] **Step 5: Коммит**

```bash
git add contracts && git commit -m "feat: settlement by the round in effect at the expiry"
```

---

### Task 7: NuvoPool — выплата и комиссия протокола

Четыре исхода из спецификации, каждый со своим движением между тремя учётами. Комиссия берётся долей от премии, которую заплатил пул, из инвентарной части и только при выплате. Выплата подписчику ею не уменьшается никогда.

**Files:**
- Modify: `contracts/src/NuvoPool.sol`
- Test: `contracts/test/NuvoPool.claim.t.sol`

**Interfaces:**
- Consumes: `Position`, `settlePriceWad` (Задачи 4–6), `_converted` (Задача 5).
- Produces: `claim(uint256 id) returns (address asset, uint256 amount)`, `positionPayout(uint256 id) view returns (bool settled, bool converted, address asset, uint256 amount)`, `setFeeBps(uint16) onlyOwner`, `withdrawFees(address to) onlyOwner`, события `Claimed`, `FeeSet`, `FeesWithdrawn`.

- [ ] **Step 1: Написать падающий тест**

`contracts/test/NuvoPool.claim.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

contract PoolClaimTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    NuvoPool internal pool;

    address internal owner = address(0xA11CE);
    address internal lp = address(0xB0B);
    address internal user = address(0xD00D);
    address internal other = address(0xE11E);
    uint64 internal expiry;

    uint256 internal constant BUY_LOW_LOCK_TOKEN = 10_326_530_612_244_897_959; // 1012 / 98
    uint256 internal constant SELL_HIGH_LOCK_USDG = 1_031_220_000; // 10.11 x 102

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        factory = new MockFactory();

        uint8[] memory dirs = new uint8[](2);
        uint16[] memory dist = new uint16[](2);
        uint16[] memory bps = new uint16[](2);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        (dirs[1], dist[1], bps[1]) = (1, 200, 110);
        PremiumModel model = new PremiumModel(dirs, dist, bps);

        feed.push(100e8, block.timestamp);
        expiry = uint64(block.timestamp + 3 days);
        uint64[] memory list = new uint64[](1);
        list[0] = expiry;
        factory.setExpiries(list);

        pool = new NuvoPool(
            NuvoPool.Params({
                usdg: address(usdg),
                token: address(stock),
                feed: address(feed),
                premiumModel: address(model),
                factory: address(factory),
                owner: owner,
                guardian: owner,
                maxPremiumBps: 1_000,
                maxPriceAge: 80 hours,
                maxPriceAgeSettle: 6 hours,
                minDepositValueWad: 100e18,
                maxPositionValueWad: 50_000e18,
                maxExpiryLockValueWad: 500_000e18,
                maxLockedShareBps: 8_000
            })
        );

        usdg.mint(lp, 1_000_000e6);
        stock.mint(lp, 10_000e18);
        usdg.mint(user, 100_000e6);
        stock.mint(user, 1_000e18);

        vm.startPrank(lp);
        usdg.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        pool.addLiquidity(100_000e6, 1_000e18, 0);
        vm.stopPrank();

        vm.startPrank(user);
        usdg.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _buyLow() internal returns (uint256) {
        vm.prank(user);
        return pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
    }

    function _sellHigh() internal returns (uint256) {
        vm.prank(user);
        return pool.subscribe(1, 200, 10e18, 0, uint64(block.timestamp + 300));
    }

    function _settleAt(int256 answer) internal {
        feed.push(answer, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        pool.settle(expiry);
    }

    function test_buyLowConvertedPaysTheStock() public {
        uint256 id = _buyLow();
        _settleAt(95e8);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);

        assertEq(asset, address(stock));
        assertEq(amount, BUY_LOW_LOCK_TOKEN);
        assertEq(stock.balanceOf(user), 1_000e18 + BUY_LOW_LOCK_TOKEN);
        // депозит стал инвентарём, замок под отказ вернулся свободным
        assertEq(pool.freeUsdg(), 101_000e6);
        assertEq(pool.freeToken(), 1_000e18 - BUY_LOW_LOCK_TOKEN);
        assertEq(pool.lockedUsdg(), 0);
        assertEq(pool.lockedToken(), 0);
        assertEq(pool.depositsUsdg(), 0);
    }

    function test_buyLowNotConvertedPaysDepositPlusPremium() public {
        uint256 id = _buyLow();
        _settleAt(99e8);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);

        assertEq(asset, address(usdg));
        assertEq(amount, 1_012e6);
        assertEq(usdg.balanceOf(user), 100_000e6 - 1_000e6 + 1_012e6);
        assertEq(pool.freeUsdg(), 99_988e6, "the premium left the inventory");
        assertEq(pool.freeToken(), 1_000e18, "the conversion lock came back");
        assertEq(pool.depositsUsdg(), 0);
    }

    function test_sellHighConvertedPaysUsdg() public {
        uint256 id = _sellHigh();
        _settleAt(105e8);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);

        assertEq(asset, address(usdg));
        assertEq(amount, SELL_HIGH_LOCK_USDG);
        assertEq(pool.freeToken(), 1_010e18, "the stock became inventory");
        assertEq(pool.freeUsdg(), 100_000e6 - SELL_HIGH_LOCK_USDG);
        assertEq(pool.depositsToken(), 0);
    }

    function test_sellHighNotConvertedPaysDepositPlusPremium() public {
        uint256 id = _sellHigh();
        _settleAt(100e8);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);

        assertEq(asset, address(stock));
        assertEq(amount, 10.11e18);
        assertEq(pool.freeUsdg(), 100_000e6, "the conversion lock came back");
        assertEq(pool.freeToken(), 1_000e18 - 0.11e18);
        assertEq(pool.depositsToken(), 0);
    }

    function test_atTheStrikeBuyLowConverts() public {
        uint256 id = _buyLow();
        _settleAt(98e8);
        vm.prank(user);
        (address asset,) = pool.claim(id);
        assertEq(asset, address(stock), "at or below the strike converts");
    }

    function test_atTheStrikeSellHighConverts() public {
        uint256 id = _sellHigh();
        _settleAt(102e8);
        vm.prank(user);
        (address asset,) = pool.claim(id);
        assertEq(asset, address(usdg), "at or above the strike converts");
    }

    // Review Focus 4
    function test_cannotClaimTwice() public {
        uint256 id = _buyLow();
        _settleAt(99e8);
        vm.prank(user);
        pool.claim(id);
        vm.prank(user);
        vm.expectRevert(NuvoPool.AlreadyClaimed.selector);
        pool.claim(id);
    }

    function test_cannotClaimSomeoneElsesPosition() public {
        uint256 id = _buyLow();
        _settleAt(99e8);
        vm.prank(other);
        vm.expectRevert(NuvoPool.NotYours.selector);
        pool.claim(id);
    }

    function test_cannotClaimBeforeSettlement() public {
        uint256 id = _buyLow();
        vm.warp(expiry + 1 hours);
        vm.prank(user);
        vm.expectRevert(NuvoPool.NotSettled.selector);
        pool.claim(id);
    }

    function test_positionPayoutShowsTheOutcomeBeforeClaiming() public {
        uint256 id = _buyLow();
        (bool settled,,,) = pool.positionPayout(id);
        assertFalse(settled);

        _settleAt(95e8);
        (bool settled2, bool converted, address asset, uint256 amount) = pool.positionPayout(id);
        assertTrue(settled2);
        assertTrue(converted);
        assertEq(asset, address(stock));
        assertEq(amount, BUY_LOW_LOCK_TOKEN);
    }

    function test_feeTakesAShareOfThePremiumFromTheInventory() public {
        vm.prank(owner);
        pool.setFeeBps(1_000); // 10% от премии

        uint256 id = _buyLow();
        _settleAt(99e8);
        vm.prank(user);
        (, uint256 amount) = pool.claim(id);

        assertEq(amount, 1_012e6, "the subscriber is paid in full");
        assertEq(pool.feesUsdg(), 1_200_000, "10% of the 12 USDG premium");
        assertEq(pool.freeUsdg(), 99_988e6 - 1_200_000);

        vm.prank(owner);
        pool.withdrawFees(owner);
        assertEq(usdg.balanceOf(owner), 1_200_000);
        assertEq(pool.feesUsdg(), 0);
    }

    function test_feeOnAConvertedOutcomeIsTakenInTheOtherAsset() public {
        vm.prank(owner);
        pool.setFeeBps(1_000);
        uint256 id = _buyLow();
        _settleAt(95e8);
        vm.prank(user);
        pool.claim(id);
        assertGt(pool.feesToken(), 0);
        assertEq(pool.feesUsdg(), 0);
    }

    function test_rejectsAFeeAboveTheCap() public {
        vm.prank(owner);
        vm.expectRevert(NuvoPool.TooHigh.selector);
        pool.setFeeBps(2_001);
    }

    function test_onlyTheOwnerSetsTheFee() public {
        vm.prank(user);
        vm.expectRevert();
        pool.setFeeBps(100);
    }

    function test_claimWorksWhilePausedAndAfterOwnershipIsRenounced() public {
        uint256 id = _buyLow();
        _settleAt(99e8);
        vm.prank(owner);
        pool.renounceOwnership();
        vm.prank(user);
        (, uint256 amount) = pool.claim(id);
        assertEq(amount, 1_012e6, "nothing an admin does can hold a payout");
    }
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd contracts && forge test --match-path test/NuvoPool.claim.t.sol`
Expected: FAIL — `claim` не объявлена.

- [ ] **Step 3: Реализовать**

Добавить в `contracts/src/NuvoPool.sol`:

```solidity
    // --- выплата ---

    function claim(uint256 id) external nonReentrant returns (address asset, uint256 amount) {
        Position storage p = _positions[id];
        if (p.owner != msg.sender) revert NotYours();
        if (p.claimed) revert AlreadyClaimed();
        uint256 price = settlePriceWad[p.expiry];
        if (price == 0) revert NotSettled();
        p.claimed = true;

        bool converted = p.direction == BUY_LOW ? price <= p.strikeWad : price >= p.strikeWad;

        // Оба замка снимаются, дальше один уходит на выплату, другой — в свободное.
        lockedUsdg -= p.lockUsdg;
        lockedToken -= p.lockToken;

        uint256 premium;
        bool premiumInUsdg;

        if (p.direction == BUY_LOW) {
            depositsUsdg -= p.deposit;
            if (converted) {
                // пул отдаёт акцию и оставляет себе USDG подписчика
                asset = address(token);
                amount = p.lockToken;
                freeUsdg += p.lockUsdg + p.deposit;
                premium = p.lockToken - _converted(BUY_LOW, p.deposit, p.strikeWad, 0);
                token.safeTransfer(msg.sender, amount);
            } else {
                asset = address(usdg);
                amount = p.deposit + p.lockUsdg;
                freeToken += p.lockToken;
                premium = p.lockUsdg;
                premiumInUsdg = true;
                usdg.safeTransfer(msg.sender, amount);
            }
        } else {
            depositsToken -= p.deposit;
            if (converted) {
                // пул забирает акцию и платит USDG по страйку
                asset = address(usdg);
                amount = p.lockUsdg;
                freeToken += p.lockToken + p.deposit;
                premium = p.lockUsdg - _converted(SELL_HIGH, p.deposit, p.strikeWad, 0);
                premiumInUsdg = true;
                usdg.safeTransfer(msg.sender, amount);
            } else {
                asset = address(token);
                amount = p.deposit + p.lockToken;
                freeUsdg += p.lockUsdg;
                premium = p.lockToken;
                token.safeTransfer(msg.sender, amount);
            }
        }

        _takeFee(premiumInUsdg, premium);
        emit Claimed(id, msg.sender, asset, amount, converted);
    }

    /// @notice Что выплатится по позиции. Экран позиций показывает это до нажатия Claim.
    function positionPayout(uint256 id)
        external
        view
        returns (bool settled, bool converted, address asset, uint256 amount)
    {
        Position memory p = _positions[id];
        uint256 price = settlePriceWad[p.expiry];
        if (price == 0) return (false, false, address(0), 0);
        settled = true;
        converted = p.direction == BUY_LOW ? price <= p.strikeWad : price >= p.strikeWad;
        if (p.direction == BUY_LOW) {
            return converted
                ? (true, true, address(token), p.lockToken)
                : (true, false, address(usdg), p.deposit + p.lockUsdg);
        }
        return converted
            ? (true, true, address(usdg), p.lockUsdg)
            : (true, false, address(token), p.deposit + p.lockToken);
    }

    /// @dev Комиссия — доля от премии, которую заплатил пул, и берётся она из
    ///      инвентарной части, уже пополненной к этому моменту. Депозит
    ///      подписчика и его выплата комиссией не затрагиваются.
    function _takeFee(bool inUsdg, uint256 premium) internal {
        uint16 f = feeBps;
        if (f == 0 || premium == 0) return;
        uint256 fee = (premium * f) / BPS;
        if (inUsdg) {
            if (fee > freeUsdg) fee = freeUsdg;
            freeUsdg -= fee;
            feesUsdg += fee;
        } else {
            if (fee > freeToken) fee = freeToken;
            freeToken -= fee;
            feesToken += fee;
        }
    }

    function setFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert TooHigh();
        feeBps = bps;
        emit FeeSet(bps);
    }

    /// @notice Единственное, что владелец может вывести из пула.
    function withdrawFees(address to) external onlyOwner {
        uint256 u = feesUsdg;
        uint256 t = feesToken;
        feesUsdg = 0;
        feesToken = 0;
        if (u > 0) usdg.safeTransfer(to, u);
        if (t > 0) token.safeTransfer(to, t);
        emit FeesWithdrawn(to, u, t);
    }
```

- [ ] **Step 4: Прогнать**

Run: `cd contracts && forge test --match-path test/NuvoPool.claim.t.sol -vv`
Expected: PASS, шестнадцать тестов.

- [ ] **Step 5: Коммит**

```bash
git add contracts && git commit -m "feat: the four settlement outcomes and the protocol fee"
```

---

### Task 8: NuvoPool — пауза, guardian, смена модели премий

**Files:**
- Modify: `contracts/src/NuvoPool.sol`
- Test: `contracts/test/NuvoPool.admin.t.sol`

**Interfaces:**
- Consumes: `paused`, `guardian`, `premiumModel`, `pendingModel`, `pendingModelEta`, `_setLimits` (Задача 4).
- Produces: `pause()`, `unpause()`, `setGuardian(address)`, `scheduleModel(address)`, `applyModel()`, `setLimits(uint64,uint64,uint256,uint256,uint256,uint16)`.

- [ ] **Step 1: Написать падающий тест**

`contracts/test/NuvoPool.admin.t.sol` — та же `setUp`, что в `NuvoPool.claim.t.sol` (повторить её целиком, тесты читают по одному, а не подряд), и такие проверки:

```solidity
    function test_guardianCanPauseOwnerCanRelease() public {
        vm.prank(owner);
        pool.setGuardian(address(0x6a7d));

        vm.prank(address(0x6a7d));
        pool.pause();
        assertTrue(pool.paused());

        vm.prank(address(0x6a7d));
        vm.expectRevert(NuvoPool.NotAllowed.selector);
        pool.unpause();

        vm.prank(owner);
        pool.unpause();
        assertFalse(pool.paused());
    }

    function test_pauseStopsSubscriptionsAndDeposits() public {
        vm.prank(owner);
        pool.pause();

        assertEq(pool.preview(0, 200, 1_000e6).code, pool.CODE_PAUSED());

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(NuvoPool.Unavailable.selector, pool.CODE_PAUSED()));
        pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));

        vm.prank(lp);
        vm.expectRevert(NuvoPool.Paused.selector);
        pool.addLiquidity(1_000e6, 0, 0);
    }

    function test_pauseDoesNotStopWithdrawalsSettlementOrClaims() public {
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));

        vm.prank(owner);
        pool.pause();

        feed.push(99e8, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        pool.settle(expiry);

        vm.prank(user);
        (, uint256 amount) = pool.claim(id);
        assertEq(amount, 1_012e6);

        vm.prank(lp);
        pool.removeLiquidity(pool.sharesOf(lp) / 2, 0, 0);
    }

    function test_strangerCannotPause() public {
        vm.prank(user);
        vm.expectRevert(NuvoPool.NotAllowed.selector);
        pool.pause();
    }

    function test_modelChangeWaitsOutTheDelay() public {
        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (0, 200, 300);
        PremiumModel next = new PremiumModel(dirs, dist, bps);

        vm.prank(owner);
        pool.scheduleModel(address(next));
        assertEq(pool.preview(0, 200, 1_000e6).premiumBps, 120, "the old rate holds until the delay is out");

        vm.expectRevert(NuvoPool.TooEarly.selector);
        pool.applyModel();

        vm.warp(block.timestamp + 2 days);
        pool.applyModel();
        assertEq(pool.preview(0, 200, 1_000e6).premiumBps, 300);
    }

    function test_applyWithoutAScheduleFails() public {
        vm.expectRevert(NuvoPool.NothingPending.selector);
        pool.applyModel();
    }

    function test_limitsCannotBeSetOutsideTheirCaps() public {
        vm.startPrank(owner);
        vm.expectRevert(NuvoPool.TooHigh.selector);
        pool.setLimits(8 days, 6 hours, 100e18, 50_000e18, 500_000e18, 8_000);
        vm.expectRevert(NuvoPool.TooHigh.selector);
        pool.setLimits(80 hours, 25 hours, 100e18, 50_000e18, 500_000e18, 8_000);
        vm.expectRevert(NuvoPool.TooHigh.selector);
        pool.setLimits(80 hours, 6 hours, 100e18, 50_000e18, 500_000e18, 10_001);
        vm.stopPrank();
    }

    function test_theOwnerCannotTakeTheInventory() public {
        // единственный путь наружу для владельца — накопленная комиссия, и она пуста
        vm.prank(owner);
        pool.withdrawFees(owner);
        assertEq(usdg.balanceOf(owner), 0);
        assertEq(stock.balanceOf(owner), 0);
    }
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd contracts && forge test --match-path test/NuvoPool.admin.t.sol`
Expected: FAIL — `pause`, `scheduleModel`, `setLimits` не объявлены.

- [ ] **Step 3: Реализовать**

```solidity
    // --- роли и настройки ---

    /// @notice Останавливает только подписки и вклады. Расчёт, выплата и вывод
    ///         вкладчика не останавливаются ничем: иначе пауза заперла бы чужие деньги.
    function pause() external {
        if (msg.sender != owner() && msg.sender != guardian) revert NotAllowed();
        paused = true;
        emit PausedSet(true, msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedSet(false, msg.sender);
    }

    function setGuardian(address who) external onlyOwner {
        guardian = who;
        emit GuardianSet(who);
    }

    /// @notice Новая сетка премий назначается заранее и вступает в силу через MODEL_DELAY.
    function scheduleModel(address model) external onlyOwner {
        if (model == address(0)) revert NotAllowed();
        pendingModel = IPremiumModel(model);
        pendingModelEta = block.timestamp + MODEL_DELAY;
        emit ModelScheduled(model, pendingModelEta);
    }

    /// @notice Открыто всем: после задержки применить назначенную модель.
    function applyModel() external {
        if (address(pendingModel) == address(0)) revert NothingPending();
        if (block.timestamp < pendingModelEta) revert TooEarly();
        premiumModel = pendingModel;
        pendingModel = IPremiumModel(address(0));
        pendingModelEta = 0;
        emit ModelSet(address(premiumModel));
    }

    function setLimits(
        uint64 priceAge,
        uint64 priceAgeSettle,
        uint256 minDeposit,
        uint256 maxPosition,
        uint256 maxExpiryLock,
        uint16 lockedShareBps
    ) external onlyOwner {
        _setLimits(priceAge, priceAgeSettle, minDeposit, maxPosition, maxExpiryLock, lockedShareBps);
    }
```

- [ ] **Step 4: Прогнать**

Run: `cd contracts && forge test --match-path test/NuvoPool.admin.t.sol -vv`
Expected: PASS, восемь тестов.

- [ ] **Step 5: Коммит**

```bash
git add contracts && git commit -m "feat: pause, guardian and a delayed premium model change"
```

---

### Task 9: Инварианты под случайными последовательностями

Пять утверждений из раздела 8 спецификации, проверяемые случайными цепочками действий: вклады, выводы, подписки в обе стороны, скачки цены, расчёты, выплаты.

**Files:**
- Create: `contracts/test/invariant/PoolHandler.sol`, `contracts/test/invariant/PoolInvariants.t.sol`
- Modify: `contracts/foundry.toml` (секция `[invariant]`)

**Interfaces:**
- Consumes: весь `NuvoPool` (Задачи 4–8).
- Produces: `PoolHandler` с призрачными счётчиками `sharesMinted`, `sharesBurned`, `openDepositsUsdg`, `openDepositsToken` и методами `addLiquidity`, `removeLiquidity`, `subscribeBuyLow`, `subscribeSellHigh`, `settleSome`, `claimSome`, `advance`.

- [ ] **Step 1: Настроить прогон**

Добавить в `contracts/foundry.toml`:

```toml
[invariant]
runs = 64
depth = 32
fail_on_revert = false
```

- [ ] **Step 2: Написать обработчик**

`contracts/test/invariant/PoolHandler.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../../src/NuvoPool.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockFactory} from "../mocks/MockFactory.sol";

/// @notice Случайные действия по пулу, с призрачным учётом того, что
///         инвариантам нужно знать снаружи контракта.
contract PoolHandler is Test {
    NuvoPool public pool;
    MockERC20 public usdg;
    MockERC20 public stock;
    MockFeed public feed;
    MockFactory public factory;

    address[3] public actors;
    uint64[] public expiries;

    uint256 public sharesMinted;
    uint256 public sharesBurned;
    uint256 public openDepositsUsdg;
    uint256 public openDepositsToken;

    uint256[] public ids;
    mapping(uint256 => address) public idOwner;

    constructor(
        NuvoPool p,
        MockERC20 u,
        MockERC20 s,
        MockFeed f,
        MockFactory fac,
        uint64[] memory schedule
    ) {
        pool = p;
        usdg = u;
        stock = s;
        feed = f;
        factory = fac;
        for (uint256 i = 0; i < schedule.length; i++) expiries.push(schedule[i]);

        actors = [address(0xA1), address(0xA2), address(0xA3)];
        for (uint256 i = 0; i < actors.length; i++) {
            usdg.mint(actors[i], 1_000_000e6);
            stock.mint(actors[i], 10_000e18);
            vm.startPrank(actors[i]);
            usdg.approve(address(pool), type(uint256).max);
            stock.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function addLiquidity(uint256 seed, uint256 u, uint256 t) public {
        address a = _actor(seed);
        u = bound(u, 0, 100_000e6);
        t = bound(t, 0, 1_000e18);
        vm.prank(a);
        try pool.addLiquidity(u, t, 0) returns (uint256 s) {
            sharesMinted += s;
        } catch {}
    }

    function removeLiquidity(uint256 seed, uint256 share) public {
        address a = _actor(seed);
        uint256 held = pool.sharesOf(a);
        if (held == 0) return;
        share = bound(share, 1, held);
        vm.prank(a);
        try pool.removeLiquidity(share, 0, 0) {
            sharesBurned += share;
        } catch {}
    }

    function _rung(uint256 seed) internal pure returns (uint16) {
        uint16[4] memory rungs = [uint16(200), 400, 600, 800];
        return rungs[seed % 4];
    }

    function subscribeBuyLow(uint256 seed, uint256 amount, uint256 rung) public {
        address a = _actor(seed);
        amount = bound(amount, 100e6, 20_000e6);
        uint16 distance = _rung(rung);
        vm.prank(a);
        try pool.subscribe(0, distance, amount, type(uint256).max, uint64(block.timestamp + 1)) returns (
            uint256 id
        ) {
            ids.push(id);
            idOwner[id] = a;
            openDepositsUsdg += amount;
        } catch {}
    }

    function subscribeSellHigh(uint256 seed, uint256 amount, uint256 rung) public {
        address a = _actor(seed);
        amount = bound(amount, 1e18, 100e18);
        uint16 distance = _rung(rung);
        vm.prank(a);
        try pool.subscribe(1, distance, amount, 0, uint64(block.timestamp + 1)) returns (uint256 id) {
            ids.push(id);
            idOwner[id] = a;
            openDepositsToken += amount;
        } catch {}
    }

    function settleSome(uint256 seed) public {
        if (expiries.length == 0) return;
        uint64 e = expiries[seed % expiries.length];
        try pool.settle(e) {} catch {}
    }

    function claimSome(uint256 seed) public {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        NuvoPool.Position memory p = pool.position(id);
        if (p.claimed) return;
        vm.prank(idOwner[id]);
        try pool.claim(id) {
            if (p.direction == 0) openDepositsUsdg -= p.deposit;
            else openDepositsToken -= p.deposit;
        } catch {}
    }

    /// @notice Двигает время и цену: без этого расчёт никогда не наступает.
    function advance(uint256 hoursAhead, uint256 price) public {
        vm.warp(block.timestamp + bound(hoursAhead, 1, 48) * 1 hours);
        feed.push(int256(bound(price, 10e8, 1_000e8)), block.timestamp);
    }
}
```

- [ ] **Step 3: Написать инварианты**

`contracts/test/invariant/PoolInvariants.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../../src/NuvoPool.sol";
import {PremiumModel} from "../../src/PremiumModel.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockFactory} from "../mocks/MockFactory.sol";
import {PoolHandler} from "./PoolHandler.sol";

contract PoolInvariants is Test {
    NuvoPool internal pool;
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    PoolHandler internal handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        factory = new MockFactory();

        uint8[] memory dirs = new uint8[](8);
        uint16[] memory dist = new uint16[](8);
        uint16[] memory bps = new uint16[](8);
        uint16[4] memory rungs = [uint16(200), 400, 600, 800];
        uint16[4] memory rates = [uint16(120), 85, 60, 40];
        for (uint256 i = 0; i < 4; i++) {
            (dirs[i], dist[i], bps[i]) = (0, rungs[i], rates[i]);
            (dirs[i + 4], dist[i + 4], bps[i + 4]) = (1, rungs[i], rates[i]);
        }
        PremiumModel model = new PremiumModel(dirs, dist, bps);

        feed.push(100e8, block.timestamp);

        uint64[] memory schedule = new uint64[](8);
        for (uint256 i = 0; i < 8; i++) schedule[i] = uint64(block.timestamp + (i + 1) * 7 days);
        factory.setExpiries(schedule);

        pool = new NuvoPool(
            NuvoPool.Params({
                usdg: address(usdg),
                token: address(stock),
                feed: address(feed),
                premiumModel: address(model),
                factory: address(factory),
                owner: address(this),
                guardian: address(this),
                maxPremiumBps: 1_000,
                maxPriceAge: 80 hours,
                maxPriceAgeSettle: 6 hours,
                minDepositValueWad: 100e18,
                maxPositionValueWad: 50_000e18,
                maxExpiryLockValueWad: 1_000_000e18,
                maxLockedShareBps: 8_000
            })
        );

        handler = new PoolHandler(pool, usdg, stock, feed, factory, schedule);
        targetContract(address(handler));
    }

    /// 1. Обязательства никогда не превышают того, что на самом деле лежит на контракте.
    function invariant_contractCoversEveryClaimOnIt() public view {
        assertGe(
            usdg.balanceOf(address(pool)),
            pool.freeUsdg() + pool.lockedUsdg() + pool.depositsUsdg() + pool.feesUsdg()
        );
        assertGe(
            stock.balanceOf(address(pool)),
            pool.freeToken() + pool.lockedToken() + pool.depositsToken() + pool.feesToken()
        );
    }

    /// 3. Депозиты подписчиков учтены отдельно и целиком: их нельзя потратить на чужую выплату.
    function invariant_subscriberDepositsAreUntouched() public view {
        assertEq(pool.depositsUsdg(), handler.openDepositsUsdg());
        assertEq(pool.depositsToken(), handler.openDepositsToken());
    }

    /// 4. Замки покрывают любой исход каждой незакрытой позиции.
    function invariant_locksCoverEveryOpenPosition() public view {
        uint256 lockedU;
        uint256 lockedT;
        uint256 n = pool.positionCount();
        for (uint256 i = 0; i < n; i++) {
            NuvoPool.Position memory p = pool.position(i);
            if (p.claimed) continue;
            lockedU += p.lockUsdg;
            lockedT += p.lockToken;
        }
        assertEq(pool.lockedUsdg(), lockedU);
        assertEq(pool.lockedToken(), lockedT);
    }

    /// 5. Паи появляются и исчезают только при вводе и выводе вкладчика.
    ///    В пуле, куда ещё не вкладывали, паёв нет вовсе; как только первый вклад
    ///    прошёл, к выданным долям добавляется запертая доля основания.
    function invariant_sharesOnlyMoveWithLiquidity() public view {
        if (pool.totalShares() == 0) {
            assertEq(handler.sharesMinted(), 0);
            assertEq(handler.sharesBurned(), 0);
            return;
        }
        assertEq(pool.totalShares() + handler.sharesBurned(), handler.sharesMinted() + 1e15);
    }

    /// 2. Свободный инвентарь неотрицателен: вычитание ниже нуля откатило бы действие,
    ///    здесь проверяется, что он к тому же покрыт балансом контракта.
    function invariant_freeInventoryIsReal() public view {
        assertLe(pool.freeUsdg() + pool.lockedUsdg(), usdg.balanceOf(address(pool)));
        assertLe(pool.freeToken() + pool.lockedToken(), stock.balanceOf(address(pool)));
    }
}
```

- [ ] **Step 4: Прогнать**

Run: `cd contracts && forge test --match-path test/invariant/PoolInvariants.t.sol -vv`
Expected: PASS, пять инвариантов. Если какой-то упал — Foundry печатает последовательность вызовов; воспроизвести её обычным тестом и чинить контракт, а не инвариант.

- [ ] **Step 5: Прогнать всё**

Run: `cd contracts && forge test`
Expected: PASS целиком.

- [ ] **Step 6: Коммит**

```bash
git add contracts && git commit -m "test: invariants over random sequences of pool actions"
```

---

### Task 10: NuvoPoolFactory

Реестр пулов и календарь экспираций. Календарь нужен потому, что «пятница 16:00 ET» в UTC дважды в год сдвигается, и вычислять её в контракте значило бы зашивать в него правила перехода на летнее время.

**Files:**
- Create: `contracts/src/NuvoPoolFactory.sol`
- Test: `contracts/test/NuvoPoolFactory.t.sol`

**Interfaces:**
- Consumes: `NuvoPool.Params` (Задача 4), `INuvoPoolFactory` (Задача 2).
- Produces:
  - `constructor(address usdg, address owner)`
  - `createPool(NuvoPool.Params calldata p) onlyOwner returns (address pool)`
  - `addExpiries(uint64[] calldata list) onlyOwner`
  - `nextExpiry(uint64 minLead) view returns (uint64)`
  - `poolCount() view returns (uint256)`, `pools(uint256) view returns (address)`, `poolOf(address token) view returns (address)`
  - `expiryCount() view returns (uint256)`, `expiries(uint256) view returns (uint64)`
  - события `PoolCreated(address indexed token, address indexed pool)`, `ExpiriesAdded(uint256 count, uint64 last)`

- [ ] **Step 1: Написать падающий тест**

`contracts/test/NuvoPoolFactory.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {NuvoPoolFactory} from "../src/NuvoPoolFactory.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";

contract FactoryTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    PremiumModel internal model;
    NuvoPoolFactory internal factory;
    address internal owner = address(0xA11CE);

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        feed.push(100e8, block.timestamp);

        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        model = new PremiumModel(dirs, dist, bps);

        factory = new NuvoPoolFactory(address(usdg), owner);
    }

    function _params(address token, address feed_) internal view returns (NuvoPool.Params memory) {
        return NuvoPool.Params({
            usdg: address(usdg),
            token: token,
            feed: feed_,
            premiumModel: address(model),
            factory: address(factory),
            owner: owner,
            guardian: owner,
            maxPremiumBps: 1_000,
            maxPriceAge: 80 hours,
            maxPriceAgeSettle: 6 hours,
            minDepositValueWad: 100e18,
            maxPositionValueWad: 50_000e18,
            maxExpiryLockValueWad: 500_000e18,
            maxLockedShareBps: 8_000
        });
    }

    function test_createsAPoolAndRegistersIt() public {
        vm.prank(owner);
        address pool = factory.createPool(_params(address(stock), address(feed)));
        assertEq(factory.poolOf(address(stock)), pool);
        assertEq(factory.poolCount(), 1);
        assertEq(factory.pools(0), pool);
        assertEq(address(NuvoPool(pool).factory()), address(factory));
        assertEq(NuvoPool(pool).owner(), owner);
    }

    function test_refusesASecondPoolForTheSameToken() public {
        vm.startPrank(owner);
        factory.createPool(_params(address(stock), address(feed)));
        vm.expectRevert(NuvoPoolFactory.PoolExists.selector);
        factory.createPool(_params(address(stock), address(feed)));
        vm.stopPrank();
    }

    function test_refusesADeadFeed() public {
        MockFeed dead = new MockFeed(8);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.FeedNotLive.selector);
        factory.createPool(_params(address(stock), address(dead)));
    }

    function test_refusesAForeignUsdg() public {
        MockERC20 fake = new MockERC20("Fake", "FAKE", 6);
        NuvoPool.Params memory p = _params(address(stock), address(feed));
        p.usdg = address(fake);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.WrongUsdg.selector);
        factory.createPool(p);
    }

    function test_refusesAPoolPointingAtAnotherFactory() public {
        NuvoPool.Params memory p = _params(address(stock), address(feed));
        p.factory = address(0xdead);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.WrongFactory.selector);
        factory.createPool(p);
    }

    function test_onlyTheOwnerCreatesPools() public {
        vm.expectRevert();
        factory.createPool(_params(address(stock), address(feed)));
    }

    function test_calendarIsPublishedAheadAndOnlyGrows() public {
        uint64[] memory list = new uint64[](3);
        list[0] = uint64(block.timestamp + 2 days);
        list[1] = uint64(block.timestamp + 9 days);
        list[2] = uint64(block.timestamp + 16 days);
        vm.prank(owner);
        factory.addExpiries(list);
        assertEq(factory.expiryCount(), 3);
        assertEq(factory.expiries(1), list[1]);

        uint64[] memory backwards = new uint64[](1);
        backwards[0] = uint64(block.timestamp + 10 days);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.NotIncreasing.selector);
        factory.addExpiries(backwards);
    }

    function test_nextExpirySkipsTheOneInsideTheLead() public {
        uint64[] memory list = new uint64[](2);
        list[0] = uint64(block.timestamp + 2 days);
        list[1] = uint64(block.timestamp + 9 days);
        vm.prank(owner);
        factory.addExpiries(list);

        assertEq(factory.nextExpiry(24 hours), list[0]);
        vm.warp(list[0] - 24 hours); // ровно отсечка
        assertEq(factory.nextExpiry(24 hours), list[1]);
        vm.warp(list[1] + 1);
        assertEq(factory.nextExpiry(24 hours), 0, "the calendar has run out");
    }

    function test_rejectsAnExpiryInThePast() public {
        uint64[] memory list = new uint64[](1);
        list[0] = uint64(block.timestamp - 1);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.NotIncreasing.selector);
        factory.addExpiries(list);
    }
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd contracts && forge test --match-path test/NuvoPoolFactory.t.sol`
Expected: FAIL — `NuvoPoolFactory.sol` не существует.

- [ ] **Step 3: Реализовать**

`contracts/src/NuvoPoolFactory.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {INuvoPoolFactory} from "./interfaces/INuvoPoolFactory.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {NuvoPool} from "./NuvoPool.sol";

/// @notice Реестр пулов и календарь экспираций. Пул, созданный не отсюда,
///         протоколом не считается: сайт читает список только у фабрики.
contract NuvoPoolFactory is Ownable2Step, INuvoPoolFactory {
    address public immutable usdg;

    address[] public pools;
    mapping(address => address) public poolOf;
    uint64[] public expiries;

    error PoolExists();
    error FeedNotLive();
    error WrongUsdg();
    error WrongFactory();
    error NotIncreasing();
    error TooManyDecimals();

    event PoolCreated(address indexed token, address indexed pool);
    event ExpiriesAdded(uint256 count, uint64 last);

    constructor(address usdg_, address owner_) Ownable(owner_) {
        usdg = usdg_;
    }

    function createPool(NuvoPool.Params calldata p) external onlyOwner returns (address pool) {
        if (p.usdg != usdg) revert WrongUsdg();
        if (p.factory != address(this)) revert WrongFactory();
        if (poolOf[p.token] != address(0)) revert PoolExists();
        if (IERC20Metadata(p.token).decimals() > 18) revert TooManyDecimals();

        // Живой фид — условие создания пула: без цены нельзя ни подписать, ни рассчитать.
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(p.feed).latestRoundData();
        if (answer <= 0 || updatedAt == 0) revert FeedNotLive();

        pool = address(new NuvoPool(p));
        poolOf[p.token] = pool;
        pools.push(pool);
        emit PoolCreated(p.token, pool);
    }

    /// @notice Публикуем отметки времени экспираций заранее, на месяцы вперёд.
    ///         Список только растёт и только вперёд: сдвинуть уже объявленную
    ///         экспирацию нельзя, иначе открытые позиции поехали бы.
    function addExpiries(uint64[] calldata list) external onlyOwner {
        uint64 last = expiries.length > 0 ? expiries[expiries.length - 1] : uint64(block.timestamp);
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] <= last) revert NotIncreasing();
            expiries.push(list[i]);
            last = list[i];
        }
        emit ExpiriesAdded(list.length, last);
    }

    /// @notice Первая экспирация, до которой осталось строго больше minLead секунд.
    function nextExpiry(uint64 minLead) external view returns (uint64) {
        uint64 threshold = uint64(block.timestamp) + minLead;
        uint256 lo = 0;
        uint256 hi = expiries.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (expiries[mid] > threshold) hi = mid;
            else lo = mid + 1;
        }
        return lo < expiries.length ? expiries[lo] : 0;
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function expiryCount() external view returns (uint256) {
        return expiries.length;
    }
}
```

- [ ] **Step 4: Прогнать**

Run: `cd contracts && forge test --match-path test/NuvoPoolFactory.t.sol -vv`
Expected: PASS, десять тестов.

- [ ] **Step 5: Коммит**

```bash
git add contracts && git commit -m "feat: pool registry and the published expiry calendar"
```

---

### Task 11: Деплой и прогон на форке мейннета

Скрипт деплоя, генератор календаря экспираций и один тест на форке: с настоящими USDG, настоящим токеном акции и настоящим фидом. Он проверяет то, чего моки проверить не могут: десятичные, поведение `transferFrom` у реального USDG и формат ответа живого агрегатора.

**Files:**
- Create: `contracts/script/Deploy.s.sol`, `contracts/script/expiries.mjs`, `contracts/test/fork/Mainnet.t.sol`
- Modify: `contracts/.env.example` (переменные деплоя)

**Interfaces:**
- Consumes: `NuvoPoolFactory`, `NuvoPool.Params`, `PremiumModel`.
- Produces: `forge script script/Deploy.s.sol`, `node script/expiries.mjs <weeks>`, тест `ForkTest` со `skip`, когда `RPC_URL` не задан.

- [ ] **Step 1: Генератор календаря**

«Пятница 16:00 ET» считается в часовом поясе Нью-Йорка, ровно так же, как на сайте в `lib/nuvo/schedule.ts`, и печатается списком секунд для `addExpiries`.

`contracts/script/expiries.mjs`:

```js
// Печатает отметки времени пятничных экспираций 16:00 ET для addExpiries.
// Запуск: node script/expiries.mjs 26
const weeks = Number(process.argv[2] ?? 26);
const TZ = "America/New_York";

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const partsOf = (ts) => {
  const p = Object.fromEntries(parts.formatToParts(ts).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
};

// Смещение ET от UTC в этот момент, в миллисекундах.
const offsetAt = (ts) => {
  const p = partsOf(ts);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
};

// Момент по настенным часам ET. Разрешается дважды, чтобы края перехода на летнее время сошлись.
const fromEt = (y, m, d, hh, mm) => {
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let ts = naive - offsetAt(naive);
  return naive - offsetAt(ts);
};

const now = Date.now();
const today = partsOf(now);
const list = [];
let cursor = new Date(Date.UTC(today.year, today.month - 1, today.day));

while (list.length < weeks) {
  const p = { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
  const ts = fromEt(p.year, p.month, p.day, 16, 0);
  const isFriday = partsOf(ts).weekday === 5;
  if (isFriday && ts > now) list.push(Math.floor(ts / 1000));
  cursor.setUTCDate(cursor.getUTCDate() + 1);
}

console.log(`[${list.join(",")}]`);
```

Run: `cd contracts && node script/expiries.mjs 4`
Expected: строка вида `[1790000000,1790604800,...]`, четыре числа, каждое на неделю больше предыдущего. Проверить глазами первую дату: она должна быть ближайшей пятницей.

- [ ] **Step 2: Скрипт деплоя**

`contracts/script/Deploy.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {NuvoPoolFactory} from "../src/NuvoPoolFactory.sol";
import {PremiumModel} from "../src/PremiumModel.sol";

/// @notice Деплоит модель премий, фабрику и один пул, публикует календарь и
///         передаёт фабрику мультиподписи. Владелец пула — сразу мультиподпись.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address usdg = vm.envAddress("USDG_ADDRESS");
        address token = vm.envAddress("TOKEN_ADDRESS");
        address feed = vm.envAddress("FEED_ADDRESS");
        address multisig = vm.envAddress("OWNER_ADDRESS");
        uint64[] memory expiries = _expiries();

        vm.startBroadcast(pk);

        PremiumModel model = new PremiumModel(_dirs(), _dist(), _bps());
        NuvoPoolFactory factory = new NuvoPoolFactory(usdg, vm.addr(pk));
        factory.addExpiries(expiries);

        address pool = factory.createPool(
            NuvoPool.Params({
                usdg: usdg,
                token: token,
                feed: feed,
                premiumModel: address(model),
                factory: address(factory),
                owner: multisig,
                guardian: vm.envAddress("GUARDIAN_ADDRESS"),
                maxPremiumBps: uint16(vm.envUint("MAX_PREMIUM_BPS")),
                maxPriceAge: uint64(vm.envUint("MAX_PRICE_AGE")),
                maxPriceAgeSettle: uint64(vm.envUint("MAX_PRICE_AGE_SETTLE")),
                minDepositValueWad: vm.envUint("MIN_DEPOSIT_VALUE_WAD"),
                maxPositionValueWad: vm.envUint("MAX_POSITION_VALUE_WAD"),
                maxExpiryLockValueWad: vm.envUint("MAX_EXPIRY_LOCK_VALUE_WAD"),
                maxLockedShareBps: uint16(vm.envUint("MAX_LOCKED_SHARE_BPS"))
            })
        );

        // Фабрика переходит мультиподписи; она должна принять владение вторым шагом.
        factory.transferOwnership(multisig);
        vm.stopBroadcast();

        console.log("model", address(model));
        console.log("factory", address(factory));
        console.log("pool", pool);
    }

    function _expiries() internal view returns (uint64[] memory out) {
        uint256[] memory raw = vm.envUint("EXPIRIES", ",");
        out = new uint64[](raw.length);
        for (uint256 i = 0; i < raw.length; i++) out[i] = uint64(raw[i]);
    }

    function _dirs() internal pure returns (uint8[] memory d) {
        d = new uint8[](8);
        for (uint256 i = 0; i < 4; i++) {
            d[i] = 0;
            d[i + 4] = 1;
        }
    }

    function _dist() internal pure returns (uint16[] memory d) {
        d = new uint16[](8);
        uint16[4] memory rungs = [uint16(200), 400, 600, 800];
        for (uint256 i = 0; i < 4; i++) {
            d[i] = rungs[i];
            d[i + 4] = rungs[i];
        }
    }

    /// @dev Ставки первой недели. Пересматриваются выпуском новой модели.
    function _bps() internal pure returns (uint16[] memory b) {
        b = new uint16[](8);
        uint16[4] memory buyLow = [uint16(120), 85, 60, 40];
        uint16[4] memory sellHigh = [uint16(110), 80, 55, 35];
        for (uint256 i = 0; i < 4; i++) {
            b[i] = buyLow[i];
            b[i + 4] = sellHigh[i];
        }
    }
}
```

Дописать в `contracts/.env.example`:

```bash
# Деплой
USDG_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
TOKEN_ADDRESS=
FEED_ADDRESS=
OWNER_ADDRESS=
GUARDIAN_ADDRESS=
# Календарь: вывод node script/expiries.mjs 26, без скобок
EXPIRIES=
# Лимиты первого запуска: премия не выше 10%, цена не старше 80 часов (выходные),
# расчёт по цене не старше 6 часов, от 100 USDG, до 5 000 на позицию,
# до 50 000 замороженного на неделю, до 60% инвентаря в работе.
MAX_PREMIUM_BPS=1000
MAX_PRICE_AGE=288000
MAX_PRICE_AGE_SETTLE=21600
MIN_DEPOSIT_VALUE_WAD=100000000000000000000
MAX_POSITION_VALUE_WAD=5000000000000000000000
MAX_EXPIRY_LOCK_VALUE_WAD=50000000000000000000000
MAX_LOCKED_SHARE_BPS=6000
```

- [ ] **Step 3: Тест на форке**

`contracts/test/fork/Mainnet.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {NuvoPool} from "../../src/NuvoPool.sol";
import {NuvoPoolFactory} from "../../src/NuvoPoolFactory.sol";
import {PremiumModel} from "../../src/PremiumModel.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// @notice Один прогон полного круга на форке мейннета. Без RPC_URL пропускается,
///         чтобы обычный forge test не требовал сети.
contract ForkTest is Test {
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    NuvoPoolFactory internal factory;
    NuvoPool internal pool;
    IERC20 internal usdg;
    IERC20 internal stock;
    IAggregatorV3 internal feed;

    address internal lp = address(0xB0B);
    address internal user = address(0xD00D);
    uint64 internal expiry;

    function setUp() public {
        string memory rpc = vm.envOr("RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        usdg = IERC20(USDG);
        stock = IERC20(vm.envAddress("FORK_TOKEN"));
        feed = IAggregatorV3(vm.envAddress("FORK_FEED"));

        assertEq(IERC20Metadata(USDG).decimals(), 6, "USDG is six decimals on this chain");
        assertEq(IERC20Metadata(address(stock)).decimals(), 18, "stock tokens are eighteen");
        assertEq(feed.decimals(), 8, "feeds are eight");

        uint8[] memory dirs = new uint8[](2);
        uint16[] memory dist = new uint16[](2);
        uint16[] memory bps = new uint16[](2);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        (dirs[1], dist[1], bps[1]) = (1, 200, 110);
        PremiumModel model = new PremiumModel(dirs, dist, bps);

        factory = new NuvoPoolFactory(USDG, address(this));
        expiry = uint64(block.timestamp + 3 days);
        uint64[] memory list = new uint64[](1);
        list[0] = expiry;
        factory.addExpiries(list);

        pool = NuvoPool(
            factory.createPool(
                NuvoPool.Params({
                    usdg: USDG,
                    token: address(stock),
                    feed: address(feed),
                    premiumModel: address(model),
                    factory: address(factory),
                    owner: address(this),
                    guardian: address(this),
                    maxPremiumBps: 1_000,
                    maxPriceAge: 80 hours,
                    maxPriceAgeSettle: 6 hours,
                    minDepositValueWad: 10e18,
                    maxPositionValueWad: 1_000_000e18,
                    maxExpiryLockValueWad: 10_000_000e18,
                    maxLockedShareBps: 8_000
                })
            )
        );

        // deal подбирает слот баланса перебором. Если токен окажется прокси со
        // своей раскладкой и deal не сработает, заменить на vm.prank крупного
        // держателя из обозревателя и обычный transfer.
        deal(USDG, lp, 200_000e6, true);
        deal(address(stock), lp, 2_000e18, true);
        deal(USDG, user, 10_000e6, true);
    }

    function test_fullCycleOnTheRealChain() public {
        if (address(pool) == address(0)) {
            vm.skip(true);
            return;
        }

        vm.startPrank(lp);
        usdg.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        uint256 shares = pool.addLiquidity(200_000e6, 2_000e18, 0);
        vm.stopPrank();
        assertGt(shares, 0);

        NuvoPool.Preview memory q = pool.preview(0, 200, 1_000e6);
        assertEq(q.code, 0, "the live feed prices a subscription");
        assertGt(q.ifConverted, 0);
        assertEq(q.expiry, expiry);

        vm.startPrank(user);
        usdg.approve(address(pool), type(uint256).max);
        uint256 id = pool.subscribe(0, 200, 1_000e6, q.strikeWad, uint64(block.timestamp + 300));
        vm.stopPrank();
        assertEq(pool.depositsUsdg(), 1_000e6);

        // Настоящий фид нельзя сдвинуть во времени, поэтому на момент расчёта
        // подменяется только его ответ. Правила выбора раунда проверены в
        // NuvoPool.settle.t.sol, здесь важен весь остальной путь на живых контрактах.
        vm.warp(expiry + 1 hours);
        vm.mockCall(
            address(feed),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(1), int256(q.priceWad / 1e10 / 2), uint256(expiry), uint256(expiry), uint80(1))
        );
        vm.mockCall(
            address(feed),
            abi.encodeWithSelector(IAggregatorV3.getRoundData.selector, uint80(1)),
            abi.encode(uint80(1), int256(q.priceWad / 1e10 / 2), uint256(expiry), uint256(expiry), uint80(1))
        );
        pool.settle(expiry);
        assertGt(pool.settlePriceWad(expiry), 0);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);
        assertEq(asset, address(stock), "price halved, so the deposit converts into the stock");
        assertEq(amount, q.ifConverted);
        assertEq(stock.balanceOf(user), q.ifConverted);
    }
}
```

- [ ] **Step 4: Прогнать**

```bash
cd contracts
forge test                                   # без сети: форк-тест пропускается
cp .env.example .env                         # заполнить RPC_URL, FORK_TOKEN, FORK_FEED
forge test --match-path test/fork/Mainnet.t.sol -vv
```
Expected: полный прогон зелёный. Токен и фид брать парой из `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`.

- [ ] **Step 5: Коммит**

```bash
git add contracts && git commit -m "feat: deploy script, expiry calendar generator and a mainnet fork run"
```

---

### Task 12: Сайт — окружение, настройки, ABI

Сайт перестаёт знать про сервис котировок и про список токенов в переменных: тикеры он берёт из реестра фабрики, а причины отказа — из кода, который возвращает `preview`.

**Files:**
- Modify: `NUVO/.env.example`, `NUVO/lib/nuvo/config.ts`, `NUVO/lib/nuvo/abi.ts`, `NUVO/lib/nuvo/errors.ts`
- Modify: `NUVO/README.md` (раздел про переменные, если он там есть)

**Interfaces:**
- Consumes: контракты из Задач 5–10, их ABI.
- Produces:
  - `NETWORK.factory: Address | undefined` вместо `NETWORK.nuvo`
  - `hasContracts() = hasNetwork() && Boolean(NETWORK.factory && USDG.address)`
  - `hasProducts() = hasContracts()`
  - `STRIKE_TOLERANCE_BPS = 50`, `TX_DEADLINE_SECONDS = 300`
  - `nuvoFactoryAbi`, `nuvoPoolAbi` в `abi.ts`; `nuvoDualAbi` и `productId` удалены
  - `unavailableMessage(code: number): string` в `errors.ts`

- [ ] **Step 1: Переменные окружения**

В `NUVO/.env.example` убрать `NEXT_PUBLIC_NUVO_ADDRESS`, `NEXT_PUBLIC_STOCK_TOKENS`, `NEXT_PUBLIC_QUOTE_API`, `NEXT_PUBLIC_MIN_USDG`, `NEXT_PUBLIC_MAX_USDG`, `NEXT_PUBLIC_MIN_STOCK_VALUE_USDG` и поставить на их место:

```bash
# Фабрика пулов. Тикеры, фиды и лимиты сайт читает у неё и у пулов,
# поэтому больше ничего про продукты в окружении не задаётся.
NEXT_PUBLIC_FACTORY_ADDRESS=
NEXT_PUBLIC_USDG_ADDRESS=
NEXT_PUBLIC_USDG_SYMBOL=USDG
```

- [ ] **Step 2: Настройки**

В `lib/nuvo/config.ts`:

```ts
export const NETWORK = {
  chainId: Number(clean(process.env.NEXT_PUBLIC_CHAIN_ID) || 0),
  name: clean(process.env.NEXT_PUBLIC_CHAIN_NAME) || "Robinhood Chain",
  rpcUrl: clean(process.env.NEXT_PUBLIC_RPC_URL),
  explorerUrl: clean(process.env.NEXT_PUBLIC_EXPLORER_URL),
  factory: asAddress(clean(process.env.NEXT_PUBLIC_FACTORY_ADDRESS)),
};
```

Удалить `QUOTE_API`, `QUOTE_TTL_MS`, `hasQuotes`, `LIMITS`, `TOKENS`, `tokenOf` и заменить готовности:

```ts
export const hasNetwork = () => NETWORK.chainId > 0 && NETWORK.rpcUrl.length > 0;
/** Записи и чтения продуктов идут через фабрику, так что готовность одна. */
export const hasContracts = () => hasNetwork() && Boolean(NETWORK.factory && USDG.address);
export const hasProducts = () => hasContracts();

/** Насколько страйку позволено уехать между просмотром и подтверждением в кошельке. */
export const STRIKE_TOLERANCE_BPS = 50;
/** Сколько транзакция подписки остаётся действительной. */
export const TX_DEADLINE_SECONDS = 300;
```

`SCHEDULE`, `LADDER`, `TOKEN`, `SOCIAL`, `SITE_URL`, `USDG`, `explorerTx`, `explorerAddress`, `tokenUrl` остаются как есть.

- [ ] **Step 3: ABI**

`lib/nuvo/abi.ts` целиком, вместо прежнего содержимого (`erc20Abi` и `aggregatorV3Abi` сохранить дословно, они не менялись; `productId`, `nuvoDualAbi`, `StatusEnum`, `PositionStatusEnum` удалить):

```ts
import type { Direction } from "./types";

// Поверхность контрактов, с которой говорит сайт. Правки — здесь и в chain.ts,
// больше нигде.

export const DirectionEnum = { BuyLow: 0, SellHigh: 1 } as const;

export const directionIndex = (direction: Direction) =>
  direction === "buyLow" ? DirectionEnum.BuyLow : DirectionEnum.SellHigh;

/** Причина, по которой пул не принимает подписку. Приходит числом из preview. */
export const UnavailableCode = {
  Ok: 0,
  Paused: 1,
  NoExpiry: 2,
  BadPrice: 3,
  StalePrice: 4,
  NoPremium: 5,
  ZeroAmount: 6,
  BelowMin: 7,
  AboveMax: 8,
  ExpiryFull: 9,
  NoInventory: 10,
  TooMuchLocked: 11,
  BadDistance: 12,
} as const;

export const nuvoFactoryAbi = [
  {
    type: "function",
    name: "poolCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pools",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "nextExpiry",
    stateMutability: "view",
    inputs: [{ name: "minLead", type: "uint64" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

const previewOutput = {
  name: "",
  type: "tuple",
  components: [
    { name: "expiry", type: "uint64" },
    { name: "premiumBps", type: "uint16" },
    { name: "strikeWad", type: "uint256" },
    { name: "priceWad", type: "uint256" },
    { name: "priceUpdatedAt", type: "uint256" },
    { name: "ifConverted", type: "uint256" },
    { name: "ifNot", type: "uint256" },
    { name: "lockUsdg", type: "uint256" },
    { name: "lockToken", type: "uint256" },
    { name: "code", type: "uint8" },
  ],
} as const;

export const nuvoPoolAbi = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "usdg", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feed", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "preview",
    stateMutability: "view",
    inputs: [
      { name: "direction", type: "uint8" },
      { name: "distanceBps", type: "uint16" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [previewOutput],
  },
  {
    type: "function",
    name: "subscribe",
    stateMutability: "nonpayable",
    inputs: [
      { name: "direction", type: "uint8" },
      { name: "distanceBps", type: "uint16" },
      { name: "amount", type: "uint256" },
      { name: "limitStrikeWad", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "positionsOf",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "direction", type: "uint8" },
          { name: "premiumBps", type: "uint16" },
          { name: "expiry", type: "uint64" },
          { name: "claimed", type: "bool" },
          { name: "deposit", type: "uint256" },
          { name: "strikeWad", type: "uint256" },
          { name: "lockUsdg", type: "uint256" },
          { name: "lockToken", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "positionPayout",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "settled", type: "bool" },
      { name: "converted", type: "bool" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "settlePriceWad",
    stateMutability: "view",
    inputs: [{ name: "expiry", type: "uint64" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "addLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "usdgIn", type: "uint256" },
      { name: "tokenIn", type: "uint256" },
      { name: "minShares", type: "uint256" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "removeLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "minUsdgOut", type: "uint256" },
      { name: "minTokenOut", type: "uint256" },
    ],
    outputs: [
      { name: "usdgOut", type: "uint256" },
      { name: "tokenOut", type: "uint256" },
    ],
  },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "sharesOf",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "poolValueWad", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "freeValueWad", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "freeUsdg", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "freeToken", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
] as const;
```

`erc20Abi` и `aggregatorV3Abi` из прежнего файла оставить без изменений, `uiMultiplier` в `erc20Abi` тоже: он ещё нужен, чтобы подписать на экране, сколько акции в одном токене, но в арифметику сумм не входит.

- [ ] **Step 4: Сообщения об отказе**

В `lib/nuvo/errors.ts` убрать упоминания `QuoteUnavailableError` и добавить:

```ts
import { UnavailableCode } from "./abi";

/** Почему пул не принимает подписку. Тексты — то, что видно на кнопке. */
export function unavailableMessage(code: number, deposit: string): string {
  switch (code) {
    case UnavailableCode.Paused:
      return "Subscriptions are paused";
    case UnavailableCode.NoExpiry:
      return "No expiry is open yet";
    case UnavailableCode.BadPrice:
    case UnavailableCode.StalePrice:
      return "Waiting for a fresh reference price";
    case UnavailableCode.NoPremium:
      return "This target is not on offer";
    case UnavailableCode.ZeroAmount:
      return "Enter an amount";
    case UnavailableCode.BelowMin:
      return `Below the minimum ${deposit}`;
    case UnavailableCode.AboveMax:
      return `Above the maximum ${deposit}`;
    case UnavailableCode.ExpiryFull:
      return "This week is full";
    case UnavailableCode.NoInventory:
    case UnavailableCode.TooMuchLocked:
      return "The pool cannot cover this size";
    case UnavailableCode.BadDistance:
      return "This target is not on offer";
    default:
      return "Subscriptions are unavailable right now";
  }
}
```

- [ ] **Step 5: Проверить сборку типов**

Run: `cd /c/Users/chaiz/Desktop/Recess/NUVO && npx tsc --noEmit`
Expected: ошибки только в `lib/nuvo/chain.ts`, `lib/nuvo/catalog.ts` и на экранах — их чинят Задачи 13–16. Ошибок в `config.ts`, `abi.ts`, `errors.ts` быть не должно.

- [ ] **Step 6: Коммит**

```bash
git add .env.example lib/nuvo/config.ts lib/nuvo/abi.ts lib/nuvo/errors.ts README.md
git commit -m "feat: the site talks to the factory and reads its terms from the pool"
```

---

### Task 13: Сайт — слой данных на контрактах

`chain.ts` переписывается под пулы: тикеры из реестра, условия из `preview`, подписка и выплата — в пул. Сервис котировок уходит целиком.

**Files:**
- Modify: `NUVO/lib/nuvo/types.ts`, `NUVO/lib/nuvo/chain.ts`, `NUVO/lib/nuvo/catalog.ts`

**Interfaces:**
- Consumes: `nuvoFactoryAbi`, `nuvoPoolAbi`, `erc20Abi` (Задача 12).
- Produces:
  - `type PoolInfo = { address: Address; token: TokenInfo; feed: Address }`
  - `type PreviewResult = { code: number; premiumBps: number; strikeWad: bigint; expiresAt: number; ifConverted: { token: string; amount: number }; ifNot: { token: string; amount: number } }`
  - `Product` с полями `pool`, `distanceBps`, `strikeWad`, без `premiumBps` из котировок
  - `Position.pool`, идентификатор позиции в виде `"0xПул:индекс"`
  - методы клиента: `listPools()`, `listTickers()`, `listProducts(direction, ticker?)`, `getPreview(product, amount)`, `getBalances(owner?)`, `getAllowance(symbol, spender, owner?)`, `approve(symbol, spender, amount, onSubmitted?)`, `subscribe(product, amount, preview, onSubmitted?)`, `getPositions(owner?)`, `claim(positionId, onSubmitted?)`, `getPoolStats(ticker, owner?)`, `addLiquidity(ticker, usdgAmount, tokenAmount, onSubmitted?)`, `removeLiquidity(ticker, shares, onSubmitted?)`
  - интерфейс `NuvoClient` в `types.ts` приводится к этому же списку: `getQuote` уходит, `ready.quotes` уходит, `approve` и `getAllowance` получают `spender`, добавляются четыре метода пула

- [ ] **Step 1: Типы**

В `lib/nuvo/types.ts`:

- убрать `TokenConfig`, `Quote`, `TokenInfo.uiMultiplierWad`;
- `TokenInfo` оставить `{ symbol, address, name, decimals, uiMultiplier }` — множитель только для подписи на экране;
- `Product`:

```ts
export type Product = {
  /** Ключ для React: пул, направление и рунг. */
  id: string;
  pool: Address;
  ticker: string;
  direction: Direction;
  /** Расстояние до цели в bps: 200 для 2%. */
  distanceBps: number;
  /** Знаковое расстояние в процентах, для подписи. */
  targetOffset: number;
  targetPrice: number;
  strikeWad: bigint;
  reference: Reference;
  premiumBps?: number;
  expiresAt: number;
  status: ProductStatus;
};
```

- `PreviewResult` и `PoolStats`:

```ts
export type PreviewResult = {
  code: number;
  premiumBps: number;
  strikeWad: bigint;
  expiresAt: number;
  ifConverted: { token: string; amount: number };
  ifNot: { token: string; amount: number };
};

export type PoolStats = {
  pool: Address;
  ticker: string;
  /** Стоимость инвентаря вкладчиков в USDG. */
  valueUsdg: number;
  /** Свободная часть: столько можно вывести прямо сейчас. */
  freeUsdg: number;
  shares: bigint;
  totalShares: bigint;
  /** Доля вкладчика в USDG. */
  myValueUsdg: number;
  paused: boolean;
};
```

- `Position` дополнить `pool: Address`, убрать `productId`, `settlement.settlePrice` оставить.

- [ ] **Step 2: Клиент**

`lib/nuvo/chain.ts` — заменить содержимое. `NotConfiguredError`, `NoWalletError`, `TxPendingError`, `TxRevertedError` и метод `send` сохранить дословно, `QuoteUnavailableError` удалить.

```ts
import {
  createPublicClient,
  formatUnits,
  http,
  parseUnits,
  type PublicClient,
  type WalletClient,
} from "viem";
import { nuvoChain } from "../wallet/chain";
import { aggregatorV3Abi, directionIndex, erc20Abi, nuvoFactoryAbi, nuvoPoolAbi } from "./abi";
import { CATALOG, catalogProducts } from "./catalog";
import {
  LADDER,
  NETWORK,
  SCHEDULE,
  STRIKE_TOLERANCE_BPS,
  TX_DEADLINE_SECONDS,
  USDG,
  hasContracts,
  hasNetwork,
  hasProducts,
} from "./config";
import { currentWeek, isMarketOpen } from "./schedule";
import type {
  Address,
  Balance,
  Direction,
  NuvoClient,
  PoolStats,
  Position,
  PreviewResult,
  Product,
  Reference,
  TickerInfo,
  TokenInfo,
  TxResult,
  Week,
} from "./types";

const WAD = 10n ** 18n;

/** Типизированное, как на экране, в базовые единицы токена. Обрезает лишние знаки. */
const toBase = (amount: string, decimals: number) => {
  const [whole = "", fraction = ""] = amount.trim().split(".");
  const cut = fraction.slice(0, decimals);
  return parseUnits(`${whole || "0"}${cut ? `.${cut}` : ""}`, decimals);
};

/** Базовые единицы в точную десятичную строку. */
const toExact = (value: bigint, decimals: number) => formatUnits(value, decimals);

/** Цена в WAD в число для экрана. */
const priceOf = (wad: bigint) => Number(formatUnits(wad, 18));

export type PoolInfo = { address: Address; token: TokenInfo; feed: Address };

export class ChainClient implements NuvoClient {
  readonly ready = {
    network: hasNetwork(),
    contracts: hasContracts(),
    products: hasProducts(),
  };

  private publicClient: PublicClient | null = hasNetwork()
    ? (createPublicClient({ chain: nuvoChain, transport: http(NETWORK.rpcUrl) }) as PublicClient)
    : null;

  private wallet: WalletClient | null = null;
  private account: Address | undefined;
  private poolCache: Promise<PoolInfo[]> | null = null;
  private usdgInfo: TokenInfo | null = null;
  private listeners = new Set<() => void>();

  // setWallet, onChange, emit, reader, send — как раньше, без изменений.

  private writer() {
    if (!this.wallet || !this.account) throw new NoWalletError();
    if (!NETWORK.factory) throw new NotConfiguredError("The Nuvo factory");
    this.reader();
    return { wallet: this.wallet, account: this.account };
  }

  async getWeek(): Promise<Week> {
    return currentWeek();
  }

  /** Реестр фабрики: один раз за загрузку страницы. */
  async listPools(): Promise<PoolInfo[]> {
    if (!hasContracts()) return [];
    if (!this.poolCache) {
      this.poolCache = this.readPools().catch((e) => {
        this.poolCache = null;
        throw e;
      });
    }
    return this.poolCache;
  }

  private async readPools(): Promise<PoolInfo[]> {
    const client = this.reader();
    const factory = NETWORK.factory!;
    const count = await client.readContract({
      address: factory,
      abi: nuvoFactoryAbi,
      functionName: "poolCount",
    });

    const addresses = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) =>
        client.readContract({
          address: factory,
          abi: nuvoFactoryAbi,
          functionName: "pools",
          args: [BigInt(i)],
        }),
      ),
    );

    const pools = await Promise.all(
      addresses.map(async (address) => {
        const [token, feed] = await Promise.all([
          client.readContract({ address, abi: nuvoPoolAbi, functionName: "token" }),
          client.readContract({ address, abi: nuvoPoolAbi, functionName: "feed" }),
        ]);
        return { address, token: await this.tokenAt(token), feed } satisfies PoolInfo;
      }),
    );
    return pools;
  }

  private async tokenAt(address: Address): Promise<TokenInfo> {
    const client = this.reader();
    const contract = { address, abi: erc20Abi } as const;
    const [name, symbol, decimals, multiplier] = await Promise.all([
      client.readContract({ ...contract, functionName: "name" }).catch(() => ""),
      client.readContract({ ...contract, functionName: "symbol" }),
      client.readContract({ ...contract, functionName: "decimals" }),
      client.readContract({ ...contract, functionName: "uiMultiplier" }).catch(() => 0n),
    ]);
    const wad = BigInt(multiplier);
    return {
      symbol: String(symbol).toUpperCase(),
      address,
      name: String(name) || String(symbol),
      decimals: Number(decimals),
      // Только подпись на экране: суммы считаются в токенах, фид даёт цену за токен.
      uiMultiplier: wad > 0n ? Number(formatUnits(wad, 18)) : 1,
    };
  }

  private async usdgToken(): Promise<TokenInfo> {
    if (this.usdgInfo) return this.usdgInfo;
    if (!USDG.address) throw new NotConfiguredError("USDG");
    this.usdgInfo = await this.tokenAt(USDG.address);
    return this.usdgInfo;
  }

  private async poolFor(ticker: string): Promise<PoolInfo> {
    const pools = await this.listPools();
    const found = pools.find((p) => p.token.symbol === ticker.toUpperCase());
    if (!found) throw new NotConfiguredError(ticker.toUpperCase());
    return found;
  }

  async listTickers(): Promise<TickerInfo[]> {
    if (!hasProducts()) {
      return CATALOG.map(({ symbol, name }) => ({ symbol, name, uiMultiplier: 1 }));
    }
    const pools = await this.listPools();
    return pools.map((p) => ({
      symbol: p.token.symbol,
      name: p.token.name,
      uiMultiplier: p.token.uiMultiplier,
    }));
  }

  async listProducts(direction: Direction, ticker?: string): Promise<Product[]> {
    if (!hasProducts()) return catalogProducts(direction, ticker);

    const pools = await this.listPools();
    const wanted = ticker
      ? pools.filter((p) => p.token.symbol === ticker.toUpperCase())
      : pools;

    const perPool = await Promise.all(
      wanted.map(async (pool) => {
        const rungs = await Promise.all(
          LADDER.map((step) => this.rawPreview(pool.address, direction, step * 100, 0n)),
        );
        return rungs.flatMap((raw, index) => {
          if (!raw) return [];
          const step = LADDER[index];
          const price = priceOf(raw.priceWad);
          if (price <= 0) return [];
          const updatedAt = Number(raw.priceUpdatedAt) * 1000;
          const reference: Reference = {
            price,
            updatedAt,
            // Вне часов работы биржи фид стоит на цене закрытия, и это не протухание.
            stale: isMarketOpen() && Date.now() - updatedAt > SCHEDULE.staleReferenceHours * 3600_000,
            source: "chain",
          };
          return [
            {
              id: `${pool.address}:${direction}:${step * 100}`,
              pool: pool.address,
              ticker: pool.token.symbol,
              direction,
              distanceBps: step * 100,
              targetOffset: direction === "buyLow" ? -step : step,
              targetPrice: priceOf(raw.strikeWad),
              strikeWad: raw.strikeWad,
              reference,
              premiumBps: raw.premiumBps > 0 ? raw.premiumBps : undefined,
              expiresAt: Number(raw.expiry) * 1000,
              status: "open",
            } satisfies Product,
          ];
        });
      }),
    );

    return perPool.flat();
  }

  private async rawPreview(pool: Address, direction: Direction, distanceBps: number, amount: bigint) {
    try {
      return await this.reader().readContract({
        address: pool,
        abi: nuvoPoolAbi,
        functionName: "preview",
        args: [directionIndex(direction), distanceBps, amount],
      });
    } catch {
      return null;
    }
  }

  /** Условия подписки на введённую сумму. Заменяет прежний сервис котировок. */
  async getPreview(product: Product, amount: string): Promise<PreviewResult> {
    const deposit = await this.depositToken(product);
    const raw = await this.rawPreview(
      product.pool,
      product.direction,
      product.distanceBps,
      toBase(amount, deposit.decimals),
    );
    if (!raw) throw new NotConfiguredError("The pool");

    const pool = await this.poolFor(product.ticker);
    const usdg = await this.usdgToken();
    const convertedToken = product.direction === "buyLow" ? pool.token : usdg;

    return {
      code: Number(raw.code),
      premiumBps: Number(raw.premiumBps),
      strikeWad: raw.strikeWad,
      expiresAt: Number(raw.expiry) * 1000,
      ifConverted: {
        token: convertedToken.symbol,
        amount: Number(toExact(raw.ifConverted, convertedToken.decimals)),
      },
      ifNot: { token: deposit.symbol, amount: Number(toExact(raw.ifNot, deposit.decimals)) },
    };
  }

  private async depositToken(product: Product): Promise<TokenInfo> {
    if (product.direction === "buyLow") return this.usdgToken();
    return (await this.poolFor(product.ticker)).token;
  }

  async getBalances(address?: Address): Promise<Record<string, Balance>> {
    const owner = address ?? this.account;
    if (!owner || !hasNetwork()) return {};
    const client = this.reader();
    const tokens = [await this.usdgToken(), ...(await this.listPools()).map((p) => p.token)];

    const entries = await Promise.all(
      tokens.map(async (token) => {
        try {
          const balance = await client.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner],
          });
          const exact = toExact(balance, token.decimals);
          return [token.symbol, { amount: Number(exact), exact }] as const;
        } catch {
          return null;
        }
      }),
    );
    return Object.fromEntries(entries.filter((e): e is readonly [string, Balance] => !!e));
  }

  /** Разрешение даётся тому пулу, который будет списывать. */
  async getAllowance(symbol: string, spender: Address, owner?: Address): Promise<number> {
    const account = owner ?? this.account;
    if (!account) return 0;
    try {
      const token = await this.tokenBySymbol(symbol);
      const allowance = await this.reader().readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, spender],
      });
      return Number(toExact(allowance, token.decimals));
    } catch {
      return 0;
    }
  }

  private async tokenBySymbol(symbol: string): Promise<TokenInfo> {
    const key = symbol.toUpperCase();
    const usdg = await this.usdgToken();
    if (key === usdg.symbol) return usdg;
    return (await this.poolFor(key)).token;
  }

  async approve(
    symbol: string,
    spender: Address,
    amount: string,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const token = await this.tokenBySymbol(symbol);
    const hash = await wallet.writeContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, toBase(amount, token.decimals)],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  async subscribe(
    product: Product,
    amount: string,
    preview: PreviewResult,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const deposit = await this.depositToken(product);
    // Страйк считается от живой цены в момент майнинга; ограничиваем, насколько
    // он мог уехать. Buy Low страдает от роста цены, Sell High — от падения.
    const tolerance = BigInt(STRIKE_TOLERANCE_BPS);
    const limitStrike =
      product.direction === "buyLow"
        ? (preview.strikeWad * (10_000n + tolerance)) / 10_000n
        : (preview.strikeWad * (10_000n - tolerance)) / 10_000n;

    const hash = await wallet.writeContract({
      address: product.pool,
      abi: nuvoPoolAbi,
      functionName: "subscribe",
      args: [
        directionIndex(product.direction),
        product.distanceBps,
        toBase(amount, deposit.decimals),
        limitStrike,
        BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS),
      ],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  async getPositions(address?: Address): Promise<Position[]> {
    const owner = address ?? this.account;
    if (!owner || !hasContracts()) return [];
    const client = this.reader();
    const usdg = await this.usdgToken();
    const pools = await this.listPools();

    const perPool = await Promise.all(
      pools.map(async (pool) => {
        const ids = await client.readContract({
          address: pool.address,
          abi: nuvoPoolAbi,
          functionName: "positionsOf",
          args: [owner],
        });

        return Promise.all(
          ids.map(async (id) => {
            const [p, payout] = await Promise.all([
              client.readContract({
                address: pool.address,
                abi: nuvoPoolAbi,
                functionName: "position",
                args: [id],
              }),
              client.readContract({
                address: pool.address,
                abi: nuvoPoolAbi,
                functionName: "positionPayout",
                args: [id],
              }),
            ]);

            const direction: Direction = Number(p.direction) === 0 ? "buyLow" : "sellHigh";
            const deposit = direction === "buyLow" ? usdg : pool.token;
            const [settled, converted, asset, amount] = payout;
            const payoutToken =
              asset.toLowerCase() === usdg.address.toLowerCase() ? usdg : pool.token;

            return {
              id: `${pool.address}:${id.toString()}`,
              pool: pool.address,
              ticker: pool.token.symbol,
              direction,
              targetPrice: priceOf(p.strikeWad),
              premiumBps: Number(p.premiumBps),
              amount: Number(toExact(p.deposit, deposit.decimals)),
              depositToken: deposit.symbol,
              subscribedAt: 0,
              expiresAt: Number(p.expiry) * 1000,
              status: p.claimed ? "claimed" : settled ? "claimable" : "active",
              ...(settled
                ? {
                    settlement: {
                      settlePrice: 0,
                      converted,
                      payout: {
                        token: payoutToken.symbol,
                        amount: Number(toExact(amount, payoutToken.decimals)),
                      },
                    },
                  }
                : {}),
            } satisfies Position;
          }),
        );
      }),
    );

    return perPool.flat().sort((a, b) => b.expiresAt - a.expiresAt);
  }

  async claim(positionId: string, onSubmitted?: (hash: Address) => void): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const [pool, index] = positionId.split(":");
    const hash = await wallet.writeContract({
      address: pool as Address,
      abi: nuvoPoolAbi,
      functionName: "claim",
      args: [BigInt(index)],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  // --- вкладчик пула ---

  async getPoolStats(ticker: string, address?: Address): Promise<PoolStats> {
    const pool = await this.poolFor(ticker);
    const owner = address ?? this.account;
    const client = this.reader();
    const [value, free, total, shares, paused] = await Promise.all([
      client.readContract({ address: pool.address, abi: nuvoPoolAbi, functionName: "poolValueWad" }),
      client.readContract({ address: pool.address, abi: nuvoPoolAbi, functionName: "freeValueWad" }),
      client.readContract({ address: pool.address, abi: nuvoPoolAbi, functionName: "totalShares" }),
      owner
        ? client.readContract({
            address: pool.address,
            abi: nuvoPoolAbi,
            functionName: "sharesOf",
            args: [owner],
          })
        : Promise.resolve(0n),
      client.readContract({ address: pool.address, abi: nuvoPoolAbi, functionName: "paused" }),
    ]);

    return {
      pool: pool.address,
      ticker: pool.token.symbol,
      valueUsdg: priceOf(value),
      freeUsdg: priceOf(free),
      shares,
      totalShares: total,
      myValueUsdg: total > 0n ? priceOf((value * shares) / total) : 0,
      paused,
    };
  }

  async addLiquidity(
    ticker: string,
    usdgAmount: string,
    tokenAmount: string,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const pool = await this.poolFor(ticker);
    const usdg = await this.usdgToken();
    const hash = await wallet.writeContract({
      address: pool.address,
      abi: nuvoPoolAbi,
      functionName: "addLiquidity",
      args: [toBase(usdgAmount || "0", usdg.decimals), toBase(tokenAmount || "0", pool.token.decimals), 0n],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  async removeLiquidity(
    ticker: string,
    shares: bigint,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const pool = await this.poolFor(ticker);
    const hash = await wallet.writeContract({
      address: pool.address,
      abi: nuvoPoolAbi,
      functionName: "removeLiquidity",
      args: [shares, 0n, 0n],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }
}
```

- [ ] **Step 3: Каталог-заглушка**

`lib/nuvo/catalog.ts` больше не может выводить `productId` — убрать импорт `productId` и собирать `id` строкой, как в `listProducts`: `` `catalog:${symbol}:${direction}:${step * 100}` ``. Поля `pool` в заглушке нет, поэтому поставить `pool: "0x0000000000000000000000000000000000000000"` и `strikeWad: 0n`, `distanceBps: step * 100`. Экран подписки на такой продукт кнопку не включит: `client.ready.contracts` ложно.

- [ ] **Step 4: Проверить типы**

Run: `cd /c/Users/chaiz/Desktop/Recess/NUVO && npx tsc --noEmit`
Expected: ошибки остались только на экранах (`app/app/**`, `components/app/**`) — их чинят Задачи 14–16.

- [ ] **Step 5: Коммит**

```bash
git add lib/nuvo && git commit -m "feat: the data layer reads pools, previews and positions from the chain"
```

---

### Task 14: Сайт — экран подписки без котировок

**Files:**
- Modify: `NUVO/app/app/[ticker]/page.tsx`

**Interfaces:**
- Consumes: `client.getPreview`, `client.subscribe`, `client.approve(symbol, spender, amount)`, `unavailableMessage` (Задачи 12–13).
- Produces: экран, где премия, страйк и оба исхода приходят из контракта, а кнопка называет причину отказа его словами.

- [ ] **Step 1: Состояние**

Заменить состояние котировки на состояние просмотра (строки 36–44 текущего файла):

```tsx
  const [amount, setAmount] = useState("");
  const [terms, setTerms] = useState<PreviewResult | undefined>(undefined);
  const [termsLoading, setTermsLoading] = useState(false);
  const [termsError, setTermsError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<"approve" | "subscribe" | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const busy = useRef(false);
```

Импорты: вместо `LIMITS` и `quoteErrorMessage` — `unavailableMessage`; вместо типа `Quote` — `PreviewResult`.

- [ ] **Step 2: Чтение условий**

Заменить эффект котировки и `refreshQuote` (строки 103–156) на один эффект. Он читает `preview` на каждое изменение суммы, с той же задержкой в 300 мс, и не требует ни подписи, ни срока годности.

```tsx
  // Условия читаются у пула: премия, страйк и оба исхода на введённую сумму.
  useEffect(() => {
    if (!product || !client.ready.contracts) {
      setTerms(undefined);
      setTermsError(undefined);
      setTermsLoading(false);
      return;
    }
    let alive = true;
    setTermsLoading(true);
    setTermsError(undefined);
    const id = setTimeout(() => {
      client
        .getPreview(product, amount || "0")
        .then((result) => {
          if (alive) setTerms(result);
        })
        .catch(() => {
          if (!alive) return;
          setTerms(undefined);
          setTermsError("The pool is not answering right now");
        })
        .finally(() => {
          if (alive) setTermsLoading(false);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [amount, product]);
```

- [ ] **Step 3: Числа исходов**

Убрать локальный расчёт `outcomes` (строки 89–101) и брать его из условий, с откатом на расчёт по премии рунга, пока контракт не настроен:

```tsx
  const premiumBps = terms?.premiumBps || product?.premiumBps;

  // Цифры приходят из контракта. Пока он не настроен, экран показывает ту же
  // арифметику по премии рунга, чтобы страница не была пустой.
  const outcomes = useMemo(() => {
    if (terms && amountNumber > 0 && terms.premiumBps > 0) {
      return { converted: terms.ifConverted, kept: terms.ifNot };
    }
    if (!product || amountNumber <= 0) return undefined;
    const r = (premiumBps ?? 0) / 10_000;
    return direction === "buyLow"
      ? {
          converted: { token: symbol, amount: (amountNumber * (1 + r)) / product.targetPrice },
          kept: { token: USDG.symbol, amount: amountNumber * (1 + r) },
        }
      : {
          converted: { token: USDG.symbol, amount: amountNumber * product.targetPrice * (1 + r) },
          kept: { token: symbol, amount: amountNumber * (1 + r) },
        };
  }, [amountNumber, direction, premiumBps, product, symbol, terms]);
```

- [ ] **Step 4: Кнопка**

Заменить блок `action` (строки 205–223). Порядок прежний, но причины отказа теперь называет контракт:

```tsx
  const action = (() => {
    if (!wallet.isConnected) return { label: "Connect wallet", onClick: wallet.connect };
    if (!wallet.isRightNetwork) return { label: "Switch network", onClick: wallet.switchNetwork };
    if (pending) return { label: "Confirming…", disabled: true };
    if (amountNumber <= 0) return { label: "Enter an amount", disabled: true };
    if (balance !== undefined && amountNumber > balance)
      return { label: `Not enough ${depositToken} in your wallet`, disabled: true };
    if (client.ready.contracts) {
      if ((allowance ?? 0) < amountNumber)
        return { label: `Approve ${depositToken}`, onClick: onApprove };
      if (termsLoading) return { label: "Reading the pool…", disabled: true };
      if (termsError) return { label: termsError, disabled: true };
      if (terms && terms.code !== 0)
        return { label: unavailableMessage(terms.code, depositToken), disabled: true };
      if (!terms) return { label: "Reading the pool…", disabled: true };
    }
    return { label: "Subscribe", onClick: onSubscribe };
  })();
```

- [ ] **Step 5: Отправка**

`onApprove` — тот же, но разрешение даётся пулу:

```tsx
      await client.approve(depositToken, product.pool, amount, submitted(`Approving ${depositToken}`));
```

`onSubscribe`:

```tsx
  const onSubscribe = async () => {
    if (!client.ready.contracts || busy.current) return;
    if (!product || !terms || terms.code !== 0) return;
    busy.current = true;
    setError(undefined);
    setPending("subscribe");
    try {
      const tx = await client.subscribe(product, amount, terms, submitted("Subscription submitted"));
      toast({ title: "Subscribed", tone: "success", href: explorerTx(tx.hash), linkLabel: "Explorer" });
      setAmount("");
    } catch (e) {
      const message = txErrorMessage(e);
      setError(message);
      toast({ title: message, tone: "error" });
    } finally {
      busy.current = false;
      setPending(null);
    }
  };
```

Разрешение читается для пула:

```tsx
  const { data: allowance } = useNuvo(
    (c) => (product ? c.getAllowance(depositToken, product.pool, owner) : Promise.resolve(0)),
    [depositToken, owner, pending, product?.pool],
  );
```

- [ ] **Step 6: Срок годности убрать, про газ сказать**

Удалить блок «Quote good for …s» (строки 440–444) и на его место поставить строку про комиссию сети — на этой цепочке она платится эфиром, а не USDG, и об этом надо предупредить:

```tsx
          <p className="mt-[12px] t-mono-sm text-dim">
            Network fees on {NETWORK.name} are paid in ETH.
          </p>
```

Импортировать `NETWORK` из `@/lib/nuvo/config`.

- [ ] **Step 7: Проверить**

```bash
cd /c/Users/chaiz/Desktop/Recess/NUVO && npx tsc --noEmit && npm run build
```
Expected: сборка проходит. Ошибок в `app/app/[ticker]/page.tsx` нет.

- [ ] **Step 8: Коммит**

```bash
git add "app/app/[ticker]/page.tsx" && git commit -m "feat: the subscribe screen reads its terms from the pool"
```

---

### Task 15: Сайт — раздел вкладчика пула

Новый экран: внести, вывести, своя доля и сколько в пуле свободно. Раздел появляется в навигации приложения рядом с Products и Positions.

**Files:**
- Create: `NUVO/app/app/pool/page.tsx`
- Modify: `NUVO/components/app/AppHeader.tsx`

**Interfaces:**
- Consumes: `client.getPoolStats`, `client.addLiquidity`, `client.removeLiquidity`, `client.approve` (Задача 13).
- Produces: маршрут `/app/pool`, пункт навигации «Pool».

- [ ] **Step 1: Навигация**

В `components/app/AppHeader.tsx` дополнить `NAV`:

```tsx
const NAV = [
  { label: "Products", href: "/app" },
  { label: "Positions", href: "/app/positions" },
  { label: "Pool", href: "/app/pool" },
];
```

- [ ] **Step 2: Экран**

`app/app/pool/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useWallet } from "@/components/app/AppProviders";
import { useToast } from "@/components/app/Toaster";
import { usd } from "@/lib/format";
import { NETWORK, USDG, explorerTx } from "@/lib/nuvo/config";
import { txErrorMessage } from "@/lib/nuvo/errors";
import { client, useNuvo } from "@/lib/nuvo/useNuvo";
import type { Address } from "@/lib/nuvo/types";

// Вкладчик берёт другую сторону каждой подписки: он платит премию и получает
// право на конверсию. Здесь он вносит средства, видит свою долю и выводит её.
export default function PoolPage() {
  const wallet = useWallet();
  const toast = useToast();
  const owner = wallet.address as Address | undefined;

  const [ticker, setTicker] = useState<string | undefined>(undefined);
  const [usdgIn, setUsdgIn] = useState("");
  const [tokenIn, setTokenIn] = useState("");
  const [pending, setPending] = useState<"approve" | "add" | "remove" | null>(null);

  const { data: tickers } = useNuvo((c) => c.listTickers(), []);
  const active = ticker ?? tickers?.[0]?.symbol;
  const { data: stats, refresh } = useNuvo(
    (c) => (active ? c.getPoolStats(active, owner) : Promise.resolve(undefined)),
    [active, owner, pending],
  );
  const { data: balances } = useNuvo((c) => c.getBalances(owner), [owner]);

  const submitted = (title: string) => (hash: Address) =>
    toast({ title, tone: "info", href: explorerTx(hash), linkLabel: "Explorer" });

  const run = async (label: "approve" | "add" | "remove", work: () => Promise<unknown>) => {
    if (!client.ready.contracts || pending) return;
    setPending(label);
    try {
      await work();
      refresh();
    } catch (e) {
      toast({ title: txErrorMessage(e), tone: "error" });
    } finally {
      setPending(null);
    }
  };

  const onApprove = (symbol: string, value: string) =>
    run("approve", async () => {
      if (!stats) return;
      await client.approve(symbol, stats.pool, value, submitted(`Approving ${symbol}`));
      toast({ title: `${symbol} approved`, tone: "success" });
    });

  const onAdd = () =>
    run("add", async () => {
      if (!active) return;
      const tx = await client.addLiquidity(active, usdgIn, tokenIn, submitted("Deposit submitted"));
      toast({ title: "Deposited", tone: "success", href: explorerTx(tx.hash), linkLabel: "Explorer" });
      setUsdgIn("");
      setTokenIn("");
    });

  const onRemove = (part: bigint) =>
    run("remove", async () => {
      if (!active) return;
      const tx = await client.removeLiquidity(active, part, submitted("Withdrawal submitted"));
      toast({ title: "Withdrawn", tone: "success", href: explorerTx(tx.hash), linkLabel: "Explorer" });
    });

  return (
    <div>
      <h1 className="text-[40px] leading-none tracking-[-0.03em] text-ink">Pool</h1>
      <p className="mt-[12px] max-w-[620px] text-[16px] leading-[1.5] text-dim">
        Depositors take the other side of every subscription: they pay the premium and receive the
        stock or the USDG when a target is reached. Deposits earn from that flow; the share of the
        inventory reserved against open positions cannot be withdrawn until they settle.
      </p>

      <div className="mt-[24px] flex flex-wrap gap-[8px]">
        {(tickers ?? []).map((t) => (
          <button
            key={t.symbol}
            type="button"
            onClick={() => setTicker(t.symbol)}
            className={[
              "inline-flex h-[38px] items-center rounded-[6px] px-[14px] t-mono transition-colors duration-200",
              t.symbol === active ? "bg-nav text-ink" : "text-dim hover:bg-nav/60 hover:text-ink",
            ].join(" ")}
          >
            {t.symbol}
          </button>
        ))}
      </div>

      <div className="mt-[24px] grid gap-[16px] lg:grid-cols-[1fr_400px] lg:items-start">
        <section className="rounded-[16px] bg-white p-[24px]">
          <h2 className="t-mono-sm text-dim">Inventory</h2>
          <dl className="mt-[16px] flex flex-col gap-[10px] text-[15px]">
            <Row label="Pool value" value={stats ? `$${usd(stats.valueUsdg)}` : "—"} />
            <Row label="Free right now" value={stats ? `$${usd(stats.freeUsdg)}` : "—"} />
            <Row label="Your share" value={stats ? `$${usd(stats.myValueUsdg)}` : "—"} />
            <Row
              label="Status"
              value={stats ? (stats.paused ? "Deposits paused" : "Open") : "—"}
            />
          </dl>
          <p className="mt-[16px] text-[14px] leading-[1.5] text-dim">
            Network fees on {NETWORK.name} are paid in ETH.
          </p>
        </section>

        <aside className="rounded-[16px] bg-white p-[24px]">
          <h2 className="t-mono-sm text-dim">Deposit</h2>
          <Field
            label={USDG.symbol}
            value={usdgIn}
            onChange={setUsdgIn}
            balance={balances?.[USDG.symbol]?.exact}
          />
          {active && (
            <Field
              label={active}
              value={tokenIn}
              onChange={setTokenIn}
              balance={balances?.[active]?.exact}
            />
          )}

          <div className="mt-[16px] flex flex-col gap-[8px]">
            {Number(usdgIn) > 0 && (
              <Button
                label={`Approve ${USDG.symbol}`}
                busy={pending === "approve"}
                onClick={() => onApprove(USDG.symbol, usdgIn)}
              />
            )}
            {active && Number(tokenIn) > 0 && (
              <Button
                label={`Approve ${active}`}
                busy={pending === "approve"}
                onClick={() => onApprove(active, tokenIn)}
              />
            )}
            <Button label="Deposit" busy={pending === "add"} onClick={onAdd} />
          </div>

          <h2 className="t-mono-sm mt-[28px] border-t border-[#E4E6E2] pt-[20px] text-dim">
            Withdraw
          </h2>
          <p className="mt-[8px] text-[14px] text-dim">
            {stats && stats.shares > 0n
              ? `Your share is worth $${usd(stats.myValueUsdg)} at the current reference.`
              : "You have nothing in this pool yet."}
          </p>
          <div className="mt-[12px] flex gap-[8px]">
            <Button
              label="Half"
              busy={pending === "remove"}
              onClick={() => stats && onRemove(stats.shares / 2n)}
            />
            <Button
              label="All"
              busy={pending === "remove"}
              onClick={() => stats && onRemove(stats.shares)}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-[16px]">
      <dt className="text-dim">{label}</dt>
      <dd className="text-right tabular text-ink">{value}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  balance,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  balance?: string;
}) {
  return (
    <div className="mt-[12px]">
      <div className="flex items-baseline justify-between">
        <span className="t-mono-sm text-dim">{label}</span>
        {balance !== undefined && (
          <button
            type="button"
            onClick={() => onChange(balance)}
            className="t-mono-sm text-dim hover:text-ink"
          >
            Max
          </button>
        )}
      </div>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, ""))}
        placeholder="0.00"
        aria-label={`Amount in ${label}`}
        className="mt-[8px] h-[52px] w-full rounded-[8px] border border-[#E4E6E2] px-[14px] text-[20px] tabular text-ink outline-none focus:border-ink"
      />
    </div>
  );
}

function Button({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || !client.ready.contracts}
      className="flex min-h-[48px] w-full items-center justify-center rounded-[8px] bg-ink px-[16px] t-mono text-white transition-colors duration-200 hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-nav disabled:text-dim"
    >
      {busy ? "Confirming…" : label}
    </button>
  );
}
```

- [ ] **Step 3: Проверить**

```bash
cd /c/Users/chaiz/Desktop/Recess/NUVO && npx tsc --noEmit && npm run build
```
Expected: сборка проходит, маршрут `/app/pool` есть в выводе.

- [ ] **Step 4: Коммит**

```bash
git add app/app/pool components/app/AppHeader.tsx
git commit -m "feat: a pool section where depositors take the other side"
```

---

### Task 16: Сайт — позиции, документация, сборка

**Files:**
- Modify: `NUVO/app/app/positions/page.tsx`, `NUVO/lib/nuvo/useNuvo.ts` (если понадобится), `NUVO/README.md`
- Modify: `NUVO/docs/superpowers/specs/2026-09-23-nuvo-protocol-design.md` (пометка о выполненных правках раздела 11)

**Interfaces:**
- Consumes: `client.getPositions`, `client.claim` с идентификатором вида `"0xПул:индекс"`.
- Produces: собранный сайт, где весь путь от подписки до выплаты идёт на контрактах.

- [ ] **Step 1: Позиции**

В `app/app/positions/page.tsx` менять почти нечего: `Position.id` стал строкой с адресом пула, а `client.claim(position.id)` принимает её как есть. Проверить только два места:

- в карточке позиции, если где-то печатается `position.productId` — заменить на `position.ticker`;
- `subscribedAt` теперь 0 (контракт его не хранит), поэтому сортировка идёт по `expiresAt`, а подпись «Subscribed …» убрать, оставив «Settles …» по `expiresAt`.

- [ ] **Step 2: README**

В `NUVO/README.md` заменить раздел про сервис котировок на раздел про контракты:

```markdown
## Контракты

Протокол лежит в `contracts/` отдельным проектом Foundry. Сайту нужен один
адрес — фабрики: тикеры, фиды, премии и лимиты он читает у неё и у пулов.

    cd contracts && forge test        # весь набор, форк-тест пропускается без RPC_URL
    node script/expiries.mjs 26       # календарь экспираций для addExpiries

Порядок запуска, роли и лимиты описаны в
`docs/superpowers/specs/2026-09-23-nuvo-protocol-design.md`.
```

- [ ] **Step 3: Собрать целиком**

```bash
cd /c/Users/chaiz/Desktop/Recess/NUVO
npx tsc --noEmit
npm run build
cd contracts && forge test
```
Expected: обе сборки зелёные, все тесты контрактов проходят.

- [ ] **Step 4: Коммит**

```bash
cd /c/Users/chaiz/Desktop/Recess/NUVO
git add -A
git commit -m "feat: positions and docs follow the contracts"
```

---

## Что остаётся владельцу

План доводит код до состояния, в котором всё работает на цепочке. Вне его — решения, которые принимает владелец, а не исполнитель:

1. Задать ставки премий и лимиты в `contracts/.env` перед деплоем. В плане стоят рабочие значения первой недели (премия до 10%, от 100 USDG, до 5 000 на позицию, до 50 000 на неделю, до 60% инвентаря в работе) — это отправная точка для разговора, а не окончательная экономика.
2. Завести мультиподпись и поставить её владельцем фабрики и пулов, приняв владение вторым шагом `acceptOwnership`.
3. Пройти порядок запуска из раздела 10 спецификации: тестнет, мейннет с жёстким потолком и только своими деньгами, снятие потолка, и лишь затем чужие средства.
4. Поставить бот, который вызывает `settle(expiry)` вскоре после пятничного закрытия. Он подстраховка: расчёт открыт всем, и его может вызвать любой.
5. Заполнить переменные в Vercel: `NEXT_PUBLIC_FACTORY_ADDRESS`, `NEXT_PUBLIC_USDG_ADDRESS`, сеть и `NEXT_PUBLIC_SITE_URL`.
