// SPDX-License-Identifier: CAL
pragma solidity =0.8.18;

import {ERC20Upgradeable as ERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ReentrancyGuardUpgradeable as ReentrancyGuard} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "rain.interface.interpreter/IExpressionDeployerV1.sol";
import "sol.lib.memory/LibUint256Array.sol";
import "sol.lib.memory/LibUint256Matrix.sol";
import "rain.interface.interpreter/LibEncodedDispatch.sol";
import "rain.interface.factory/ICloneableV1.sol";
import "rain.interface.flow/IFlowERC20V1.sol";

import {AllStandardOps} from "../../interpreter/ops/AllStandardOps.sol";
import "../libraries/LibFlow.sol";
import "../../math/LibFixedPointMath.sol";
import "../FlowCommon.sol";

/// Thrown when eval of the transfer entrypoint returns 0.
error InvalidTransfer();

bytes32 constant CALLER_META_HASH = bytes32(
    0x8d2e217a8eba75d982ea71b89fac0d594d00be4582e4b84ad64a5caef399d6b9
);

uint256 constant RAIN_FLOW_ERC20_SENTINEL = uint256(
    keccak256(bytes("RAIN_FLOW_ERC20_SENTINEL")) | SENTINEL_HIGH_BITS
);

SourceIndex constant CAN_TRANSFER_ENTRYPOINT = SourceIndex.wrap(0);
uint256 constant CAN_TRANSFER_MIN_OUTPUTS = 1;
uint16 constant CAN_TRANSFER_MAX_OUTPUTS = 1;

/// @title FlowERC20
/// @notice Mints itself according to some predefined schedule. The schedule is
/// expressed as an expression and the `claim` function is world-callable.
/// Intended behaviour is to avoid sybils infinitely minting by putting the
/// claim functionality behind a `TierV2` contract. The flow contract
/// itself implements `ReadOnlyTier` and every time a claim is processed it
/// logs the block number of the claim against every tier claimed. So the block
/// numbers in the tier report for `FlowERC20` are the last time that tier
/// was claimed against this contract. The simplest way to make use of this
/// information is to take the max block for the underlying tier and the last
/// claim and then diff it against the current block number.
/// See `test/Claim/FlowERC20.sol.ts` for examples, including providing
/// staggered rewards where more tokens are minted for higher tier accounts.
contract FlowERC20 is ICloneableV1, IFlowERC20V1, ReentrancyGuard, FlowCommon, ERC20 {
    using LibStackPointer for uint256[];
    using LibStackPointer for StackPointer;
    using LibUint256Array for uint256;
    using LibUint256Array for uint256[];
    using LibUint256Matrix for uint256[];
    using LibInterpreterState for InterpreterState;
    using LibFixedPointMath for uint256;

    Evaluable internal evaluable;

    constructor(
        DeployerDiscoverableMetaV1ConstructionConfig memory config_
    ) FlowCommon(CALLER_META_HASH, config_) {}

    /// @inheritdoc ICloneableV1
    function initialize(bytes calldata data_) external initializer {
        FlowERC20Config memory config_ = abi.decode(data_, (FlowERC20Config));
        emit Initialize(msg.sender, config_);
        __ReentrancyGuard_init();
        __ERC20_init(config_.name, config_.symbol);
        (
            IInterpreterV1 interpreter_,
            IInterpreterStoreV1 store_,
            address expression_
        ) = config_.evaluableConfig.deployer.deployExpression(
                config_.evaluableConfig.sources,
                config_.evaluableConfig.constants,
                LibUint256Array.arrayFrom(CAN_TRANSFER_MIN_OUTPUTS)
            );
        evaluable = Evaluable(interpreter_, store_, expression_);

        flowCommonInit(config_.flowConfig, MIN_FLOW_SENTINELS + 2);
    }

    function _dispatch(
        address expression_
    ) internal pure returns (EncodedDispatch) {
        return
            LibEncodedDispatch.encode(
                expression_,
                CAN_TRANSFER_ENTRYPOINT,
                CAN_TRANSFER_MAX_OUTPUTS
            );
    }

    /// @inheritdoc ERC20
    function _afterTokenTransfer(
        address from_,
        address to_,
        uint256 amount_
    ) internal virtual override {
        unchecked {
            super._afterTokenTransfer(from_, to_, amount_);
            // Mint and burn access MUST be handled by flow.
            // CAN_TRANSFER will only restrict subsequent transfers.
            if (!(from_ == address(0) || to_ == address(0))) {
                Evaluable memory evaluable_ = evaluable;
                uint256[][] memory context_ = LibContext.build(
                    // The transfer params are caller context because the caller
                    // is triggering the transfer.
                    LibUint256Array.arrayFrom(
                        uint256(uint160(from_)),
                        uint256(uint160(to_)),
                        amount_
                    ).matrixFrom(),
                    new SignedContext[](0)
                );
                (uint256[] memory stack_, uint256[] memory kvs_) = evaluable_
                    .interpreter
                    .eval(
                        evaluable_.store,
                        DEFAULT_STATE_NAMESPACE,
                        _dispatch(evaluable_.expression),
                        context_
                    );
                if (stack_[stack_.length - 1] == 0) {
                    revert InvalidTransfer();
                }
                if (kvs_.length > 0) {
                    evaluable_.store.set(DEFAULT_STATE_NAMESPACE, kvs_);
                }
            }
        }
    }

    function _previewFlow(
        Evaluable memory evaluable_,
        uint256[][] memory context_
    ) internal view virtual returns (FlowERC20IO memory, uint256[] memory) {
        uint256[] memory refs_;
        FlowERC20IO memory flowIO_;
        (
            StackPointer stackBottom_,
            StackPointer stackTop_,
            uint256[] memory kvs_
        ) = flowStack(evaluable_, context_);
        (stackTop_, refs_) = stackTop_.consumeStructs(
            stackBottom_,
            RAIN_FLOW_ERC20_SENTINEL,
            2
        );
        assembly ("memory-safe") {
            mstore(flowIO_, refs_)
        }
        (stackTop_, refs_) = stackTop_.consumeStructs(
            stackBottom_,
            RAIN_FLOW_ERC20_SENTINEL,
            2
        );
        assembly ("memory-safe") {
            mstore(add(flowIO_, 0x20), refs_)
        }
        flowIO_.flow = LibFlow.stackToFlow(stackBottom_, stackTop_);

        return (flowIO_, kvs_);
    }

    function _flow(
        Evaluable memory evaluable_,
        uint256[] memory callerContext_,
        SignedContext[] memory signedContexts_
    ) internal virtual nonReentrant returns (FlowERC20IO memory) {
        unchecked {
            uint256[][] memory context_ = LibContext.build(
                callerContext_.matrixFrom(),
                signedContexts_
            );
            emit Context(msg.sender, context_);
            (FlowERC20IO memory flowIO_, uint256[] memory kvs_) = _previewFlow(
                evaluable_,
                context_
            );
            for (uint256 i_ = 0; i_ < flowIO_.mints.length; i_++) {
                _mint(flowIO_.mints[i_].account, flowIO_.mints[i_].amount);
            }
            for (uint256 i_ = 0; i_ < flowIO_.burns.length; i_++) {
                _burn(flowIO_.burns[i_].account, flowIO_.burns[i_].amount);
            }
            LibFlow.flow(flowIO_.flow, evaluable_.store, kvs_);
            return flowIO_;
        }
    }

    function previewFlow(
        Evaluable memory evaluable_,
        uint256[] memory callerContext_,
        SignedContext[] memory signedContexts_
    ) external view virtual returns (FlowERC20IO memory) {
        uint256[][] memory context_ = LibContext.build(
            callerContext_.matrixFrom(),
            signedContexts_
        );
        (FlowERC20IO memory flowERC20IO_, ) = _previewFlow(
            evaluable_,
            context_
        );
        return flowERC20IO_;
    }

    function flow(
        Evaluable memory evaluable_,
        uint256[] memory callerContext_,
        SignedContext[] memory signedContexts_
    ) external payable virtual returns (FlowERC20IO memory) {
        return _flow(evaluable_, callerContext_, signedContexts_);
    }
}
