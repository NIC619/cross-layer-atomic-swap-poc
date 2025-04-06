// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev A simple ERC20 token implementation for testing purposes
 * Includes a mint function that can be called by anyone
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    /**
     * @dev Constructor that gives the msg.sender all of the initial supply.
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param decimals_ The number of decimals for the token
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     */
    function mint(address account, uint256 amount) public {
        require(account != address(0), "MockERC20: mint to the zero address");
        _mint(account, amount);
    }
} 