import { assert } from "chai";

import { ethers } from "hardhat";

import { OrderBook } from "../../typechain/contracts/orderbook/OrderBook";

import deploy1820 from "../../utils/deploy/registry1820/deploy";
import { getTouchDeployer } from "../../utils/deploy/interpreter/shared/rainterpreterExpressionDeployer/deploy";
import { InterpreterCallerV1ConstructionConfigStruct } from "../../typechain/contracts/flow/FlowCommon";
import {
  assertError,
  getRainContractMetaBytes,
  zeroAddress,
} from "../../utils";

describe("OrderBook Constructor", async function () {
  before(async () => {
    // Deploy ERC1820Registry
    const signers = await ethers.getSigners();
    await deploy1820(signers[0]);
  });

  it("should fail if deploy is initiated with bad callerMeta", async function () {
    const orderBookFactory = await ethers.getContractFactory("OrderBook", {});
    const touchDeployer = await getTouchDeployer();

    const config0: InterpreterCallerV1ConstructionConfigStruct = {
      callerMeta: getRainContractMetaBytes("orderbook"),
      deployer: touchDeployer.address,
    };
    const orderBook = (await orderBookFactory.deploy(config0)) as OrderBook;

    assert(!(orderBook.address === zeroAddress), "OrderBook did not deploy");

    const config1: InterpreterCallerV1ConstructionConfigStruct = {
      callerMeta: getRainContractMetaBytes("lobby"),
      deployer: touchDeployer.address,
    };

    await assertError(
      async () => await orderBookFactory.deploy(config1),
      "UnexpectedMetaHash",
      "Stake Deployed for bad hash"
    );
  });
});
