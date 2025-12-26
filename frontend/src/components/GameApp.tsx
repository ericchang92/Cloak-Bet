import { useCallback, useEffect, useMemo, useState } from 'react';
import { Contract, Interface } from 'ethers';
import { useAccount } from 'wagmi';

import { Header } from './Header';
import { publicClient } from '../lib/viem';
import { CLOAKBET_ABI, CLOAKBET_ADDRESS } from '../config/contracts';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';

import '../styles/GameApp.css';

type GameInfo = {
  id: bigint;
  player0: string;
  player1: string;
  started: boolean;
  finished: boolean;
  bothPlayed: boolean;
  dealIndex: number;
  createdAt: bigint;
};

type DecryptedCard = {
  index: number;
  value: number;
  rank: string;
  suit: string;
  label: string;
};

const SUITS = ['Clubs', 'Diamonds', 'Hearts', 'Spades'] as const;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

function formatCard(value: number): Omit<DecryptedCard, 'index'> {
  const rankIndex = value % 13;
  const suitIndex = Math.floor(value / 13);
  const rank = RANKS[rankIndex] ?? '?';
  const suit = SUITS[suitIndex] ?? '?';
  return { value, rank, suit, label: `${rank} of ${suit}` };
}

function asAddress(value: string): `0x${string}` {
  return value as `0x${string}`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function isHexAddress(value: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return false;
  return value.toLowerCase() !== '0x0000000000000000000000000000000000000000';
}

export function GameApp() {
  const { address } = useAccount();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [contractAddressInput, setContractAddressInput] = useState<string>(CLOAKBET_ADDRESS);
  const [openGames, setOpenGames] = useState<GameInfo[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string>('');
  const [selectedGame, setSelectedGame] = useState<GameInfo | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const [hand, setHand] = useState<DecryptedCard[] | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  const [result, setResult] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const cloakBetAddress = useMemo(() => {
    if (!isHexAddress(contractAddressInput)) return null;
    return asAddress(contractAddressInput);
  }, [contractAddressInput]);
  const iface = useMemo(() => new Interface(CLOAKBET_ABI as any), []);

  const refresh = useCallback(async () => {
    try {
      if (!cloakBetAddress) return;
      const ids = (await publicClient.readContract({
        address: cloakBetAddress,
        abi: CLOAKBET_ABI,
        functionName: 'getOpenGameIds',
      })) as bigint[];

      const games = await Promise.all(
        ids.map(async (id) => {
          const info = (await publicClient.readContract({
            address: cloakBetAddress,
            abi: CLOAKBET_ABI,
            functionName: 'getGameInfo',
            args: [id],
          })) as readonly [string, string, boolean, boolean, boolean, number, bigint];

          return {
            id,
            player0: info[0],
            player1: info[1],
            started: info[2],
            finished: info[3],
            bothPlayed: info[4],
            dealIndex: info[5],
            createdAt: info[6],
          } satisfies GameInfo;
        }),
      );

      setOpenGames(games);

      if (selectedGameId.trim() !== '') {
        const id = BigInt(selectedGameId);
        const info = (await publicClient.readContract({
          address: cloakBetAddress,
          abi: CLOAKBET_ABI,
          functionName: 'getGameInfo',
          args: [id],
        })) as readonly [string, string, boolean, boolean, boolean, number, bigint];

        setSelectedGame({
          id,
          player0: info[0],
          player1: info[1],
          started: info[2],
          finished: info[3],
          bothPlayed: info[4],
          dealIndex: info[5],
          createdAt: info[6],
        });
      } else {
        setSelectedGame(null);
      }
    } catch (e) {
      console.error(e);
    }
  }, [cloakBetAddress, selectedGameId]);

  useEffect(() => {
    void refresh();
  }, [refreshNonce, refresh]);

  const writeContract = useCallback(async () => {
    if (!signerPromise) throw new Error('Wallet not connected');
    if (!cloakBetAddress) throw new Error('Set a valid contract address first.');
    const signer = await signerPromise;
    return new Contract(cloakBetAddress, CLOAKBET_ABI, signer);
  }, [cloakBetAddress, signerPromise]);

  const createGame = useCallback(async () => {
    setBusy('Creating game…');
    try {
      const contract = await writeContract();
      const tx = await contract.createGame();
      const receipt = await tx.wait();
      const parsed = receipt.logs
        .map((l: any) => {
          try {
            return iface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((x: any) => x?.name === 'GameCreated');

      const gameId = parsed?.args?.gameId as bigint | undefined;
      if (typeof gameId !== 'bigint') throw new Error('Failed to read gameId from logs');
      setSelectedGameId(gameId.toString());
      setHand(null);
      setResult(null);
      setRefreshNonce((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }, [iface, writeContract]);

  const joinGame = useCallback(
    async (gameId: bigint) => {
      setBusy('Joining game…');
      try {
        const contract = await writeContract();
        const tx = await contract.joinGame(gameId);
        await tx.wait();
        setSelectedGameId(gameId.toString());
        setHand(null);
        setResult(null);
        setRefreshNonce((n) => n + 1);
      } finally {
        setBusy(null);
      }
    },
    [writeContract],
  );

  const dealRemaining = useCallback(async () => {
    if (!selectedGame) return;
    if (selectedGame.dealIndex >= 6) return;
    setBusy(`Dealing cards (${selectedGame.dealIndex}/6)…`);
    try {
      setHand(null);
      setResult(null);
      const contract = await writeContract();
      for (let round = selectedGame.dealIndex; round < 6; round++) {
        try {
          const tx = await contract.dealRound(selectedGame.id);
          await tx.wait();
          setRefreshNonce((n) => n + 1);
        } catch (e) {
          console.error(e);
          break;
        }
      }
    } finally {
      setBusy(null);
    }
  }, [selectedGame, writeContract]);

  const startAndDeal = useCallback(async () => {
    if (!selectedGame) return;
    setBusy('Starting game…');
    try {
      setHand(null);
      setResult(null);
      const contract = await writeContract();
      if (!selectedGame.started) {
        const tx = await contract.startGame(selectedGame.id);
        await tx.wait();
      }
      setRefreshNonce((n) => n + 1);
    } finally {
      setBusy(null);
    }
    await dealRemaining();
  }, [dealRemaining, selectedGame, writeContract]);

  const decryptMyHand = useCallback(async () => {
    setDecryptError(null);
    setResult(null);

    if (!address) {
      setDecryptError('Connect your wallet first.');
      return;
    }
    if (!selectedGame) {
      setDecryptError('Select a game id first.');
      return;
    }
    if (!cloakBetAddress) {
      setDecryptError('Set a valid contract address first.');
      return;
    }
    if (!instance || zamaLoading || zamaError) {
      setDecryptError(zamaError ?? 'Encryption service not ready.');
      return;
    }
    if (!signerPromise) {
      setDecryptError('Wallet signer not available.');
      return;
    }

    setIsDecrypting(true);
    try {
      const handles = (await publicClient.readContract({
        address: cloakBetAddress,
        abi: CLOAKBET_ABI,
        functionName: 'getHand',
        args: [selectedGame.id, address],
      })) as readonly `0x${string}`[];

      const keypair = instance.generateKeypair();
      const nonZero = handles.filter(
        (h) => h !== '0x0000000000000000000000000000000000000000000000000000000000000000',
      );
      if (nonZero.length === 0) {
        throw new Error('No cards dealt yet.');
      }

      const contractAddress = cloakBetAddress;
      const handleContractPairs = nonZero.map((handle) => ({ handle, contractAddress }));

      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [contractAddress];
      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

      const signer = await signerPromise;
      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message,
      );

      const result = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays,
      );

      const decrypted = handles
        .map((h, idx) => {
          if (h === '0x0000000000000000000000000000000000000000000000000000000000000000') {
            return null;
          }
          const clear = result[h as string];
          const value = typeof clear === 'bigint' ? Number(clear) : Number(BigInt(clear));
          const formatted = formatCard(value);
          return { index: idx, ...formatted } satisfies DecryptedCard;
        })
        .filter((x): x is DecryptedCard => x !== null);

      setHand(decrypted);
    } catch (e) {
      console.error(e);
      setDecryptError(e instanceof Error ? e.message : 'Failed to decrypt.');
    } finally {
      setIsDecrypting(false);
    }
  }, [address, cloakBetAddress, instance, selectedGame, signerPromise, zamaError, zamaLoading]);

  const playSelectedCard = useCallback(async () => {
    if (!selectedGame) return;
    setBusy('Submitting play…');
    try {
      const contract = await writeContract();
      const tx = await contract.playCard(selectedGame.id, selectedIndex);
      await tx.wait();
      setRefreshNonce((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }, [selectedGame, selectedIndex, writeContract]);

  const decryptResult = useCallback(async () => {
    if (!selectedGame) return;
    if (!cloakBetAddress) {
      setDecryptError('Set a valid contract address first.');
      return;
    }
    if (!instance || zamaLoading || zamaError) {
      setDecryptError(zamaError ?? 'Encryption service not ready.');
      return;
    }
    setBusy('Decrypting result…');
    try {
      const handle = (await publicClient.readContract({
        address: cloakBetAddress,
        abi: CLOAKBET_ABI,
        functionName: 'getResult',
        args: [selectedGame.id],
      })) as `0x${string}`;

      if (handle === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        throw new Error('Result not available yet.');
      }

      const values = await instance.publicDecrypt([handle]);
      const clear = values.clearValues[handle];
      if (typeof clear !== 'boolean') throw new Error('Unexpected result type.');
      setResult(clear);
    } catch (e) {
      console.error(e);
      setDecryptError(e instanceof Error ? e.message : 'Failed to decrypt result.');
    } finally {
      setBusy(null);
    }
  }, [cloakBetAddress, instance, selectedGame, zamaError, zamaLoading]);

  const userRole = useMemo(() => {
    if (!address || !selectedGame) return null;
    if (address.toLowerCase() === selectedGame.player0.toLowerCase()) return 'player0';
    if (address.toLowerCase() === selectedGame.player1.toLowerCase()) return 'player1';
    return 'spectator';
  }, [address, selectedGame]);

  return (
    <div className="app-shell">
      <Header />

      <main className="container">
        <section className="card">
          <h2 className="section-title">Lobby</h2>

          <div className="row">
            <label className="label">
              Contract
              <input
                className="input"
                placeholder="0x… (Sepolia CloakBet address)"
                value={contractAddressInput}
                onChange={(e) => setContractAddressInput(e.target.value.trim())}
              />
            </label>
            <button className="button primary" onClick={() => void createGame()} disabled={!!busy}>
              Create Game
            </button>
            <button className="button" onClick={() => setRefreshNonce((n) => n + 1)} disabled={!!busy}>
              Refresh
            </button>
            {busy && <span className="muted">{busy}</span>}
          </div>
          {!cloakBetAddress && <p className="error">Enter a valid contract address to use the app.</p>}

          <div className="open-list">
            {openGames.length === 0 ? (
              <p className="muted">No open games.</p>
            ) : (
              openGames.map((g) => (
                <div key={g.id.toString()} className="open-item">
                  <div className="open-meta">
                    <div className="open-title">Game #{g.id.toString()}</div>
                    <div className="muted">Creator: {shortAddress(g.player0)}</div>
                  </div>
                  <div className="open-actions">
                    <button className="button" disabled={!!busy} onClick={() => setSelectedGameId(g.id.toString())}>
                      View
                    </button>
                    <button className="button primary" disabled={!!busy} onClick={() => void joinGame(g.id)}>
                      Join
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">Game</h2>

          <div className="row">
            <label className="label">
              Game ID
              <input
                className="input"
                placeholder="e.g. 0"
                value={selectedGameId}
                onChange={(e) => setSelectedGameId(e.target.value.replace(/[^\d]/g, ''))}
              />
            </label>
            <button className="button" onClick={() => setRefreshNonce((n) => n + 1)} disabled={!!busy}>
              Load
            </button>
          </div>

          {!selectedGame ? (
            <p className="muted">Select a game id to see details.</p>
          ) : (
            <>
              <div className="game-grid">
                <div>
                  <div className="kv">
                    <span className="muted">player0</span>
                    <span>{shortAddress(selectedGame.player0)}</span>
                  </div>
                  <div className="kv">
                    <span className="muted">player1</span>
                    <span>{selectedGame.player1 === '0x0000000000000000000000000000000000000000' ? '—' : shortAddress(selectedGame.player1)}</span>
                  </div>
                </div>
                <div>
                  <div className="kv">
                    <span className="muted">started</span>
                    <span>{selectedGame.started ? 'yes' : 'no'}</span>
                  </div>
                  <div className="kv">
                    <span className="muted">finished</span>
                    <span>{selectedGame.finished ? 'yes' : 'no'}</span>
                  </div>
                </div>
                <div>
                  <div className="kv">
                    <span className="muted">you</span>
                    <span>{userRole ?? '—'}</span>
                  </div>
                  <div className="kv">
                    <span className="muted">dealt</span>
                    <span>{selectedGame.dealIndex}/6</span>
                  </div>
                </div>
              </div>

              <div className="row">
                <button
                  className="button primary"
                  onClick={() => void startAndDeal()}
                  disabled={!!busy || selectedGame.finished || userRole === 'spectator'}
                >
                  {selectedGame.started ? 'Deal Remaining' : 'Start + Deal'}
                </button>
                <button
                  className="button"
                  onClick={() => void decryptMyHand()}
                  disabled={!!busy || isDecrypting || !selectedGame.started || selectedGame.dealIndex < 6 || userRole === 'spectator'}
                >
                  {isDecrypting ? 'Decrypting…' : 'Decrypt My Hand'}
                </button>
                <button className="button" onClick={() => void decryptResult()} disabled={!!busy || !selectedGame.finished}>
                  Decrypt Result
                </button>
              </div>

              {decryptError && <p className="error">{decryptError}</p>}

              {hand && (
                <>
                  <h3 className="sub-title">Your Hand</h3>
                  <div className="hand-grid">
                    {hand.map((c) => (
                      <label key={c.index} className={`hand-card ${selectedIndex === c.index ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="card"
                          checked={selectedIndex === c.index}
                          onChange={() => setSelectedIndex(c.index)}
                        />
                        <span className="hand-label">{c.label}</span>
                        <span className="muted">index {c.index}</span>
                      </label>
                    ))}
                  </div>

                  <div className="row">
                    <button
                      className="button primary"
                      onClick={() => void playSelectedCard()}
                      disabled={!!busy || selectedGame.finished || userRole === 'spectator' || !selectedGame.started}
                    >
                      Play Selected Card
                    </button>
                    <span className="muted">Plays once per player.</span>
                  </div>
                </>
              )}

              {result !== null && (
                <div className="result-box">
                  <div className="result-title">Result</div>
                  <div>
                    {result ? 'player0 wins' : 'player1 wins'} ({result ? shortAddress(selectedGame.player0) : shortAddress(selectedGame.player1)})
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">Notes</h2>
          <ul className="notes">
            <li>Reads use viem public RPC.</li>
            <li>Writes use ethers with your wallet signer.</li>
            <li>Encrypted data decrypts via Zama Relayer SDK (SepoliaConfig).</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
