import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { assert } from "chai";
import { artifacts, ethers } from "hardhat";
import {
  CloneFactory,
  RainterpreterExpressionDeployer,
  Stake,
} from "../../../typechain";
import { NewCloneEvent } from "../../../typechain/contracts/factory/CloneFactory";
import { InterpreterCallerV1ConstructionConfigStruct } from "../../../typechain/contracts/flow/FlowCommon";
import { StakeConfigStruct } from "../../../typechain/contracts/stake/Stake";
import { zeroAddress } from "../../constants";
import { getEventArgs } from "../../events";
import { getRainDocumentsFromContract } from "../../meta";
import { getTouchDeployer } from "../interpreter/shared/rainterpreterExpressionDeployer/deploy";

export const stakeImplementation = async (): Promise<Stake> => {
  const stakeFactory = await ethers.getContractFactory("Stake", {});

  const touchDeployer: RainterpreterExpressionDeployer =
    await getTouchDeployer();
  const interpreterCallerConfig: InterpreterCallerV1ConstructionConfigStruct = {
    meta: getRainDocumentsFromContract("stake"),
    deployer: touchDeployer.address,
  };

  const stake = (await stakeFactory.deploy(interpreterCallerConfig)) as Stake;

  assert(!(stake.address === zeroAddress), "implementation stake zero address");

  return stake;
};

export const stakeCloneDeploy = async (
  deployer: SignerWithAddress,
  cloneFactory: CloneFactory,
  stakeImplementation: Stake,
  initialConfig: StakeConfigStruct
): Promise<Stake> => {
  const encodedConfig = ethers.utils.defaultAbiCoder.encode(
    [
      "tuple(address asset ,string name, string symbol , tuple(address deployer,bytes[] sources,uint256[] constants) evaluableConfig)",
    ],
    [initialConfig]
  );

  const stakeClone = await cloneFactory.clone(
    stakeImplementation.address,
    encodedConfig
  );

  const cloneEvent = (await getEventArgs(
    stakeClone,
    "NewClone",
    cloneFactory
  )) as NewCloneEvent["args"];

  const stake = new ethers.Contract(
    ethers.utils.hexZeroPad(
      ethers.utils.hexStripZeros(
        (await getEventArgs(stakeClone, "NewClone", cloneFactory)).clone
      ),
      20 // address bytes length
    ),
    (await artifacts.readArtifact("Stake")).abi,
    deployer
  ) as Stake;

  await stake.deployed();

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  stake.deployTransaction = stakeClone;

  assert(!(cloneEvent.clone === zeroAddress), "stake clone zero address");

  return stake;
};
