import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  if (!deployer) {
    throw new Error("Missing deployer account. Set PRIVATE_KEY in .env to deploy on Sepolia.");
  }

  const deployed = await deploy("CloakBet", {
    from: deployer,
    log: true,
  });

  console.log(`CloakBet contract: `, deployed.address);
};

export default func;
func.id = "deploy_cloakBet";
func.tags = ["CloakBet"];
