// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract TestContract is Ownable {
  event ButtonPushed(address pusher);

  function pushButton() public onlyOwner {
    emit ButtonPushed(msg.sender);
  }
}