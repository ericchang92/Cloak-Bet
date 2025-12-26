import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { CloakBet, CloakBet__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("CloakBet")) as unknown as CloakBet__factory;
  const contract = (await factory.deploy()) as unknown as CloakBet;
  const address = await contract.getAddress();
  return { contract, address };
}

function computeWinner(card0: number, card1: number) {
  const r0 = card0 % 13;
  const r1 = card1 % 13;
  const s0 = Math.floor(card0 / 13);
  const s1 = Math.floor(card1 / 13);
  if (r0 !== r1) return r0 > r1;
  return s0 > s1;
}

describe("CloakBet", function () {
  let signers: Signers;
  let contract: CloakBet;
  let contractAddress: string;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }
    ({ contract, address: contractAddress } = await deployFixture());
  });

  it("deals 12 unique cards and resolves a winner", async function () {
    const createTx = await contract.connect(signers.alice).createGame();
    await createTx.wait();

    const gameId = 0n;

    const joinTx = await contract.connect(signers.bob).joinGame(gameId);
    await joinTx.wait();

    const startTx = await contract.connect(signers.alice).startGame(gameId);
    await startTx.wait();

    for (let i = 0; i < 6; i++) {
      const dealTx = await contract.connect(signers.alice).dealRound(gameId);
      await dealTx.wait();
    }

    const info = await contract.getGameInfo(gameId);
    expect(info[0]).to.eq(signers.alice.address);
    expect(info[1]).to.eq(signers.bob.address);
    expect(info[2]).to.eq(true); // started
    expect(info[5]).to.eq(6n); // dealIndex

    const hand0 = await contract.getHand(gameId, signers.alice.address);
    const hand1 = await contract.getHand(gameId, signers.bob.address);

    const clear0: number[] = [];
    const clear1: number[] = [];
    for (const h of hand0) {
      const v = await fhevm.userDecryptEuint(FhevmType.euint8, h, contractAddress, signers.alice);
      clear0.push(Number(v));
    }
    for (const h of hand1) {
      const v = await fhevm.userDecryptEuint(FhevmType.euint8, h, contractAddress, signers.bob);
      clear1.push(Number(v));
    }

    const all = [...clear0, ...clear1];
    for (const c of all) {
      expect(c).to.be.gte(0);
      expect(c).to.be.lt(52);
    }
    expect(new Set(all).size).to.eq(all.length);

    const play0Tx = await contract.connect(signers.alice).playCard(gameId, 0);
    await play0Tx.wait();
    const play1Tx = await contract.connect(signers.bob).playCard(gameId, 0);
    await play1Tx.wait();

    const finishedInfo = await contract.getGameInfo(gameId);
    expect(finishedInfo[3]).to.eq(true); // finished

    const resultHandle = await contract.getResult(gameId);
    expect(resultHandle).to.not.eq(ethers.ZeroHash);

    const expected = computeWinner(clear0[0], clear1[0]);

    // Decrypt result (ebool) - supported by the hardhat plugin in mock mode.
    const clearResult = await fhevm.userDecryptEbool(resultHandle, contractAddress, signers.alice);
    expect(clearResult).to.eq(expected);
  });
});
