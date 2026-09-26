// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ProductRegistry.sol";

/// @title OwnershipTransfer - custody chain on top of the registry.
/// Inherits the registry so one deployment serves both; the split is
/// conceptual, not a second address to wire up.
contract OwnershipTransfer is ProductRegistry {
    struct Hop {
        address from;
        address to;
        uint256 timestamp;
    }

    mapping(uint256 => Hop[]) internal transferLog;

    event OwnershipTransferred(
        uint256 indexed productId,
        address indexed from,
        address indexed to,
        uint256 timestamp
    );

    function transferOwnership(uint256 productId, address to) external {
        Product storage p = products[productId];
        require(p.manufacturer != address(0), "not registered");
        require(p.currentOwner == msg.sender, "not current owner");
        require(to != address(0) && to != msg.sender, "bad recipient");

        p.currentOwner = to;
        transferLog[productId].push(Hop(msg.sender, to, block.timestamp));
        emit OwnershipTransferred(productId, msg.sender, to, block.timestamp);
    }

    function getTransferLog(uint256 productId) external view returns (Hop[] memory) {
        return transferLog[productId];
    }

    /// On-chain half of verification: replay the log and confirm it lands on
    /// the recorded currentOwner. 0=NOT_REGISTERED 1=GENUINE 2=OWNERSHIP_MISMATCH
    function verifyProduct(uint256 productId) external view returns (uint8 status, address owner, uint256 hops) {
        Product storage p = products[productId];
        if (p.manufacturer == address(0)) return (0, address(0), 0);

        Hop[] storage log = transferLog[productId];
        address cursor = p.manufacturer;
        for (uint256 i = 0; i < log.length; i++) {
            if (log[i].from != cursor) return (2, p.currentOwner, log.length);
            cursor = log[i].to;
        }
        if (cursor != p.currentOwner) return (2, p.currentOwner, log.length);
        return (1, p.currentOwner, log.length);
    }
}
