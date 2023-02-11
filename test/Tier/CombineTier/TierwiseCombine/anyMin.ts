import { assert } from "chai";
import { concat, hexlify } from "ethers/lib/utils";
import { ethers } from "hardhat";
import type { CombineTier } from "../../../../typechain";
import { zeroPad32, paddedUInt32 } from "../../../../utils/bytes";
import deploy1820 from "../../../../utils/deploy/registry1820/deploy";
import { combineTierDeploy } from "../../../../utils/deploy/tier/combineTier/deploy";
import { readWriteTierDeploy } from "../../../../utils/deploy/tier/readWriteTier/deploy";
import { getBlockTimestamp } from "../../../../utils/hardhat";
import {
  generateEvaluableConfig,
  memoryOperand,
  MemoryType,
  op,
  selectLte,
  SelectLteLogic,
  SelectLteMode,
} from "../../../../utils/interpreter/interpreter";
import { AllStandardOps } from "../../../../utils/interpreter/ops/allStandardOps";
import { ALWAYS, NEVER } from "../../../../utils/tier";
import { Tier } from "../../../../utils/types/tier";

const Opcode = AllStandardOps;

describe("CombineTier tierwise combine report with 'any' logic and 'min' mode", async function () {  

  before(async () => {
    // Deploy ERC1820Registry
    const signers = await ethers.getSigners();
    await deploy1820(signers[0])
   }) 

  // report time for tier context
  const ctxAccount = op(Opcode.context, 0x0000);

  // prettier-ignore
  // return default report
  const sourceReportTimeForTierDefault = concat([
      op(Opcode.context, 0x0001),
      ctxAccount,
    op(Opcode.itierV2Report),
  ]);

  it("should correctly combine Always and Never tier reports with any and min selector", async () => {
    const signers = await ethers.getSigners();

    const evaluableConfigAlways = await generateEvaluableConfig(
       [
        op(Opcode.readMemory, memoryOperand(MemoryType.Constant, 0)),
        sourceReportTimeForTierDefault,
      ],
       [ALWAYS],
    );
    const alwaysTier = (await combineTierDeploy(signers[0], {
      combinedTiersLength: 0,
      evaluableConfig: evaluableConfigAlways,
    })) as CombineTier;
    const evaluableConfigNever = await generateEvaluableConfig(
       [
        op(Opcode.readMemory, memoryOperand(MemoryType.Constant, 0)),
        sourceReportTimeForTierDefault,
      ],
       [NEVER],
    );
    const neverTier = (await combineTierDeploy(signers[0], {
      combinedTiersLength: 0,
      evaluableConfig: evaluableConfigNever,
    })) as CombineTier;

    const constants = [
      ethers.BigNumber.from(alwaysTier.address),
      ethers.BigNumber.from(neverTier.address),
    ];

    // prettier-ignore
    const sourceReport = concat([
        op(Opcode.blockTimestamp),
          op(Opcode.readMemory, memoryOperand(MemoryType.Constant, 0)),
          op(Opcode.context, 0x0000),
        op(Opcode.itierV2Report, 0),
          op(Opcode.readMemory, memoryOperand(MemoryType.Constant, 1)),
          op(Opcode.context, 0x0000),
        op(Opcode.itierV2Report, 0),
      op(
        Opcode.selectLte,
        selectLte(SelectLteLogic.any, SelectLteMode.min, 2)
      ),
    ]);

    const evaluableConfigCombine = await generateEvaluableConfig(
       [sourceReport, sourceReportTimeForTierDefault],
      constants,
    );
    const combineTier = (await combineTierDeploy(signers[0], {
      combinedTiersLength: 2,
      evaluableConfig: evaluableConfigCombine,
    })) as CombineTier;

    const result = await combineTier.report(signers[0].address, []);

    // for each tier, Always has blocks which are lte current block
    // therefore, OR_OLD succeeds

    const expected = 0x00; // success, oldest block timestamp for each tier
    assert(
      result.eq(expected),
      `wrong block timestamp preserved with tierwise any and min selector
      expected  ${hexlify(expected)}
      got       ${hexlify(result)}`
    );
  });

  it("should correctly combine ReadWriteTier tier contracts with any and min selector", async () => {
    const signers = await ethers.getSigners();

    const readWriteTierRight = await readWriteTierDeploy();
    const readWriteTierLeft = await readWriteTierDeploy();

    const constants = [
      ethers.BigNumber.from(readWriteTierRight.address), // right report
      ethers.BigNumber.from(readWriteTierLeft.address), // left report
    ];

    // prettier-ignore
    const sourceReport = concat([
        op(Opcode.blockTimestamp),
          op(Opcode.readMemory, memoryOperand(MemoryType.Constant, 1)),
          op(Opcode.context, 0x0000),
        op(Opcode.itierV2Report),
          op(Opcode.readMemory, memoryOperand(MemoryType.Constant, 0)),
          op(Opcode.context, 0x0000),
        op(Opcode.itierV2Report),
      op(
        Opcode.selectLte,
        selectLte(SelectLteLogic.any, SelectLteMode.min, 2)
      ),
    ]);

    const evaluableConfigCombine = await generateEvaluableConfig(
       [sourceReport, sourceReportTimeForTierDefault],
      constants,
    );
    const combineTier = (await combineTierDeploy(signers[0], {
      combinedTiersLength: 2,
      evaluableConfig: evaluableConfigCombine,
    })) as CombineTier;

    const startTimestamp = await getBlockTimestamp();

    // Set some tiers
    // ReadWriteTierRight
    await readWriteTierRight.setTier(signers[0].address, Tier.ONE);
    await readWriteTierRight.setTier(signers[0].address, Tier.TWO);
    await readWriteTierRight.setTier(signers[0].address, Tier.THREE);

    // ReadWriteTierLeft
    await readWriteTierLeft.setTier(signers[0].address, Tier.ONE);
    await readWriteTierLeft.setTier(signers[0].address, Tier.TWO);
    await readWriteTierLeft.setTier(signers[0].address, Tier.THREE);

    // ReadWriteTierLeft
    await readWriteTierLeft.setTier(signers[0].address, Tier.FOUR);
    await readWriteTierLeft.setTier(signers[0].address, Tier.FIVE);
    await readWriteTierLeft.setTier(signers[0].address, Tier.SIX);

    // ReadWriteTierRight
    await readWriteTierRight.setTier(signers[0].address, Tier.FOUR);
    await readWriteTierRight.setTier(signers[0].address, Tier.FIVE);
    await readWriteTierRight.setTier(signers[0].address, Tier.SIX);
    await readWriteTierRight.setTier(signers[0].address, Tier.EIGHT);

    const rightReport = zeroPad32(
      await readWriteTierRight.report(signers[0].address, [])
    );
    const expectedRightReport = zeroPad32(
      ethers.BigNumber.from(
        "0x" +
          paddedUInt32(startTimestamp + 13) +
          paddedUInt32(startTimestamp + 13) +
          paddedUInt32(startTimestamp + 12) +
          paddedUInt32(startTimestamp + 11) +
          paddedUInt32(startTimestamp + 10) +
          paddedUInt32(startTimestamp + 3) +
          paddedUInt32(startTimestamp + 2) +
          paddedUInt32(startTimestamp + 1)
      )
    );
    assert(
      rightReport === expectedRightReport,
      `wrong right report
      expected  ${expectedRightReport}
      got       ${rightReport}`
    );

    const leftReport = zeroPad32(
      await readWriteTierLeft.report(signers[0].address, [])
    );
    const expectedLeftReport = zeroPad32(
      ethers.BigNumber.from(
        "0x" +
          "ffffffff".repeat(2) +
          paddedUInt32(startTimestamp + 9) +
          paddedUInt32(startTimestamp + 8) +
          paddedUInt32(startTimestamp + 7) +
          paddedUInt32(startTimestamp + 6) +
          paddedUInt32(startTimestamp + 5) +
          paddedUInt32(startTimestamp + 4)
      )
    );
    assert(
      leftReport === expectedLeftReport,
      `wrong left report
      expected  ${expectedLeftReport}
      got       ${leftReport}`
    );

    const resultOrOld = zeroPad32(
      await combineTier.report(signers[0].address, [])
    );
    const expectedOrOld = zeroPad32(
      ethers.BigNumber.from(
        "0x" +
          paddedUInt32(startTimestamp + 13) +
          paddedUInt32(startTimestamp + 13) +
          paddedUInt32(startTimestamp + 9) +
          paddedUInt32(startTimestamp + 8) +
          paddedUInt32(startTimestamp + 7) +
          paddedUInt32(startTimestamp + 3) +
          paddedUInt32(startTimestamp + 2) +
          paddedUInt32(startTimestamp + 1)
      )
    );
    assert(
      resultOrOld === expectedOrOld,
      `wrong block timestamp preserved with tierwise any and min selector
      left      ${leftReport}
      right     ${rightReport}
      expected  ${expectedOrOld}
      got       ${resultOrOld}`
    );
  });
});
