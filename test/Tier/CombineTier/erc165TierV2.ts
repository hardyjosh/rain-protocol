import { assert } from "chai";
import { concat } from "ethers/lib/utils";
import { ethers } from "hardhat";
import type { CloneFactory, CombineTier } from "../../../typechain";
import { ReserveToken } from "../../../typechain";
import { NewCloneEvent } from "../../../typechain/contracts/factory/CloneFactory";
import { InterpreterCallerV1ConstructionConfigStruct } from "../../../typechain/contracts/flow/FlowCommon";
import {
  Stake,
  StakeConfigStruct,
} from "../../../typechain/contracts/stake/Stake";
import {
  CombineTierConfigStruct,
  InitializeEvent,
} from "../../../typechain/contracts/tier/CombineTier";
import {
  assertError,
  basicDeploy,
  combineTierCloneDeploy,
  combineTierImplementation,
  compareStructs,
  getEventArgs,
  getRainContractMetaBytes,
  max_uint256,
  stakeCloneDeploy,
  stakeImplementation,
  zeroAddress,
} from "../../../utils";
import { getTouchDeployer } from "../../../utils/deploy/interpreter/shared/rainterpreterExpressionDeployer/deploy";
import deploy1820 from "../../../utils/deploy/registry1820/deploy";

import {
  generateEvaluableConfig,
  memoryOperand,
  MemoryType,
  op,
} from "../../../utils/interpreter/interpreter";
import { AllStandardOps } from "../../../utils/interpreter/ops/allStandardOps";
import { ALWAYS } from "../../../utils/tier";
const Opcode = AllStandardOps;

describe("CombineTier ERC165 tests", async function () {
  let implementationStake: Stake;
  let cloneFactory: CloneFactory;
  let implementationCombineTier: CombineTier;

  before(async () => {
    // Deploy ERC1820Registry
    const signers = await ethers.getSigners();
    await deploy1820(signers[0]);
  });

  before(async () => {
    implementationStake = await stakeImplementation();
    implementationCombineTier = await combineTierImplementation();

    //Deploy Clone Factory
    cloneFactory = (await basicDeploy("CloneFactory", {})) as CloneFactory;
  });

  // report time for tier context
  const ctxAccount = op(Opcode.context, 0x0000);

  // prettier-ignore
  // return default report
  const sourceReportTimeForTierDefault = concat([
      op(Opcode.context, 0x0001),
      ctxAccount,
    op(Opcode.itier_v2_report),
  ]);

  it("should pass ERC165 check by passing a CombineTier contract inheriting TierV2", async () => {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const evaluableConfig0 = await generateEvaluableConfig(
      [
        op(Opcode.read_memory, memoryOperand(MemoryType.Constant, 0)),
        sourceReportTimeForTierDefault,
      ],
      [ALWAYS]
    );
    const combineTierContract = await combineTierCloneDeploy(
      deployer,
      cloneFactory,
      implementationCombineTier,
      0,
      evaluableConfig0
    );

    const constants = [ethers.BigNumber.from(combineTierContract.address)];

    // prettier-ignore
    const sourceReport = concat([
        op(Opcode.read_memory, memoryOperand(MemoryType.Constant,0)),
        op(Opcode.context, 0x0000),
      op(Opcode.itier_v2_report, 0),
    ]);

    const combineTierSourceConfig = {
      sources: [sourceReport, sourceReportTimeForTierDefault],
      constants,
    };
    const evaluableConfig1 = await generateEvaluableConfig(
      combineTierSourceConfig.sources,
      combineTierSourceConfig.constants
    );

    const combineTier = await combineTierCloneDeploy(
      deployer,
      cloneFactory,
      implementationCombineTier,
      1,
      evaluableConfig1
    );

    const { sender, config } = (await getEventArgs(
      combineTier.deployTransaction,
      "Initialize",
      combineTier
    )) as InitializeEvent["args"];

    assert(
      sender === cloneFactory.address,
      `wrong signer got ${sender} expected ${cloneFactory.address}`
    );
    compareStructs(config, combineTierSourceConfig);
  });

  it("should pass ERC165 check by passing a Stake contract inheriting TierV2", async () => {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const token = (await basicDeploy("ReserveToken", {})) as ReserveToken;

    const evaluableConfig0 = await generateEvaluableConfig(
      [
        op(Opcode.read_memory, memoryOperand(MemoryType.Constant, 0)),
        op(Opcode.read_memory, memoryOperand(MemoryType.Constant, 0)),
      ],
      [max_uint256]
    );

    const stakeConfigStruct: StakeConfigStruct = {
      name: "Stake Token",
      symbol: "STKN",
      asset: token.address,
      evaluableConfig: evaluableConfig0,
    };

    const stake = await stakeCloneDeploy(
      deployer,
      cloneFactory,
      implementationStake,
      stakeConfigStruct
    );

    const constants = [ethers.BigNumber.from(stake.address)];

    // prettier-ignore
    const sourceReport = concat([
        op(Opcode.read_memory, memoryOperand(MemoryType.Constant,0)),
        op(Opcode.context, 0x0000),
      op(Opcode.itier_v2_report, 0),
    ]);

    const combineTierSourceConfig = {
      sources: [sourceReport, sourceReportTimeForTierDefault],
      constants,
    };

    const evaluableConfig1 = await generateEvaluableConfig(
      combineTierSourceConfig.sources,
      combineTierSourceConfig.constants
    );

    const combineTier = await combineTierCloneDeploy(
      deployer,
      cloneFactory,
      implementationCombineTier,
      1,
      evaluableConfig1
    );

    const { config } = (await getEventArgs(
      combineTier.deployTransaction,
      "Initialize",
      combineTier
    )) as InitializeEvent["args"];

    assert(
      (await combineTier.signer.getAddress()) === signers[0].address,
      "wrong signer"
    );
    compareStructs(config, combineTierSourceConfig);
  });

  it("should fail if combineTier is deployed with bad callerMeta", async function () {
    const combineTierFactory = await ethers.getContractFactory("CombineTier");
    const touchDeployer = await getTouchDeployer();
    const config0: InterpreterCallerV1ConstructionConfigStruct = {
      callerMeta: getRainContractMetaBytes("combinetier"),
      deployer: touchDeployer.address,
    };

    const combineTier = (await combineTierFactory.deploy(
      config0
    )) as CombineTier;
    await combineTier.deployed();

    assert(
      !(combineTier.address === zeroAddress),
      "combineTier did not deploy"
    );

    const config1: InterpreterCallerV1ConstructionConfigStruct = {
      callerMeta: getRainContractMetaBytes("orderbook"),
      deployer: touchDeployer.address,
    };

    await assertError(
      async () => await combineTierFactory.deploy(config1),
      "UnexpectedMetaHash",
      "Stake Deployed for bad hash"
    );
  });
});
