import { arrayify, concat, solidityKeccak256 } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { FlowERC20Factory, FlowIntegrity } from "../../../typechain";
import {
  SaveInterpreterStateEvent,
  SignedContextStruct,
} from "../../../typechain/contracts/flow/basic/Flow";
import { FlowERC20ConfigStruct } from "../../../typechain/contracts/flow/erc20/FlowERC20";
import {
  RAIN_FLOW_ERC20_SENTINEL,
  RAIN_FLOW_SENTINEL,
} from "../../../utils/constants/sentinel";
import { flowERC20Deploy } from "../../../utils/deploy/flow/flow";
import { getEvents } from "../../../utils/events";
import {
  memoryOperand,
  MemoryType,
  op,
} from "../../../utils/interpreter/interpreter";
import { AllStandardOps } from "../../../utils/interpreter/ops/allStandardOps";
import { assertError } from "../../../utils/test/assertError";

const Opcode = AllStandardOps;

describe("FlowERC20 signed context tests", async function () {
  let integrity: FlowIntegrity;
  let flowERC20Factory: FlowERC20Factory;

  before(async () => {
    const integrityFactory = await ethers.getContractFactory("FlowIntegrity");
    integrity = (await integrityFactory.deploy()) as FlowIntegrity;
    await integrity.deployed();

    const flowERC20FactoryFactory = await ethers.getContractFactory(
      "FlowERC20Factory",
      {}
    );
    flowERC20Factory = (await flowERC20FactoryFactory.deploy(
      integrity.address
    )) as FlowERC20Factory;
    await flowERC20Factory.deployed();
  });

  it("should validate multiple signed contexts", async () => {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const goodSigner = signers[1];
    const badSigner = signers[2];

    const constants = [RAIN_FLOW_SENTINEL, RAIN_FLOW_ERC20_SENTINEL, 1];

    const SENTINEL = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 0));
    const SENTINEL_ERC20 = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 1));

    const CAN_TRANSFER = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 2));
    const CAN_SIGN_CONTEXT = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 2));
    const CAN_FLOW = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 2));

    const sourceFlowIO = concat([
      SENTINEL(), // ERC1155 SKIP
      SENTINEL(), // ERC721 SKIP
      SENTINEL(), // ERC20 SKIP
      SENTINEL(), // NATIVE END
      SENTINEL_ERC20(), // BURN END
      SENTINEL_ERC20(), // MINT END
    ]);

    const sources = [CAN_TRANSFER()];

    const flowConfigStruct: FlowERC20ConfigStruct = {
      name: "Flow ERC20",
      symbol: "F20",
      interpreterStateConfig: {
        sources,
        constants,
      },
      flows: [
        { sources: [CAN_SIGN_CONTEXT(), CAN_FLOW(), sourceFlowIO], constants },
      ],
    };

    const flow = await flowERC20Deploy(
      deployer,
      flowERC20Factory,
      flowConfigStruct
    );

    const flowStates = (await getEvents(
      flow.deployTransaction,
      "SaveInterpreterState",
      flow
    )) as SaveInterpreterStateEvent["args"][];

    const context = [1, 2, 3];
    const hash = solidityKeccak256(["uint256[]"], [context]);

    const goodSignature = await goodSigner.signMessage(arrayify(hash));

    const signedContexts0: SignedContextStruct[] = [
      {
        signer: goodSigner.address,
        signature: goodSignature,
        context,
      },
    ];

    await flow
      .connect(goodSigner)
      .flow(flowStates[1].id, 1234, signedContexts0, {});

    // with bad signature
    const badSignature = await badSigner.signMessage(arrayify(hash));
    const signedContexts1: SignedContextStruct[] = [
      {
        signer: goodSigner.address,
        signature: badSignature,
        context,
      },
    ];

    await assertError(
      async () =>
        await flow
          .connect(goodSigner)
          .flow(flowStates[1].id, 1234, signedContexts1, {}),
      "INVALID_SIGNATURE",
      "did not error with signature from incorrect signer"
    );
  });

  it("should validate a signed context", async () => {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const goodSigner = signers[1];
    const badSigner = signers[2];

    const constants = [RAIN_FLOW_SENTINEL, RAIN_FLOW_ERC20_SENTINEL, 1];

    const SENTINEL = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 0));
    const SENTINEL_ERC20 = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 1));

    const CAN_TRANSFER = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 2));
    const CAN_SIGN_CONTEXT = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 2));
    const CAN_FLOW = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 2));

    const sourceFlowIO = concat([
      SENTINEL(), // ERC1155 SKIP
      SENTINEL(), // ERC721 SKIP
      SENTINEL(), // ERC20 SKIP
      SENTINEL(), // NATIVE END
      SENTINEL_ERC20(), // BURN END
      SENTINEL_ERC20(), // MINT END
    ]);

    const sources = [CAN_TRANSFER()];

    const flowConfigStruct: FlowERC20ConfigStruct = {
      name: "Flow ERC20",
      symbol: "F20",
      interpreterStateConfig: {
        sources,
        constants,
      },
      flows: [
        { sources: [CAN_SIGN_CONTEXT(), CAN_FLOW(), sourceFlowIO], constants },
      ],
    };

    const flow = await flowERC20Deploy(
      deployer,
      flowERC20Factory,
      flowConfigStruct
    );

    const flowStates = (await getEvents(
      flow.deployTransaction,
      "SaveInterpreterState",
      flow
    )) as SaveInterpreterStateEvent["args"][];

    const context0 = [1, 2, 3];
    const hash0 = solidityKeccak256(["uint256[]"], [context0]);
    const goodSignature0 = await goodSigner.signMessage(arrayify(hash0));

    const context1 = [4, 5, 6];
    const hash1 = solidityKeccak256(["uint256[]"], [context1]);
    const goodSignature1 = await goodSigner.signMessage(arrayify(hash1));

    const signedContexts0: SignedContextStruct[] = [
      {
        signer: goodSigner.address,
        signature: goodSignature0,
        context: context0,
      },
      {
        signer: goodSigner.address,
        signature: goodSignature1,
        context: context1,
      },
    ];

    await flow
      .connect(goodSigner)
      .flow(flowStates[1].id, 1234, signedContexts0, {});

    // with bad signature in second signed context
    const badSignature = await badSigner.signMessage(arrayify(hash1));
    const signedContexts1: SignedContextStruct[] = [
      {
        signer: goodSigner.address,
        signature: goodSignature0,
        context: context0,
      },
      {
        signer: goodSigner.address,
        signature: badSignature,
        context: context0,
      },
    ];

    await assertError(
      async () =>
        await flow
          .connect(goodSigner)
          .flow(flowStates[1].id, 1234, signedContexts1, {}),
      "INVALID_SIGNATURE",
      "did not error with signature from incorrect signer"
    );
  });

  it("should support expression which gates whether sender can validate their signed context", async () => {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const you = signers[1];

    const constants = [RAIN_FLOW_SENTINEL, RAIN_FLOW_ERC20_SENTINEL, 0, 1];

    const SENTINEL = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 0));
    const SENTINEL_ERC20 = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 1));

    const CAN_TRANSFER = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 3));
    const CAN_SIGN_CONTEXT = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 2));
    const CAN_FLOW = () =>
      op(Opcode.STATE, memoryOperand(MemoryType.Constant, 3));

    const sourceFlowIO = concat([
      SENTINEL(), // ERC1155 SKIP
      SENTINEL(), // ERC721 SKIP
      SENTINEL(), // ERC20 SKIP
      SENTINEL(), // NATIVE END
      SENTINEL_ERC20(), // BURN END
      SENTINEL_ERC20(), // MINT END
    ]);

    const sources = [CAN_TRANSFER()];

    const flowConfigStruct: FlowERC20ConfigStruct = {
      name: "Flow ERC20",
      symbol: "F20",
      interpreterStateConfig: {
        sources,
        constants,
      },
      flows: [
        { sources: [CAN_SIGN_CONTEXT(), CAN_FLOW(), sourceFlowIO], constants },
      ],
    };

    const flow = await flowERC20Deploy(
      deployer,
      flowERC20Factory,
      flowConfigStruct
    );

    const flowStates = (await getEvents(
      flow.deployTransaction,
      "SaveInterpreterState",
      flow
    )) as SaveInterpreterStateEvent["args"][];

    const signedContexts: SignedContextStruct[] = [
      {
        signer: you.address,
        signature: new Uint8Array(),
        context: [],
      },
    ];

    await assertError(
      async () =>
        await flow
          .connect(you)
          .flow(flowStates[1].id, 1234, signedContexts, {}),
      "BAD_SIGNER",
      "did not prevent signed context validation when CAN_SIGN_CONTEXT set to false"
    );

    // no signed contexts does not throw error
    await flow.connect(you).flow(flowStates[1].id, 1234, [], {});
  });
});
