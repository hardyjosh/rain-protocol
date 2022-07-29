// SPDX-License-Identifier: CAL
pragma solidity ^0.8.15;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../LibStackTop.sol";
import "../../LibVMState.sol";
import "../../LibIntegrityState.sol";

/// @title OpWhile
/// @notice Opcode for looping while the stack top is true.
library OpDoWhile {
    using LibStackTop for StackTop;
    using LibVMState for VMState;

    function integrity(
        IntegrityState memory,
        Operand,
        StackTop
    ) internal pure returns (StackTop) {
        revert("UNIMPLEMENTED");
    }

    /// Loop the stack while the stack top is true.
    function doWhile(
        VMState memory state_,
        Operand operand_,
        StackTop stackTop_
    ) internal view returns (StackTop) {
        while (stackTop_.peek() > 0) {
            // eval is NOT allowed to change the stack top so we
            // ignore the return of eval. This is enforced by bounds
            // checks.
            state_.eval(
                state_,
                SourceIndex.wrap(Operand.unwrap(operand_)),
                stackTop_.down()
            );
        }
        return stackTop_.down();
    }
}
