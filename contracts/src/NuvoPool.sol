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

    /// @dev Общая точка для конструктора и сеттера настроек.
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
