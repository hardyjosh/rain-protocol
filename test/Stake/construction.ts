import { assert } from "chai";
import { ethers } from "hardhat";
import { ReserveToken } from "../../typechain/ReserveToken";
import { InitializeEvent, StakeConfigStruct } from "../../typechain/Stake";
import { StakeFactory } from "../../typechain/StakeFactory";
import { zeroAddress } from "../../utils/constants/address";
import { ONE } from "../../utils/constants/bigNumber";
import { basicDeploy } from "../../utils/deploy/basic";
import { stakeDeploy } from "../../utils/deploy/stake";
import { getEventArgs } from "../../utils/events";
import { assertError } from "../../utils/test/assertError";
import { compareStructs } from "../../utils/test/compareStructs";

describe("Stake construction", async function () {
  let stakeFactory: StakeFactory;
  let token: ReserveToken;

  before(async () => {
    const stakeFactoryFactory = await ethers.getContractFactory(
      "StakeFactory",
      {}
    );
    stakeFactory = (await stakeFactoryFactory.deploy()) as StakeFactory;
    await stakeFactory.deployed();
  });

  beforeEach(async () => {
    token = (await basicDeploy("ReserveToken", {})) as ReserveToken;
  });

  it("should not initialize if requirements not met", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const deployer = signers[0];

    const stakeConfigStructZeroToken: StakeConfigStruct = {
      name: "Stake Token",
      symbol: "STKN",
      token: zeroAddress,
      initialRatio: ONE,
    };

    await assertError(
      async () =>
        await stakeDeploy(deployer, stakeFactory, stakeConfigStructZeroToken),
      "0_TOKEN",
      "wrongly initialised Stake with token configured as 0 address"
    );

    const stakeConfigStructZeroRatio: StakeConfigStruct = {
      name: "Stake Token",
      symbol: "STKN",
      token: token.address,
      initialRatio: 0,
    };

    await assertError(
      async () =>
        await stakeDeploy(deployer, stakeFactory, stakeConfigStructZeroRatio),
      "0_RATIO",
      "wrongly initialised Stake with initialRatio of 0"
    );
  });

  it("should initialize correctly on the good path", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const deployer = signers[0];

    const stakeConfigStruct: StakeConfigStruct = {
      name: "Stake Token",
      symbol: "STKN",
      token: token.address,
      initialRatio: ONE,
    };

    const stake = await stakeDeploy(deployer, stakeFactory, stakeConfigStruct);

    const { sender, config } = (await getEventArgs(
      stake.deployTransaction,
      "Initialize",
      stake
    )) as InitializeEvent["args"];

    assert(sender === stakeFactory.address, "wrong sender in Initialize event");

    compareStructs(config, stakeConfigStruct);
  });
});
