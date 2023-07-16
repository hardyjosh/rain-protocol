// SPDX-License-Identifier: CAL
pragma solidity ^0.8.18;

import "rain.interface.sale/ISaleV2.sol";
import "rain.solmem/lib/LibStackPointer.sol";
import "rain.interpreter/lib/op/LibOp.sol";
import "rain.interpreter/lib/state/LibInterpreterState.sol";
import "rain.interpreter/lib/integrity/LibIntegrityCheck.sol";

/// @title OpISaleV2Token
/// @notice Opcode for ISaleV2 `token`.
library OpISaleV2Token {
    using LibOp for Pointer;
    using LibStackPointer for Pointer;
    using LibIntegrityCheck for IntegrityCheckState;

    function f(uint256 sale_) internal view returns (uint256) {
        return uint256(uint160(ISaleV2(address(uint160(sale_))).token()));
    }

    function integrity(
        IntegrityCheckState memory integrityCheckState_,
        Operand,
        Pointer stackTop_
    ) internal pure returns (Pointer) {
        return integrityCheckState_.applyFn(stackTop_, f);
    }

    /// Stack `token`.
    function run(
        InterpreterState memory,
        Operand,
        Pointer stackTop_
    ) internal view returns (Pointer) {
        return stackTop_.applyFn(f);
    }
}
