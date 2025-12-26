import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import fs from "node:fs";
import path from "node:path";

task("cloakbet:address", "Prints the CloakBet address").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;
  const deployed = await deployments.get("CloakBet");
  console.log("CloakBet address is " + deployed.address);
});

task("cloakbet:open", "Prints open game IDs").addOptionalParam("address", "Optionally specify the CloakBet contract address").setAction(
  async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const deployed = taskArguments.address ? { address: taskArguments.address } : await deployments.get("CloakBet");
    const contract = await ethers.getContractAt("CloakBet", deployed.address);
    const openIds = await contract.getOpenGameIds();
    console.log("Open games:", openIds.map((x: bigint) => x.toString()));
  },
);

task("cloakbet:create", "Creates a new game")
  .addOptionalParam("address", "Optionally specify the CloakBet contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const deployed = taskArguments.address ? { address: taskArguments.address } : await deployments.get("CloakBet");
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("CloakBet", deployed.address);
    const tx = await contract.connect(signer).createGame();
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("cloakbet:join", "Joins an open game")
  .addOptionalParam("address", "Optionally specify the CloakBet contract address")
  .addParam("game", "Game id")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const deployed = taskArguments.address ? { address: taskArguments.address } : await deployments.get("CloakBet");
    const [, signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("CloakBet", deployed.address);
    const gameId = BigInt(taskArguments.game);
    const tx = await contract.connect(signer).joinGame(gameId);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("cloakbet:start", "Starts a full game (deals encrypted hands)")
  .addOptionalParam("address", "Optionally specify the CloakBet contract address")
  .addParam("game", "Game id")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployed = taskArguments.address ? { address: taskArguments.address } : await deployments.get("CloakBet");
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("CloakBet", deployed.address);
    const gameId = BigInt(taskArguments.game);
    const tx = await contract.connect(signer).startGame(gameId);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("cloakbet:deal", "Deals one or more rounds (one card per player per round)")
  .addOptionalParam("address", "Optionally specify the CloakBet contract address")
  .addParam("game", "Game id")
  .addOptionalParam("rounds", "How many rounds to deal (default: remaining)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployed = taskArguments.address ? { address: taskArguments.address } : await deployments.get("CloakBet");
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("CloakBet", deployed.address);
    const gameId = BigInt(taskArguments.game);

    const info = await contract.getGameInfo(gameId);
    const dealt = BigInt(info[5]);
    const targetRounds = taskArguments.rounds ? BigInt(taskArguments.rounds) : 6n - dealt;
    const remaining = 6n - dealt;
    const rounds = targetRounds > remaining ? remaining : targetRounds;

    console.log(`Deal progress: ${dealt.toString()}/6, dealing ${rounds.toString()} round(s)`);
    for (let i = 0n; i < rounds; i++) {
      const tx = await contract.connect(signer).dealRound(gameId);
      console.log(`Wait for tx:${tx.hash}...`);
      const receipt = await tx.wait();
      console.log(`tx:${tx.hash} status=${receipt?.status}`);
    }
  });

task("cloakbet:hand", "Decrypts a player's hand (6 cards)")
  .addOptionalParam("address", "Optionally specify the CloakBet contract address")
  .addParam("game", "Game id")
  .addParam("player", "Player index: 0 or 1")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployed = taskArguments.address ? { address: taskArguments.address } : await deployments.get("CloakBet");
    const signers = await ethers.getSigners();
    const playerIndex = parseInt(taskArguments.player);
    const signer = signers[playerIndex];
    if (!signer) throw new Error(`Invalid --player index`);

    const contract = await ethers.getContractAt("CloakBet", deployed.address);
    const gameId = BigInt(taskArguments.game);

    const info = await contract.getGameInfo(gameId);
    const playerAddress = playerIndex === 0 ? (info[0] as string) : (info[1] as string);
    console.log(`Game ${gameId.toString()} player${playerIndex}=${playerAddress}`);

    const hand = await contract.getHand(gameId, playerAddress);
    const clearCards: number[] = [];
    for (const h of hand) {
      if (h === ethers.ZeroHash) {
        clearCards.push(-1);
        continue;
      }
      const clear = await fhevm.userDecryptEuint(FhevmType.euint8, h, deployed.address, signer);
      clearCards.push(Number(clear));
    }
    console.log("Decrypted hand:", clearCards);
  });

task("cloakbet:play", "Plays a card by hand index (0-5)")
  .addOptionalParam("address", "Optionally specify the CloakBet contract address")
  .addParam("game", "Game id")
  .addParam("player", "Player index: 0 or 1")
  .addParam("index", "Hand index: 0-5")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const deployed = taskArguments.address ? { address: taskArguments.address } : await deployments.get("CloakBet");
    const signers = await ethers.getSigners();
    const playerIndex = parseInt(taskArguments.player);
    const signer = signers[playerIndex];
    if (!signer) throw new Error(`Invalid --player index`);
    const handIndex = parseInt(taskArguments.index);
    if (!Number.isInteger(handIndex)) throw new Error(`Invalid --index`);

    const contract = await ethers.getContractAt("CloakBet", deployed.address);
    const gameId = BigInt(taskArguments.game);
    const tx = await contract.connect(signer).playCard(gameId, handIndex);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("cloakbet:sync-frontend", "Writes the deployed CloakBet address + ABI into the frontend config")
  .addOptionalParam("out", "Output path (default: frontend/src/config/contracts.ts)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const deployed = await hre.deployments.get("CloakBet");
    const outFile =
      typeof taskArguments.out === "string" && taskArguments.out.trim() !== ""
        ? taskArguments.out
        : path.join(hre.config.paths.root, "frontend", "src", "config", "contracts.ts");

    const contents = `export const CLOAKBET_ADDRESS = '${deployed.address}';

export const CLOAKBET_ABI = ${JSON.stringify(deployed.abi, null, 2)} as const;
`;

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, contents, "utf8");
    console.log(`Wrote ${outFile}`);
  });
