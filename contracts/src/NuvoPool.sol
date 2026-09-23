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
    /// @notice Через столько после экспирации позицию может закрыть кто угодно.
    uint64 public constant RESOLVE_DELAY = 1 days;
    /// @notice Доля, которая остаётся в пуле навсегда: не даёт обнулить масштаб пая.
    uint256 internal constant FLOOR_SHARES = 1e15;

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

    /// @notice Открытые позиции по каждой экспирации и сколько их всего ждёт
    ///         выплаты по уже рассчитанным неделям. Пока это число не ноль,
    ///         стоимость пая известна не до конца, и вклады с выводами закрыты.
    mapping(uint64 => uint256) public openAt;
    uint256 public pendingSettled;

    /// @notice Выплата, закрытая без перевода: ждёт владельца.
    mapping(address => mapping(address => uint256)) public owed;

    struct Limits {
        uint64 maxPriceAge;
        uint64 maxPriceAgeSettle;
        uint256 minDepositValueWad;
        uint256 maxPositionValueWad;
        uint256 maxExpiryLockValueWad;
        uint16 maxLockedShareBps;
    }

    Limits public pendingLimits;
    uint256 public pendingLimitsEta;

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
    error SettlementPending();
    error UseSchedule();
    error NothingOwed();

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

    /// @dev Цена, пригодная для подписки. Порог широкий, потому что подписка
    ///      открыта круглосуточно, а фид стоит по выходным и в праздники.
    function _freshPrice() internal view returns (uint256 price) {
        uint256 at;
        (price, at) = priceWad();
        if (block.timestamp > at + maxPriceAge) revert StalePrice();
    }

    /// @dev Цена, пригодная для оценки пая. Порог тот же, что у расчёта:
    ///      вопрос один и тот же — отражает ли цена рынок прямо сейчас.
    ///      Широкий порог подписки здесь не годится: по нему вкладчик,
    ///      пришедший в выходные, забрал бы понедельничный разрыв у остальных.
    function _freshPriceForShares() internal view returns (uint256 price) {
        uint256 at;
        (price, at) = priceWad();
        if (block.timestamp > at + maxPriceAgeSettle) revert StalePrice();
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
        // Пока по рассчитанной неделе не забраны выплаты, будущее движение
        // инвентаря уже предрешено и в стоимости пая не отражено. Вход в этот
        // момент — это вход в известный исход за чужой счёт.
        if (pendingSettled != 0) revert SettlementPending();
        uint256 price = _freshPriceForShares();
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
        // Тот же запрет, что и на вход: иначе выйти можно было бы перед
        // известным убытком, оставив его тем, кто остался.
        if (pendingSettled != 0) revert SettlementPending();
        uint256 price = _freshPriceForShares();

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
        openAt[p.expiry] += 1;

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

    // --- выплата ---

    function claim(uint256 id) external nonReentrant returns (address asset, uint256 amount) {
        return _close(id, msg.sender, false);
    }

    /// @notice Выплата на другой адрес. Нужна, если токен акции почему-то не
    ///         принимает перевод на адрес владельца позиции.
    function claimTo(uint256 id, address to) external nonReentrant returns (address asset, uint256 amount) {
        if (to == address(0)) revert NotAllowed();
        return _close(id, to, false);
    }

    /// @notice Закрыть чужую позицию через сутки после экспирации. Перевода нет:
    ///         выплата записывается владельцу в долг. Так неснятая выплата не
    ///         держит инвентарь вкладчиков в заморозке бесконечно.
    function resolve(uint256 id) external nonReentrant {
        Position memory p = _positions[id];
        if (block.timestamp < uint256(p.expiry) + RESOLVE_DELAY) revert TooEarly();
        _close(id, p.owner, true);
    }

    /// @notice Отдать записанный долг его владельцу. Открыто всем: кто угодно
    ///         может дослать выплату тому, кому она причитается.
    function withdrawOwed(address who, address asset) external nonReentrant {
        uint256 amount = owed[who][asset];
        if (amount == 0) revert NothingOwed();
        owed[who][asset] = 0;
        IERC20(asset).safeTransfer(who, amount);
    }

    function _close(uint256 id, address to, bool credit)
        internal
        returns (address asset, uint256 amount)
    {
        Position storage p = _positions[id];
        if (!credit && p.owner != msg.sender) revert NotYours();
        if (p.claimed) revert AlreadyClaimed();
        uint256 price = settlePriceWad[p.expiry];
        if (price == 0) revert NotSettled();
        p.claimed = true;
        openAt[p.expiry] -= 1;
        pendingSettled -= 1;

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

            } else {
                asset = address(usdg);
                amount = p.deposit + p.lockUsdg;
                freeToken += p.lockToken;
                premium = p.lockUsdg;
                premiumInUsdg = true;

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

            } else {
                asset = address(token);
                amount = p.deposit + p.lockToken;
                freeUsdg += p.lockUsdg;
                premium = p.lockToken;

            }
        }

        _takeFee(premiumInUsdg, premium);

        if (credit) {
            // Перевода нет: выплата записывается в долг и ждёт владельца.
            owed[p.owner][asset] += amount;
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
        emit Claimed(id, p.owner, asset, amount, converted);
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

        // Номер раунда у Chainlink содержит номер фазы, и после смены агрегатора
        // соседний номер не читается. Нечитаемый сосед — это «неизвестно», а не
        // «соседа нет»: принять такой раунд значило бы поверить ему на слово.
        (uint80 latestId,,, uint256 latestAt,) = feed.latestRoundData();

        if (at <= expiry) {
            // Цена, действовавшая в момент экспирации: после неё не должно быть
            // раунда, успевшего до экспирации.
            (bool hasNext, uint256 nextAt) = _roundTime(roundId + 1);
            if (hasNext && nextAt <= expiry) revert NotTheSettleRound();
            // Соседний номер не читается, но последний раунд фида — не этот и
            // тоже успел до экспирации: значит после него что-то было.
            if (!hasNext && roundId != latestId && latestAt <= expiry) revert NotTheSettleRound();
            // Фид, замолчавший задолго до закрытия, неделю не рассчитывает: ждём свежей цены.
            if (at + maxPriceAgeSettle < expiry) revert StalePrice();
        } else {
            // Фид молчал через экспирацию: неделю рассчитывает первый раунд после неё,
            // и только если предыдущий был слишком стар, чтобы считать по нему.
            (bool hasPrev, uint256 prevAt) = _roundTime(roundId - 1);
            if (hasPrev) {
                if (prevAt > expiry) revert NotTheSettleRound();
                if (prevAt + maxPriceAgeSettle >= expiry) revert NotTheSettleRound();
            } else if (at > expiry + maxPriceAgeSettle) {
                // Предыдущего раунда не видно, значит первый ли это раунд после
                // экспирации — неизвестно. Такой принимается, только если сам он
                // близок к экспирации по времени.
                revert NotTheSettleRound();
            }
        }

        settlePriceWad[expiry] = price;
        pendingSettled += openAt[expiry];
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

    /// @notice Поиск раунда для расчёта: идёт назад от `from`, пока раунды
    ///         моложе экспирации. Вызывается бесплатно и отдаёт номер, который
    ///         затем передаётся в settleWithRound.
    function findSettleRound(uint64 expiry, uint80 from, uint16 maxSteps)
        external
        view
        returns (uint80 roundId, bool found)
    {
        roundId = from;
        for (uint16 i = 0; i <= maxSteps; i++) {
            (bool ok,, uint256 at) = _roundAt(roundId);
            if (!ok) return (roundId, false);
            if (at <= expiry) return (roundId, true);
            if (roundId == 0) return (roundId, false);
            roundId -= 1;
        }
        return (roundId, false);
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

    /// @notice Ужесточение лимитов действует сразу: это защита, и ждать её
    ///         нельзя. Ослабление — только через scheduleLimits с задержкой,
    ///         чтобы вкладчик успел выйти, если условия ему разонравились.
    function setLimits(
        uint64 priceAge,
        uint64 priceAgeSettle,
        uint256 minDeposit,
        uint256 maxPosition,
        uint256 maxExpiryLock,
        uint16 lockedShareBps
    ) external onlyOwner {
        _checkCaps(priceAge, priceAgeSettle, lockedShareBps);
        Limits memory next = Limits(
            priceAge, priceAgeSettle, minDeposit, maxPosition, maxExpiryLock, lockedShareBps
        );
        if (_loosens(next)) revert UseSchedule();
        _setLimits(priceAge, priceAgeSettle, minDeposit, maxPosition, maxExpiryLock, lockedShareBps);
    }

    function scheduleLimits(
        uint64 priceAge,
        uint64 priceAgeSettle,
        uint256 minDeposit,
        uint256 maxPosition,
        uint256 maxExpiryLock,
        uint16 lockedShareBps
    ) external onlyOwner {
        // Невозможное расписание отклоняется сразу, а не через два дня.
        _checkCaps(priceAge, priceAgeSettle, lockedShareBps);
        pendingLimits = Limits(
            priceAge, priceAgeSettle, minDeposit, maxPosition, maxExpiryLock, lockedShareBps
        );
        pendingLimitsEta = block.timestamp + MODEL_DELAY;
    }

    /// @notice Открыто всем: после задержки применить назначенные лимиты.
    function applyLimits() external {
        if (pendingLimitsEta == 0) revert NothingPending();
        if (block.timestamp < pendingLimitsEta) revert TooEarly();
        Limits memory next = pendingLimits;
        pendingLimitsEta = 0;
        delete pendingLimits;
        _setLimits(
            next.maxPriceAge,
            next.maxPriceAgeSettle,
            next.minDepositValueWad,
            next.maxPositionValueWad,
            next.maxExpiryLockValueWad,
            next.maxLockedShareBps
        );
    }

    /// @dev Ноль в потолке значит «без потолка», то есть самое слабое из возможных.
    function _loosens(Limits memory next) internal view returns (bool) {
        if (next.maxPriceAge > maxPriceAge) return true;
        if (next.maxPriceAgeSettle > maxPriceAgeSettle) return true;
        if (next.minDepositValueWad < minDepositValueWad) return true;
        if (next.maxLockedShareBps > maxLockedShareBps) return true;
        if (_cap(next.maxPositionValueWad) > _cap(maxPositionValueWad)) return true;
        if (_cap(next.maxExpiryLockValueWad) > _cap(maxExpiryLockValueWad)) return true;
        return false;
    }

    function _cap(uint256 value) internal pure returns (uint256) {
        return value == 0 ? type(uint256).max : value;
    }

    /// @dev Границы, за которые лимиты не выпускаются ни сразу, ни с задержкой.
    function _checkCaps(uint64 priceAge, uint64 priceAgeSettle, uint16 lockedShareBps) internal pure {
        if (priceAge == 0 || priceAge > 7 days) revert TooHigh();
        if (priceAgeSettle == 0 || priceAgeSettle > 24 hours) revert TooHigh();
        if (lockedShareBps > BPS) revert TooHigh();
    }

    /// @notice Отказаться от владения нельзя: без владельца пул теряет паузу,
    ///         лимиты и вывод комиссии навсегда.
    function renounceOwnership() public view override onlyOwner {
        revert NotAllowed();
    }

    /// @dev Учёт ведётся по счётчикам, поэтому токен, удерживающий комиссию с
    ///      перевода, разошёлся бы с ними. Такой перевод отклоняется.
    function _pullExactly(IERC20 asset, uint256 amount) internal {
        uint256 before = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.balanceOf(address(this)) - before != amount) revert TransferMismatch();
    }

    /// @dev Общая точка для конструктора и сеттера настроек.
    function _setLimits(
        uint64 priceAge,
        uint64 priceAgeSettle,
        uint256 minDeposit,
        uint256 maxPosition,
        uint256 maxExpiryLock,
        uint16 lockedShareBps
    ) internal {
        _checkCaps(priceAge, priceAgeSettle, lockedShareBps);
        maxPriceAge = priceAge;
        maxPriceAgeSettle = priceAgeSettle;
        minDepositValueWad = minDeposit;
        maxPositionValueWad = maxPosition;
        maxExpiryLockValueWad = maxExpiryLock;
        maxLockedShareBps = lockedShareBps;
        emit LimitsSet(priceAge, priceAgeSettle, minDeposit, maxPosition, maxExpiryLock, lockedShareBps);
    }
}
