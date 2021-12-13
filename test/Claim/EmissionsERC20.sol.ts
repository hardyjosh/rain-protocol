import * as Util from "../Util";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import * as claimUtil from "./ClaimUtil";
import { concat, hexlify } from "ethers/lib/utils";
import {
  chunkedSource,
  eighteenZeros,
  op,
  paddedBlock,
  paddedReport,
  arg,
} from "../Util";
import type { ReadWriteTier } from "../../typechain/ReadWriteTier";
import { BigNumber, Contract } from "ethers";

chai.use(solidity);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { expect, assert } = chai;

const enum Opcode {
  noop,
  val,
  zipmap,
  blockNumber,
  thisAddress,
  add,
  sub,
  mul,
  pow,
  div,
  mod,
  min,
  max,
  average,
  report,
  never,
  always,
  diff,
  updateBlocksForTierRange,
  everyLteMin,
  everyLteMax,
  everyLteFirst,
  anyLteMin,
  anyLteMax,
  anyLteFirst,
  account,
  constructionBlockNumber,
}

enum Tier {
  ZERO,
  ONE, // bronze
  TWO, // silver
  THREE, // gold
  FOUR, // platinum
  FIVE,
  SIX,
  SEVEN,
  EIGHT,
}

describe("EmissionsERC20", async function () {
  it("should calculate correct emissions amount", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const readWriteTierFactory = await ethers.getContractFactory(
      "ReadWriteTier"
    );
    const readWriteTier =
      (await readWriteTierFactory.deploy()) as ReadWriteTier & Contract;
    await readWriteTier.deployed();

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const BONE = ethers.BigNumber.from("1" + eighteenZeros);

    // 2 seconds per block
    const BLOCKS_PER_YEAR = 365;

    const BLOCKS_PER_MONTH = Math.floor(BLOCKS_PER_YEAR / 12);

    const MONTHLY_REWARD_BRNZ = 100;
    const MONTHLY_REWARD_SILV = 200 - MONTHLY_REWARD_BRNZ;
    const MONTHLY_REWARD_GOLD =
      500 - (MONTHLY_REWARD_SILV + MONTHLY_REWARD_BRNZ);
    const MONTHLY_REWARD_PLAT =
      1000 - (MONTHLY_REWARD_GOLD + MONTHLY_REWARD_SILV + MONTHLY_REWARD_BRNZ);

    const REWARD_PER_BLOCK_BRNZ = Math.floor(
      MONTHLY_REWARD_BRNZ / BLOCKS_PER_MONTH
    );
    const REWARD_PER_BLOCK_SILV = Math.floor(
      MONTHLY_REWARD_SILV / BLOCKS_PER_MONTH
    );
    const REWARD_PER_BLOCK_GOLD = Math.floor(
      MONTHLY_REWARD_GOLD / BLOCKS_PER_MONTH
    );
    const REWARD_PER_BLOCK_PLAT = Math.floor(
      MONTHLY_REWARD_PLAT / BLOCKS_PER_MONTH
    );

    const BASE_REWARD_PER_TIER = paddedReport(
      ethers.BigNumber.from(
        "0x" +
          paddedBlock(0).repeat(4) +
          paddedBlock(REWARD_PER_BLOCK_PLAT) +
          paddedBlock(REWARD_PER_BLOCK_GOLD) +
          paddedBlock(REWARD_PER_BLOCK_SILV) +
          paddedBlock(REWARD_PER_BLOCK_BRNZ)
      )
    );

    // BEGIN global constants

    // FN uses constants 0-3
    const valTierAddress = op(Opcode.val, 4);
    console.log("valTierAddress", valTierAddress);
    const valBaseRewardPerTier = op(Opcode.val, 5);
    const valBlocksPerYear = op(Opcode.val, 6);
    const valBOne = op(Opcode.val, 7);

    // END global constants

    // BEGIN zipmap args

    const valDuration = op(Opcode.val, arg(0));
    const valBaseReward = op(Opcode.val, arg(1));

    // END zipmap args

    // BEGIN Source snippets

    // prettier-ignore
    const REWARD = () =>
      concat([
        op(Opcode.mul, 2),
          valBaseReward,
          valDuration,
      ]);

    // prettier-ignore
    const PROGRESS = () =>
      concat([
        op(Opcode.min, 2),
          op(Opcode.div, 2),
            op(Opcode.mul, 2),
              valBOne,
              valDuration,
            valBlocksPerYear,
          valBOne,
      ]);

    // prettier-ignore
    const MULTIPLIER = () =>
      concat([
        op(Opcode.add, 2),
          valBOne,
          PROGRESS(),
      ]);

    // prettier-ignore
    const FN = () =>
      concat([
        op(Opcode.mul, 2),
          MULTIPLIER(),
          REWARD(),
      ]);

    // prettier-ignore
    const CURRENT_BLOCK_AS_REPORT = () =>
      concat([
        op(
          Opcode.updateBlocksForTierRange,
          claimUtil.tierRange(Tier.ZERO, Tier.EIGHT)
        ),
          op(Opcode.never),
          op(Opcode.blockNumber),
      ]);
    // prettier-ignore
    const LAST_CLAIM_REPORT = () =>
      concat([
        op(Opcode.report),
          op(Opcode.thisAddress),
          op(Opcode.account),
      ]);
    // prettier-ignore
    const TIER_REPORT = () =>
      concat([
        op(Opcode.report),
          valTierAddress,
          op(Opcode.account),
      ]);
    // prettier-ignore
    const TIERWISE_DIFF = () =>
      concat([
        op(Opcode.diff),
          CURRENT_BLOCK_AS_REPORT(),
          op(Opcode.anyLteMax, 2),
            LAST_CLAIM_REPORT(),
            TIER_REPORT(),
          op(Opcode.blockNumber),
      ]);

    console.log("tierwise diff", TIERWISE_DIFF());

    // prettier-ignore
    const SOURCE = () =>
      concat([
        op(Opcode.add, 8),
          op(Opcode.zipmap, Util.callSize(0, 3, 1)),
            op(Opcode.val, 0), // fn start index
            valBaseRewardPerTier, // val1
            TIERWISE_DIFF(), // val0
      ]);

    const constants = [
      ...chunkedSource(concat([FN()])),
      readWriteTier.address,
      BASE_REWARD_PER_TIER,
      BLOCKS_PER_YEAR, // e.g. '365' blocks = 1 year
      BONE,
    ];

    // END Source snippets

    console.log("source", SOURCE());

    console.log("chunked", chunkedSource(concat([SOURCE()])));
    console.log("constants", constants);

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: chunkedSource(concat([SOURCE()])),
          constants,
          arguments: [],
        },
      }
    );

    // Has Platinum Tier
    await readWriteTier.setTier(claimer.address, Tier.FOUR, []);

    console.log(
      "claimer tier report",
      await readWriteTier.report(claimer.address)
    );

    const tierBlock = await ethers.provider.getBlockNumber();

    console.log("block before", tierBlock);
    await Util.createEmptyBlock(BLOCKS_PER_YEAR / 2); // ~50% claim progress
    const claimBlock = await ethers.provider.getBlockNumber();
    console.log("block after", claimBlock);

    // 183
    const claimDuration = claimBlock - tierBlock;

    // 183000000000000000000
    const claimDurationBN = BigNumber.from(claimDuration + eighteenZeros);

    // 501369863013698630
    const fractionalClaimDurationBN = claimDurationBN.div(BLOCKS_PER_YEAR);

    // account for saturation, no extra bonus beyond 1 year
    // 501369863013698630
    const fractionalClaimDurationRemoveExcessBN = fractionalClaimDurationBN.lt(
      BONE
    )
      ? fractionalClaimDurationBN
      : BONE;

    // 1501369863013698630
    const fractionalClaimDurationRemoveExcessAddOneBN =
      fractionalClaimDurationRemoveExcessBN.add(BONE);

    // 183 * 3 = 549
    const baseRewardByDurationBronze = claimDuration * REWARD_PER_BLOCK_BRNZ;

    // 183 * 3 = 549
    const baseRewardByDurationSilver = claimDuration * REWARD_PER_BLOCK_SILV;

    // 183 * 10 = 1830
    const baseRewardByDurationGold = claimDuration * REWARD_PER_BLOCK_GOLD;

    // 183 * 16 = 2928
    const baseRewardByDurationPlatinum = claimDuration * REWARD_PER_BLOCK_PLAT;

    const sumBaseRewardByDuration =
      baseRewardByDurationPlatinum +
      baseRewardByDurationGold +
      baseRewardByDurationSilver +
      baseRewardByDurationBronze;

    const expectedClaimAmount = fractionalClaimDurationRemoveExcessAddOneBN.mul(
      sumBaseRewardByDuration
    );

    const claimAmount = await emissionsERC20.calculateClaim(claimer.address);

    console.log(claimAmount);

    console.log(`expectations:
    claimDuration                 ${claimDuration}
    claimDurationBN               ${claimDurationBN}
    fractionalClaimDurationBN     ${fractionalClaimDurationBN}
    baseRewardByDurationBronze    ${baseRewardByDurationBronze}
    baseRewardByDurationSilver    ${baseRewardByDurationSilver}
    baseRewardByDurationGold      ${baseRewardByDurationGold}
    baseRewardByDurationPlatinum  ${baseRewardByDurationPlatinum}
    sumBaseRewardByDuration       ${sumBaseRewardByDuration}
    expectedClaimAmount           ${expectedClaimAmount}
    `);

    assert(
      claimAmount.eq(expectedClaimAmount),
      `wrong claim calculation result
      expected  ${expectedClaimAmount}
      got       ${claimAmount}`
    );
  });

  xit("should correctly mint ERC20 tokens upon a successive claim", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const readWriteTierFactory = await ethers.getContractFactory(
      "ReadWriteTier"
    );
    const readWriteTier =
      (await readWriteTierFactory.deploy()) as ReadWriteTier & Contract;
    await readWriteTier.deployed();

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [
            // prettier-ignore
            concat([
              op(Opcode.diff),

                op(
                  Opcode.updateBlocksForTierRange,
                  claimUtil.tierRange(Tier.ZERO, Tier.EIGHT)
                ),
                  op(Opcode.never),
                  op(Opcode.blockNumber),

                op(Opcode.everyLteMax, 2),

                  // lastClaimReport
                  op(Opcode.report),
                    op(Opcode.thisAddress),
                    op(Opcode.account),

                  // tierReport
                  op(Opcode.report),
                    op(Opcode.val, 0),
                    op(Opcode.account),

                op(Opcode.blockNumber),
            ]),
            0,
            0,
            0,
          ],
          constants: [
            readWriteTier.address,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ],
          arguments: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      }
    );

    await readWriteTier.setTier(claimer.address, Tier.ONE, []);
    await readWriteTier.setTier(claimer.address, Tier.TWO, []);
    await readWriteTier.setTier(claimer.address, Tier.THREE, []);
    await readWriteTier.setTier(claimer.address, Tier.FOUR, []);

    await Util.createEmptyBlock(5);

    // first claim
    await emissionsERC20
      .connect(claimer)
      .claim(
        claimer.address,
        hexlify([...Buffer.from("Custom claim message")])
      );

    const expectedClaimAmount1 = paddedReport(
      ethers.BigNumber.from(
        "0x" +
          paddedBlock(0).repeat(4) +
          paddedBlock(6) +
          paddedBlock(7) +
          paddedBlock(8) +
          paddedBlock(9)
      )
    );
    const totalSupply1 = paddedReport(await emissionsERC20.totalSupply());
    const claimerBalance1 = paddedReport(
      await emissionsERC20.balanceOf(claimer.address)
    );

    assert(
      totalSupply1 === expectedClaimAmount1,
      `wrong total minted supply
      expected  ${expectedClaimAmount1}
      got       ${totalSupply1}`
    );
    assert(
      claimerBalance1 === expectedClaimAmount1,
      `wrong claimer balance
      expected  ${expectedClaimAmount1}
      got       ${claimerBalance1}`
    );

    await Util.createEmptyBlock(5);

    // second claim
    await emissionsERC20
      .connect(claimer)
      .claim(
        claimer.address,
        hexlify([...Buffer.from("Custom claim message")])
      );

    const expectedClaimAmount2 = paddedReport(
      ethers.BigNumber.from(
        "0x" +
          paddedBlock(0).repeat(4) +
          paddedBlock(6 + 6) +
          paddedBlock(7 + 6) +
          paddedBlock(8 + 6) +
          paddedBlock(9 + 6)
      )
    );
    const totalSupply2 = paddedReport(await emissionsERC20.totalSupply());
    const claimerBalance2 = paddedReport(
      await emissionsERC20.balanceOf(claimer.address)
    );

    assert(
      totalSupply2 === expectedClaimAmount2,
      `wrong total minted supply
        expected  ${expectedClaimAmount2}
        got       ${totalSupply2}`
    );
    assert(
      claimerBalance2 === expectedClaimAmount2,
      `wrong claimer balance
        expected  ${expectedClaimAmount2}
        got       ${claimerBalance2}`
    );
  });

  it("should return default claim report for an account before claiming", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [
            concat([
              // lastClaimReport
              op(Opcode.report),
              op(Opcode.thisAddress),
              op(Opcode.account),
            ]),
            0,
            0,
            0,
          ],
          constants: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          arguments: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      }
    );

    const beforeClaimReport = await emissionsERC20.calculateClaim(
      claimer.address
    );

    assert(
      beforeClaimReport.isZero(),
      `wrong emissions report before claim
      expected  0x00
      got       ${hexlify(beforeClaimReport)}`
    );
  });

  xit("should correctly calculate claim amount after a claim", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const readWriteTierFactory = await ethers.getContractFactory(
      "ReadWriteTier"
    );
    const readWriteTier =
      (await readWriteTierFactory.deploy()) as ReadWriteTier & Contract;
    await readWriteTier.deployed();

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [
            concat([
              op(Opcode.diff),

              op(
                Opcode.updateBlocksForTierRange,
                claimUtil.tierRange(Tier.ZERO, Tier.EIGHT)
              ),
              op(Opcode.never),
              op(Opcode.blockNumber),

              op(Opcode.everyLteMax, 2),

              // lastClaimReport
              op(Opcode.report),
              op(Opcode.thisAddress),
              op(Opcode.account),

              // tierReport
              op(Opcode.report),
              op(Opcode.val, 0),
              op(Opcode.account),

              op(Opcode.blockNumber),
            ]),
            0,
            0,
            0,
          ],
          constants: [
            readWriteTier.address,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ],
          arguments: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      }
    );

    await readWriteTier.setTier(claimer.address, Tier.ONE, []);
    await readWriteTier.setTier(claimer.address, Tier.TWO, []);
    await readWriteTier.setTier(claimer.address, Tier.THREE, []);
    await readWriteTier.setTier(claimer.address, Tier.FOUR, []);

    await Util.createEmptyBlock(5);

    await emissionsERC20
      .connect(claimer)
      .claim(
        claimer.address,
        hexlify([...Buffer.from("Custom claim message")])
      );

    const successiveClaimCalc0 = paddedReport(
      await emissionsERC20.calculateClaim(claimer.address)
    );
    const expectedClaimCalc0 = paddedReport(
      ethers.BigNumber.from("0x" + paddedBlock(0).repeat(8))
    );

    assert(
      successiveClaimCalc0 === expectedClaimCalc0,
      `wrong successive claim calculation0
      expected  ${expectedClaimCalc0}
      got       ${successiveClaimCalc0}`
    );

    await Util.createEmptyBlock(5);

    const successiveClaimCalc1 = paddedReport(
      await emissionsERC20.calculateClaim(claimer.address)
    );
    const expectedClaimCalc1 = paddedReport(
      ethers.BigNumber.from(
        "0x" + paddedBlock(0).repeat(4) + paddedBlock(5).repeat(4)
      )
    );

    assert(
      successiveClaimCalc1 === expectedClaimCalc1,
      `wrong successive claim calculation1
        expected  ${expectedClaimCalc1}
        got       ${successiveClaimCalc1}`
    );
  });

  xit("should correctly mint ERC20 tokens upon a claim", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const readWriteTierFactory = await ethers.getContractFactory(
      "ReadWriteTier"
    );
    const readWriteTier =
      (await readWriteTierFactory.deploy()) as ReadWriteTier & Contract;
    await readWriteTier.deployed();

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [
            concat([
              op(Opcode.diff),

              op(
                Opcode.updateBlocksForTierRange,
                claimUtil.tierRange(Tier.ZERO, Tier.EIGHT)
              ),
              op(Opcode.never),
              op(Opcode.blockNumber),

              op(Opcode.everyLteMax, 2),

              // lastClaimReport
              op(Opcode.report),
              op(Opcode.thisAddress),
              op(Opcode.account),

              // tierReport
              op(Opcode.report),
              op(Opcode.val, 0),
              op(Opcode.account),

              op(Opcode.blockNumber),
            ]),
            0,
            0,
            0,
          ],
          constants: [
            readWriteTier.address,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ],
          arguments: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      }
    );

    await readWriteTier.setTier(claimer.address, Tier.ONE, []);
    await readWriteTier.setTier(claimer.address, Tier.TWO, []);
    await readWriteTier.setTier(claimer.address, Tier.THREE, []);
    await readWriteTier.setTier(claimer.address, Tier.FOUR, []);

    await Util.createEmptyBlock(5);

    assert(
      (await emissionsERC20.totalSupply()).isZero(),
      "total supply not zero"
    );

    await emissionsERC20
      .connect(claimer)
      .claim(
        claimer.address,
        hexlify([...Buffer.from("Custom claim message")])
      );

    const expectedClaimAmount = paddedReport(
      ethers.BigNumber.from(
        "0x" +
          paddedBlock(0).repeat(4) +
          paddedBlock(6) +
          paddedBlock(7) +
          paddedBlock(8) +
          paddedBlock(9)
      )
    );
    const totalSupply1 = paddedReport(await emissionsERC20.totalSupply());
    const claimerBalance1 = paddedReport(
      await emissionsERC20.balanceOf(claimer.address)
    );

    assert(
      totalSupply1 === expectedClaimAmount,
      `wrong total minted supply
      expected  ${expectedClaimAmount}
      got       ${totalSupply1}`
    );
    assert(
      claimerBalance1 === expectedClaimAmount,
      `wrong claimer balance
      expected  ${expectedClaimAmount}
      got       ${claimerBalance1}`
    );
  });

  it("should calculate claim report as difference between current block number and everyLteMax([tierReport, lastClaimReport]) for each tier", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const readWriteTierFactory = await ethers.getContractFactory(
      "ReadWriteTier"
    );
    const readWriteTier =
      (await readWriteTierFactory.deploy()) as ReadWriteTier & Contract;
    await readWriteTier.deployed();

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [
            concat([
              op(Opcode.diff),

              op(
                Opcode.updateBlocksForTierRange,
                claimUtil.tierRange(Tier.ZERO, Tier.EIGHT)
              ),
              op(Opcode.never),
              op(Opcode.blockNumber),

              op(Opcode.everyLteMax, 2),

              // lastClaimReport
              op(Opcode.report),
              op(Opcode.thisAddress),
              op(Opcode.account),

              // tierReport
              op(Opcode.report),
              op(Opcode.val, 0),
              op(Opcode.account),

              op(Opcode.blockNumber),
            ]),
            0,
            0,
            0,
          ],
          constants: [
            readWriteTier.address,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ],
          arguments: [],
        },
      }
    );

    await readWriteTier.setTier(claimer.address, Tier.ONE, []);
    await readWriteTier.setTier(claimer.address, Tier.TWO, []);
    await readWriteTier.setTier(claimer.address, Tier.THREE, []);
    await readWriteTier.setTier(claimer.address, Tier.FOUR, []);

    await Util.createEmptyBlock(5);

    const claimReport = paddedReport(
      await emissionsERC20.calculateClaim(claimer.address)
    );
    const expectedClaimReport = paddedReport(
      ethers.BigNumber.from(
        "0x" +
          paddedBlock(0).repeat(4) +
          paddedBlock(5) +
          paddedBlock(6) +
          paddedBlock(7) +
          paddedBlock(8)
      )
    );

    assert(
      claimReport === expectedClaimReport,
      `wrong claim calculation result
      expected  ${expectedClaimReport}
      got       ${claimReport}`
    );
  });

  it("should diff reports correctly", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const readWriteTierFactory = await ethers.getContractFactory(
      "ReadWriteTier"
    );
    const readWriteTier =
      (await readWriteTierFactory.deploy()) as ReadWriteTier & Contract;
    await readWriteTier.deployed();

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [
            concat([
              op(Opcode.diff),
              op(
                Opcode.updateBlocksForTierRange,
                claimUtil.tierRange(Tier.ZERO, Tier.EIGHT)
              ),
              op(Opcode.never),
              op(Opcode.blockNumber),

              op(Opcode.report),
              op(Opcode.val, 0),
              op(Opcode.account),
            ]),
            0,
            0,
            0,
          ],
          constants: [
            readWriteTier.address,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ],
          arguments: [],
        },
      }
    );

    const setTierBlock = (await ethers.provider.getBlockNumber()) + 1;
    await readWriteTier.setTier(claimer.address, Tier.EIGHT, []);

    await Util.createEmptyBlock(5);

    const calculationBlock = await ethers.provider.getBlockNumber();
    const diffResult = await emissionsERC20.calculateClaim(claimer.address);

    const expectedDiff = paddedReport(
      ethers.BigNumber.from(
        "0x" + paddedBlock(calculationBlock - setTierBlock).repeat(8)
      )
    );

    assert(
      diffResult.eq(expectedDiff),
      `wrong diff result
      expected  ${hexlify(expectedDiff)}
      got       ${hexlify(diffResult)}`
    );
  });

  it("should record the latest claim block as a tier report", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const claimAmount = 123;

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [concat([op(Opcode.val)])],
          constants: [claimAmount],
          arguments: [],
        },
      }
    );

    const claimBlockNumber = (await ethers.provider.getBlockNumber()) + 1;

    await emissionsERC20
      .connect(claimer)
      .claim(
        claimer.address,
        hexlify([...Buffer.from("Custom claim message")])
      );

    const expectedReport = paddedReport(
      ethers.BigNumber.from("0x" + paddedBlock(claimBlockNumber).repeat(8))
    );

    const actualReport = paddedReport(
      await emissionsERC20.reports(claimer.address)
    );

    assert(
      actualReport === expectedReport,
      `wrong emissions claim report
      expected  ${expectedReport}
      actual    ${actualReport}`
    );
  });

  it("should allow delegated claims when flag set to true", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];
    const delegate = signers[2];

    const claimAmount = 123;

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: true,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [concat([op(Opcode.val)])],
          constants: [claimAmount],
          arguments: [],
        },
      }
    );

    await emissionsERC20
      .connect(delegate)
      .claim(
        claimer.address,
        hexlify([...Buffer.from("Custom claim message")])
      );
  });

  it("should prevent delegated claims when flag set to false", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];
    const delegate = signers[2];

    const claimAmount = 123;

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [concat([op(Opcode.val)])],
          constants: [claimAmount],
          arguments: [],
        },
      }
    );

    assert(!(await emissionsERC20.allowDelegatedClaims()));

    await Util.assertError(
      async () =>
        await emissionsERC20
          .connect(delegate)
          .claim(
            claimer.address,
            hexlify([...Buffer.from("Custom claim message")])
          ),
      "DELEGATED_CLAIM",
      "did not prevent delegated claim when flag was set to false"
    );
  });

  it("should perform claim using a constant val as claim amount", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const claimAmount = 123;

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: false,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [concat([op(Opcode.val)])],
          constants: [claimAmount],
          arguments: [],
        },
      }
    );

    await emissionsERC20
      .connect(claimer)
      .claim(
        claimer.address,
        hexlify([...Buffer.from("Custom claim message")])
      );
  });

  it("should calculate claim amount from constant val", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];
    const claimer = signers[1];

    const claimAmount = 123;

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: true,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [concat([op(Opcode.val)])],
          constants: [claimAmount],
          arguments: [],
        },
      }
    );

    const claimAmountResult = await emissionsERC20.calculateClaim(
      claimer.address
    );

    assert(
      claimAmountResult.eq(claimAmount),
      `wrong claim amount from constant val
      expected  ${claimAmount}
      got       ${claimAmountResult}`
    );
  });

  it("should hold important correct values on construction", async function () {
    this.timeout(0);

    const signers = await ethers.getSigners();
    const creator = signers[0];

    const { emissionsERC20Factory } = await claimUtil.claimFactoriesDeploy();

    const constructionBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;

    const emissionsERC20 = await claimUtil.emissionsDeploy(
      creator,
      emissionsERC20Factory,
      {
        allowDelegatedClaims: true,
        erc20Config: {
          name: "Emissions",
          symbol: "EMS",
        },
        source: {
          source: [concat([op(Opcode.val)])],
          constants: [],
          arguments: [],
        },
      }
    );

    assert(await emissionsERC20.allowDelegatedClaims());
    assert(
      (await emissionsERC20.constructionBlockNumber()) ===
        constructionBlockNumber,
      `wrong construction block number
      expected  ${constructionBlockNumber}
      got       ${await emissionsERC20.constructionBlockNumber()}`
    );
  });
});
