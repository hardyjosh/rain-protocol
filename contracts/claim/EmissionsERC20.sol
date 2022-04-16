// SPDX-License-Identifier: CAL
pragma solidity =0.8.10;

import "../tier/libraries/TierConstants.sol";
import {ERC20Config} from "../erc20/ERC20Config.sol";
import "./IClaim.sol";
import "../tier/ReadOnlyTier.sol";
import {Dispatch, DispatchTable, RainVM, State, SourceAnalysis} from "../vm/RainVM.sol";
import {VMState, StateConfig} from "../vm/libraries/VMState.sol";
// solhint-disable-next-line max-line-length
import {AllStandardOps, ALL_STANDARD_OPS_START, ALL_STANDARD_OPS_LENGTH} from "../vm/ops/AllStandardOps.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "../sstore2/SSTORE2.sol";

/// Constructor config.
/// @param allowDelegatedClaims True if accounts can call `claim` on behalf of
/// another account.
/// @param Constructor config for the ERC20 token minted according to emissions
/// schedule in `claim`.
/// @param Constructor config for the `ImmutableSource` that defines the
/// emissions schedule for claiming.
struct EmissionsERC20Config {
    bool allowDelegatedClaims;
    ERC20Config erc20Config;
    StateConfig vmStateConfig;
}

/// @dev Source index for VM eval.
uint256 constant SOURCE_INDEX = 0;

/// @dev local opcode to put claimant account on the stack.
uint256 constant OPCODE_CLAIMANT_ACCOUNT = 0;
/// @dev local opcodes length.
uint256 constant LOCAL_OPS_LENGTH = 1;

/// @title EmissionsERC20
/// @notice Mints itself according to some predefined schedule. The schedule is
/// expressed as a rainVM script and the `claim` function is world-callable.
/// Intended behaviour is to avoid sybils infinitely minting by putting the
/// claim functionality behind a `ITier` contract. The emissions contract
/// itself implements `ReadOnlyTier` and every time a claim is processed it
/// logs the block number of the claim against every tier claimed. So the block
/// numbers in the tier report for `EmissionsERC20` are the last time that tier
/// was claimed against this contract. The simplest way to make use of this
/// information is to take the max block for the underlying tier and the last
/// claim and then diff it against the current block number.
/// See `test/Claim/EmissionsERC20.sol.ts` for examples, including providing
/// staggered rewards where more tokens are minted for higher tier accounts.
contract EmissionsERC20 is
    Initializable,
    RainVM,
    VMState,
    ERC20Upgradeable,
    IClaim,
    ReadOnlyTier
{
    using Dispatch for DispatchTable;

    /// Contract has initialized.
    /// @param sender `msg.sender` initializing the contract (factory).
    /// @param allowDelegatedClaims True if accounts can call `claim` on behalf
    /// of another account.
    event Initialize(address sender, bool allowDelegatedClaims);

    /// Address of the immutable rain script deployed as a `VMState`.
    address private vmStatePointer;

    address private fnPtrsPointer;

    /// Whether the claimant must be the caller of `claim`. If `false` then
    /// accounts other than claimant can claim. This may or may not be
    /// desirable depending on the emissions schedule. For example, a linear
    /// schedule will produce the same end result for the claimant regardless
    /// of who calls `claim` or when but an exponential schedule is more
    /// profitable if the claimant waits longer between claims. In the
    /// non-linear case delegated claims would be inappropriate as third
    /// party accounts could grief claimants by claiming "early", thus forcing
    /// opportunity cost on claimants who would have preferred to wait.
    bool public allowDelegatedClaims;

    /// Each claim is modelled as a report so that the claim report can be
    /// diffed against the upstream report from a tier based emission scheme.
    mapping(address => uint256) private reports;

    /// @param config_ source and token config. Also controls delegated claims.
    function initialize(EmissionsERC20Config calldata config_)
        external
        initializer
    {
        __ERC20_init(config_.erc20Config.name, config_.erc20Config.symbol);
        _mint(
            config_.erc20Config.distributor,
            config_.erc20Config.initialSupply
        );

        SourceAnalysis memory sourceAnalysis_ = _newSourceAnalysis();
        analyzeSources(
            sourceAnalysis_,
            config_.vmStateConfig.sources,
            SOURCE_INDEX
        );
        vmStatePointer = _snapshot(
            _newState(config_.vmStateConfig, sourceAnalysis_)
        );

        bytes memory fnPtrs_ = fnPtrs();
        fnPtrsPointer = SSTORE2.write(fnPtrs_);

        /// Log some deploy state for use by claim/opcodes.
        allowDelegatedClaims = config_.allowDelegatedClaims;

        emit Initialize(msg.sender, config_.allowDelegatedClaims);
    }

    /// @inheritdoc RainVM
    function stackIndexDiff(uint256 opcode_, uint256 operand_)
        public
        view
        override
        returns (int256)
    {
        unchecked {
            if (opcode_ < ALL_STANDARD_OPS_LENGTH) {
                return AllStandardOps.stackIndexDiff(opcode_, operand_);
            } else {
                return 1;
            }
        }
    }

    function account(
        bytes memory context_,
        uint256,
        uint256 stackTopLocation_
    ) internal view returns (uint256) {
        assembly {
            mstore(stackTopLocation_, mload(add(context_, 0x20)))
            stackTopLocation_ := add(stackTopLocation_, 0x20)
        }
        return stackTopLocation_;
    }

    /// @inheritdoc ITier
    function report(address account_)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return
            reports[account_] > 0
                ? reports[account_]
                : TierConstants.NEVER_REPORT;
    }

    function fnPtrs() public view returns (bytes memory) {
        bytes memory dispatchTableBytes_ = new bytes(0x20);
        function(bytes memory, uint256, uint256)
            view
            returns (uint256) account_ = account;
        assembly {
            mstore(add(dispatchTableBytes_, 0x20), account_)
        }
        return
            bytes.concat(
                AllStandardOps.dispatchTableBytes(),
                dispatchTableBytes_
            );
    }

    /// Calculates the claim without processing it.
    /// Read only method that may be useful downstream both onchain and
    /// offchain if a claimant wants to check the claim amount before deciding
    /// whether to process it.
    /// As this is read only there are no checks against delegated claims. It
    /// is possible to return a value from `calculateClaim` and to not be able
    /// to process the claim with `claim` if `msg.sender` is not the
    /// `claimant_`.
    /// @param claimant_ Address to calculate current claim for.
    function calculateClaim(address claimant_) public view returns (uint256) {
        State memory state_ = _restore(vmStatePointer);
        eval(
            Dispatch.fromBytes(SSTORE2.read(fnPtrsPointer)),
            abi.encode(claimant_),
            state_,
            SOURCE_INDEX
        );
        return state_.stack[state_.stackIndex - 1];
    }

    /// Processes the claim for `claimant_`.
    /// - Enforces `allowDelegatedClaims` if it is `true` so that `msg.sender`
    /// must also be `claimant_`.
    /// - Takes the return from `calculateClaim` and mints for `claimant_`.
    /// - Records the current block as the claim-tier for this contract.
    /// - emits a `Claim` event as per `IClaim`.
    /// @param claimant_ address receiving minted tokens. MUST be `msg.sender`
    /// if `allowDelegatedClaims` is `false`.
    /// @param data_ NOT used onchain. Forwarded to `Claim` event for potential
    /// additional offchain processing.
    /// @inheritdoc IClaim
    function claim(address claimant_, bytes calldata data_) external {
        // Disallow delegated claims if appropriate.
        if (!allowDelegatedClaims) {
            require(msg.sender == claimant_, "DELEGATED_CLAIM");
        }

        // Mint the claim.
        uint256 amount_ = calculateClaim(claimant_);
        _mint(claimant_, amount_);

        // Record the current block as the latest claim.
        // This can be diffed/combined with external reports in future claim
        // calculations.
        reports[claimant_] = TierReport.updateBlocksForTierRange(
            TierConstants.NEVER_REPORT,
            TierConstants.TIER_ZERO,
            TierConstants.TIER_EIGHT,
            block.number
        );
        emit TierChange(
            msg.sender,
            claimant_,
            TierConstants.TIER_ZERO,
            TierConstants.TIER_EIGHT,
            // `data_` is emitted under `Claim`.
            ""
        );
        emit Claim(msg.sender, claimant_, data_);
    }
}
