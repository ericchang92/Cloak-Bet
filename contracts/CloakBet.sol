// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint8, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title CloakBet
/// @notice 2-player card game using FHE: players decrypt their own hand, play 1 card, and the contract returns an encrypted boolean winner.
contract CloakBet is ZamaEthereumConfig {
    uint8 public constant HAND_SIZE = 6;
    uint8 public constant DECK_SIZE = 52;
    uint8 public constant RANKS = 13;
    uint64 private constant _DUMMY_USED_MASK = 0xFFF0000000000000; // bits 52..63 set to 1

    struct Game {
        address player0;
        address player1;
        bool started;
        bool finished;
        uint256 createdAt;
        euint64 usedMask; // 52 LSBs track used cards (encrypted)
        uint8 dealIndex; // number of rounds dealt (0..HAND_SIZE)
        euint8[HAND_SIZE] hand0;
        euint8[HAND_SIZE] hand1;
        uint8 playedIndex0;
        uint8 playedIndex1;
        bool hasPlayed0;
        bool hasPlayed1;
        ebool p0Wins; // encrypted result (publicly decryptable)
    }

    uint256 public nextGameId;
    mapping(uint256 => Game) private _games;

    uint256[] private _openGameIds;
    mapping(uint256 => uint256) private _openIndexPlusOne;

    event GameCreated(uint256 indexed gameId, address indexed creator);
    event GameJoined(uint256 indexed gameId, address indexed joiner);
    event GameStarted(uint256 indexed gameId);
    event RoundDealt(uint256 indexed gameId, uint8 roundIndex);
    event CardPlayed(uint256 indexed gameId, address indexed player, uint8 handIndex);
    event GameFinished(uint256 indexed gameId, ebool p0Wins);

    error GameNotFound(uint256 gameId);
    error GameNotOpen(uint256 gameId);
    error GameFull(uint256 gameId);
    error GameNotReady(uint256 gameId);
    error GameAlreadyStarted(uint256 gameId);
    error GameAlreadyFinished(uint256 gameId);
    error HandsNotDealt(uint256 gameId);
    error HandsAlreadyDealt(uint256 gameId);
    error NotAPlayer(uint256 gameId);
    error AlreadyPlayed(uint256 gameId);
    error InvalidHandIndex(uint8 handIndex);

    function createGame() external returns (uint256 gameId) {
        gameId = nextGameId++;
        Game storage g = _games[gameId];
        g.player0 = msg.sender;
        g.createdAt = block.timestamp;
        _pushOpen(gameId);
        emit GameCreated(gameId, msg.sender);
    }

    function joinGame(uint256 gameId) external {
        Game storage g = _getGame(gameId);
        if (g.started) revert GameAlreadyStarted(gameId);
        if (g.player1 != address(0)) revert GameFull(gameId);
        if (g.player0 == address(0)) revert GameNotFound(gameId);
        if (g.player0 == msg.sender) revert GameNotOpen(gameId);
        g.player1 = msg.sender;
        _removeOpen(gameId);
        emit GameJoined(gameId, msg.sender);
    }

    function startGame(uint256 gameId) external {
        Game storage g = _getGame(gameId);
        if (g.started) revert GameAlreadyStarted(gameId);
        if (g.player0 == address(0) || g.player1 == address(0)) revert GameNotReady(gameId);
        if (msg.sender != g.player0 && msg.sender != g.player1) revert NotAPlayer(gameId);

        g.started = true;
        g.dealIndex = 0;
        g.usedMask = FHE.asEuint64(0);
        FHE.allowThis(g.usedMask);

        emit GameStarted(gameId);
    }

    /// @notice Deals one round (one card for each player). Call this 6 times to fully deal both hands.
    function dealRound(uint256 gameId) external {
        Game storage g = _getGame(gameId);
        if (!g.started) revert GameNotReady(gameId);
        if (g.finished) revert GameAlreadyFinished(gameId);
        if (g.dealIndex >= HAND_SIZE) revert HandsAlreadyDealt(gameId);
        if (msg.sender != g.player0 && msg.sender != g.player1) revert NotAPlayer(gameId);

        uint8 i = g.dealIndex;
        euint64 used = g.usedMask;

        (euint8 c0, euint64 used0) = _drawUniqueCard(used);
        used = used0;
        g.hand0[i] = c0;
        FHE.allowThis(c0);
        FHE.allow(c0, g.player0);

        (euint8 c1, euint64 used1) = _drawUniqueCard(used);
        used = used1;
        g.hand1[i] = c1;
        FHE.allowThis(c1);
        FHE.allow(c1, g.player1);

        g.usedMask = used;
        FHE.allowThis(g.usedMask);

        g.dealIndex = i + 1;
        emit RoundDealt(gameId, i);
    }

    function playCard(uint256 gameId, uint8 handIndex) external {
        Game storage g = _getGame(gameId);
        if (!g.started) revert GameNotReady(gameId);
        if (g.finished) revert GameAlreadyFinished(gameId);
        if (g.dealIndex < HAND_SIZE) revert HandsNotDealt(gameId);
        if (handIndex >= HAND_SIZE) revert InvalidHandIndex(handIndex);

        bool isP0 = msg.sender == g.player0;
        bool isP1 = msg.sender == g.player1;
        if (!isP0 && !isP1) revert NotAPlayer(gameId);

        if (isP0) {
            if (g.hasPlayed0) revert AlreadyPlayed(gameId);
            g.hasPlayed0 = true;
            g.playedIndex0 = handIndex;
        } else {
            if (g.hasPlayed1) revert AlreadyPlayed(gameId);
            g.hasPlayed1 = true;
            g.playedIndex1 = handIndex;
        }

        emit CardPlayed(gameId, msg.sender, handIndex);

        if (g.hasPlayed0 && g.hasPlayed1) {
            _finishGame(gameId, g);
        }
    }

    /// @notice Returns open games (not full and not started).
    function getOpenGameIds() external view returns (uint256[] memory) {
        return _openGameIds;
    }

    /// @notice Returns basic game info. View methods do not use msg.sender.
    function getGameInfo(uint256 gameId)
        external
        view
        returns (
            address player0,
            address player1,
            bool started,
            bool finished,
            bool bothPlayed,
            uint8 dealIndex,
            uint256 createdAt
        )
    {
        Game storage g = _getGame(gameId);
        player0 = g.player0;
        player1 = g.player1;
        started = g.started;
        finished = g.finished;
        bothPlayed = g.hasPlayed0 && g.hasPlayed1;
        dealIndex = g.dealIndex;
        createdAt = g.createdAt;
    }

    /// @notice Returns the encrypted hand for the given player address.
    function getHand(uint256 gameId, address player) external view returns (euint8[HAND_SIZE] memory) {
        Game storage g = _getGame(gameId);
        if (player == g.player0) return g.hand0;
        if (player == g.player1) return g.hand1;
        revert NotAPlayer(gameId);
    }

    /// @notice Returns indices chosen by both players (if played).
    function getPlayedIndexes(uint256 gameId) external view returns (bool p0Played, uint8 p0Index, bool p1Played, uint8 p1Index) {
        Game storage g = _getGame(gameId);
        p0Played = g.hasPlayed0;
        p0Index = g.playedIndex0;
        p1Played = g.hasPlayed1;
        p1Index = g.playedIndex1;
    }

    /// @notice Returns the encrypted winner flag (true => player0 wins). Publicly decryptable after the game finishes.
    function getResult(uint256 gameId) external view returns (ebool) {
        Game storage g = _getGame(gameId);
        return g.p0Wins;
    }

    function _getGame(uint256 gameId) internal view returns (Game storage) {
        Game storage g = _games[gameId];
        if (g.player0 == address(0)) revert GameNotFound(gameId);
        return g;
    }

    function _pushOpen(uint256 gameId) internal {
        _openIndexPlusOne[gameId] = _openGameIds.length + 1;
        _openGameIds.push(gameId);
    }

    function _removeOpen(uint256 gameId) internal {
        uint256 idxPlusOne = _openIndexPlusOne[gameId];
        if (idxPlusOne == 0) return;
        uint256 idx = idxPlusOne - 1;
        uint256 lastIdx = _openGameIds.length - 1;
        if (idx != lastIdx) {
            uint256 moved = _openGameIds[lastIdx];
            _openGameIds[idx] = moved;
            _openIndexPlusOne[moved] = idx + 1;
        }
        _openGameIds.pop();
        _openIndexPlusOne[gameId] = 0;
    }

    function _finishGame(uint256 gameId, Game storage g) internal {
        euint8 c0 = g.hand0[g.playedIndex0];
        euint8 c1 = g.hand1[g.playedIndex1];

        euint8 r0 = FHE.rem(c0, RANKS);
        euint8 r1 = FHE.rem(c1, RANKS);
        euint8 s0 = FHE.div(c0, RANKS);
        euint8 s1 = FHE.div(c1, RANKS);

        ebool rankGt = FHE.gt(r0, r1);
        ebool rankEq = FHE.eq(r0, r1);
        ebool suitGt = FHE.gt(s0, s1);
        ebool p0Wins = FHE.or(rankGt, FHE.and(rankEq, suitGt));

        g.p0Wins = p0Wins;
        g.finished = true;

        FHE.allowThis(p0Wins);
        FHE.allow(p0Wins, g.player0);
        FHE.allow(p0Wins, g.player1);
        FHE.makePubliclyDecryptable(p0Wins);

        emit GameFinished(gameId, p0Wins);
    }

    function _drawUniqueCard(euint64 usedMask) internal returns (euint8 card, euint64 newMask) {
        // Use a random rotation then deterministically take the first available slot (0 bit).
        // This avoids O(52) scans and stays within HCU limits in a single transaction.
        euint8 start = FHE.randEuint8(64);
        euint64 maskWithDummies = FHE.or(usedMask, FHE.asEuint64(_DUMMY_USED_MASK));
        euint64 rotated = FHE.rotr(maskWithDummies, start);

        euint8 pos = _firstZeroBitIndex(rotated);
        euint8 card64 = FHE.add(pos, start);
        card = FHE.and(card64, uint8(63)); // mod 64, guaranteed < 52 due to dummy bits

        euint64 bit = FHE.shl(FHE.asEuint64(1), card);
        newMask = FHE.or(usedMask, bit);
        FHE.allowThis(newMask);
    }

    function _firstZeroBitIndex(euint64 mask) internal returns (euint8 idx) {
        idx = FHE.asEuint8(0);

        // Find the first 0 bit starting from LSB using a binary search on fixed-size blocks.
        // Each step checks if the lower block is fully set to 1; if so, skip it.
        (mask, idx) = _skipIfLowerFull(mask, idx, 32, 0xFFFFFFFF);
        (mask, idx) = _skipIfLowerFull(mask, idx, 16, 0xFFFF);
        (mask, idx) = _skipIfLowerFull(mask, idx, 8, 0xFF);
        (mask, idx) = _skipIfLowerFull(mask, idx, 4, 0xF);
        (mask, idx) = _skipIfLowerFull(mask, idx, 2, 0x3);

        euint64 low1 = FHE.and(mask, FHE.asEuint64(1));
        ebool low1Full = FHE.eq(low1, FHE.asEuint64(1));
        idx = FHE.select(low1Full, FHE.add(idx, 1), idx);
    }

    function _skipIfLowerFull(euint64 mask, euint8 idx, uint8 bits, uint64 ones) internal returns (euint64 newMask, euint8 newIdx) {
        euint64 onesEnc = FHE.asEuint64(ones);
        euint64 lower = FHE.and(mask, onesEnc);
        ebool lowerFull = FHE.eq(lower, onesEnc);
        newMask = FHE.select(lowerFull, FHE.shr(mask, bits), mask);
        newIdx = FHE.select(lowerFull, FHE.add(idx, bits), idx);
    }
}
