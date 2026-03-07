// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC8004 {
    mapping(uint256 => address) public owners;
    mapping(uint256 => uint256) public reputation;
    uint256 public nextTokenId = 1;

    function mint(address to) external returns (uint256) {
        uint256 tokenId = nextTokenId++;
        owners[tokenId] = to;
        reputation[tokenId] = 100;
        return tokenId;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }

    function getReputation(uint256 tokenId) external view returns (uint256) {
        return reputation[tokenId];
    }
}
