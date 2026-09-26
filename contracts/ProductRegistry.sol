// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProductRegistry - immutable product identities
contract ProductRegistry {
    struct Product {
        uint256 productId;
        string name;
        address manufacturer;
        string batchNumber;
        uint256 mfgDate;
        address currentOwner;
    }

    uint256 public productCount;
    mapping(uint256 => Product) internal products;
    // serial is the manufacturer-supplied unique key; guards duplicate registration
    mapping(bytes32 => bool) public serialUsed;

    event ProductRegistered(
        uint256 indexed productId,
        string serial,
        address indexed manufacturer,
        string batchNumber,
        uint256 mfgDate
    );

    function registerProduct(
        string calldata serial,
        string calldata name,
        string calldata batchNumber,
        uint256 mfgDate
    ) external returns (uint256 productId) {
        bytes32 key = keccak256(bytes(serial));
        require(!serialUsed[key], "duplicate serial");
        require(bytes(name).length > 0, "name required");
        serialUsed[key] = true;

        productId = ++productCount;
        products[productId] = Product({
            productId: productId,
            name: name,
            manufacturer: msg.sender,
            batchNumber: batchNumber,
            mfgDate: mfgDate,
            currentOwner: msg.sender
        });

        emit ProductRegistered(productId, serial, msg.sender, batchNumber, mfgDate);
    }

    function getProduct(uint256 productId) external view returns (Product memory) {
        return products[productId];
    }
}
