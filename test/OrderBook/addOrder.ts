import { assert } from "chai";
import { ContractFactory } from "ethers";
import { concat } from "ethers/lib/utils";
import { ethers } from "hardhat";
import type {
  OrderBook,
  Rainterpreter,
  RainterpreterExpressionDeployer,
  ReserveToken18,
} from "../../typechain";
import {
  OrderConfigStruct,
  OrderLiveEvent,
} from "../../typechain/contracts/orderbook/OrderBook";
import {
  eighteenZeros,
  max_uint256,
  ONE,
} from "../../utils/constants/bigNumber";
import { basicDeploy } from "../../utils/deploy/basicDeploy";
import { rainterpreterDeploy } from "../../utils/deploy/interpreter/shared/rainterpreter/deploy";
import { rainterpreterExpressionDeployer } from "../../utils/deploy/interpreter/shared/rainterpreterExpressionDeployer/deploy";
import { getEventArgs } from "../../utils/events";
import {
  memoryOperand,
  MemoryType,
  op,
} from "../../utils/interpreter/interpreter";
import { AllStandardOps } from "../../utils/interpreter/ops/allStandardOps";
import { fixedPointDiv } from "../../utils/math";
import { compareStructs } from "../../utils/test/compareStructs";

const Opcode = AllStandardOps;

describe("OrderBook add order", async function () {
  let orderBookFactory: ContractFactory;
  let tokenA: ReserveToken18;
  let tokenB: ReserveToken18;
  let interpreter: Rainterpreter;
  let expressionDeployer: RainterpreterExpressionDeployer;

  beforeEach(async () => {
    tokenA = (await basicDeploy("ReserveToken18", {})) as ReserveToken18;
    tokenB = (await basicDeploy("ReserveToken18", {})) as ReserveToken18;
  });

  before(async () => {
    orderBookFactory = await ethers.getContractFactory("OrderBook", {});
    interpreter = await rainterpreterDeploy();
    expressionDeployer = await rainterpreterExpressionDeployer(interpreter);
  });

  it("should add orders", async function () {
    const signers = await ethers.getSigners();

    const alice = signers[1];
    const bob = signers[2];

    const orderBook = (await orderBookFactory.deploy()) as OrderBook;

    const aliceInputVault = ethers.BigNumber.from(1);
    const aliceOutputVault = ethers.BigNumber.from(2);
    const bobInputVault = ethers.BigNumber.from(1);
    const bobOutputVault = ethers.BigNumber.from(2);

    // ASK ORDER

    const askPrice = ethers.BigNumber.from("90" + eighteenZeros);
    const askConstants = [max_uint256, askPrice];
    const vAskOutputMax = op(
      Opcode.STATE,
      memoryOperand(MemoryType.Constant, 0)
    );
    const vAskPrice = op(Opcode.STATE, memoryOperand(MemoryType.Constant, 1));
    // prettier-ignore
    const askSource = concat([
      vAskOutputMax,
      vAskPrice,
    ]);
    const askOrderConfig: OrderConfigStruct = {
      interpreter: interpreter.address,
      expressionDeployer: expressionDeployer.address,
      validInputs: [{ token: tokenA.address, vaultId: aliceInputVault }],
      validOutputs: [{ token: tokenB.address, vaultId: aliceOutputVault }],
      interpreterStateConfig: {
        sources: [askSource],
        constants: askConstants,
      },
    };

    const txAskOrderLive = await orderBook
      .connect(alice)
      .addOrder(askOrderConfig);

    const { sender: askSender, order: askConfig } = (await getEventArgs(
      txAskOrderLive,
      "OrderLive",
      orderBook
    )) as OrderLiveEvent["args"];

    assert(askSender === alice.address, "wrong sender");
    compareStructs(askConfig, askOrderConfig);

    // BID ORDER

    const bidPrice = fixedPointDiv(ONE, askPrice);
    const bidConstants = [max_uint256, bidPrice];
    const vBidOutputMax = op(
      Opcode.STATE,
      memoryOperand(MemoryType.Constant, 0)
    );
    const vBidPrice = op(Opcode.STATE, memoryOperand(MemoryType.Constant, 1));
    // prettier-ignore
    const bidSource = concat([
      vBidOutputMax,
      vBidPrice,
    ]);
    const bidOrderConfig: OrderConfigStruct = {
      interpreter: interpreter.address,
      expressionDeployer: expressionDeployer.address,
      validInputs: [{ token: tokenB.address, vaultId: bobInputVault }],
      validOutputs: [{ token: tokenA.address, vaultId: bobOutputVault }],
      interpreterStateConfig: {
        sources: [bidSource],
        constants: bidConstants,
      },
    };

    const txBidOrderLive = await orderBook
      .connect(bob)
      .addOrder(bidOrderConfig);

    const { sender: bidSender, order: bidConfig } = (await getEventArgs(
      txBidOrderLive,
      "OrderLive",
      orderBook
    )) as OrderLiveEvent["args"];

    assert(bidSender === bob.address, "wrong sender");
    compareStructs(bidConfig, bidOrderConfig);
  });
});
