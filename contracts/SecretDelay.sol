// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

import "@gnosis.pm/zodiac/contracts/core/Modifier.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";

contract SecretDelay is Modifier {
  using CountersUpgradeable for CountersUpgradeable.Counter;

  event DelaySetup(
    address indexed initiator,
    address indexed owner,
    address indexed avatar,
    address target
  );
  event TransactionAdded(
    uint256 indexed queuePointer,
    bytes32 indexed txHash,
    address to,
    uint256 value,
    bytes data,
    Enum.Operation operation
  );
  event SecretTransactionAdded(
    uint256 indexed queuePointer,
    bytes32 indexed txHash,
    string indexed uri,
    uint256 salt
  );
  event TransactionsVetoed(
    uint256 indexed startingVetoedTrxNonce,
    uint256 numberOfTrxVetoed
  );
  event TransactionsApproved(
    uint256 indexed startingApprovedTrxNonce,
    uint256 numberOfTrxApproved
  );

  CountersUpgradeable.Counter public salt;
  uint256 public txCooldown;
  uint256 public txExpiration;
  uint256 public txNonce; // index of proposal in queue to be executed
  uint256 public queuePointer; // index of last slot in queue where next proposal is added
  uint256 public approved; // number of next transactions approved to be executed before cooldown
  // Mapping of queue nonce to transaction hash.
  mapping(uint256 => bytes32) public txHash;
  // Mapping of queue nonce to creation timestamp.
  mapping(uint256 => uint256) public txCreatedAt;

  modifier isExecutable() {
    require(txNonce < queuePointer, "Transaction queue is empty");
    require(
      block.timestamp - txCreatedAt[txNonce] >= txCooldown || approved > 0,
      "Transaction is still in cooldown"
    );
    if (txExpiration != 0) {
      require(
        txCreatedAt[txNonce] + txCooldown + txExpiration >= block.timestamp,
        "Transaction expired"
      );
    }
    if (approved > 0) approved--;
    _;
  }

  /// @param _owner Address of the owner
  /// @param _avatar Address of the avatar (e.g. a Gnosis Safe)
  /// @param _target Address of the contract that will call exec function
  /// @param _cooldown Cooldown in seconds that should be required after a transaction is proposed
  /// @param _expiration Duration that a proposed transaction is valid for after the cooldown, in seconds (or 0 if valid forever)
  /// @notice There need to be at least 60 seconds between end of cooldown and expiration
  constructor(
    address _owner,
    address _avatar,
    address _target,
    uint256 _cooldown,
    uint256 _expiration
  ) {
    bytes memory initParams =
      abi.encode(_owner, _avatar, _target, _cooldown, _expiration);
    setUp(initParams);
  }

  function setUp(bytes memory initParams) public override {
    (
      address _owner,
      address _avatar,
      address _target,
      uint256 _cooldown,
      uint256 _expiration
    ) = abi.decode(initParams, (address, address, address, uint256, uint256));
    __Ownable_init();
    require(_avatar != address(0), "Avatar can not be zero address");
    require(_target != address(0), "Target can not be zero address");
    require(
      _expiration == 0 || _expiration >= 60,
      "Expiratition must be 0 or at least 60 seconds"
    );

    avatar = _avatar;
    target = _target;
    txExpiration = _expiration;
    txCooldown = _cooldown;

    transferOwnership(_owner);
    setupModules();

    emit DelaySetup(msg.sender, _owner, _avatar, _target);
  }

  function setupModules() internal {
    require(
      modules[SENTINEL_MODULES] == address(0),
      "setUpModules has already been called"
    );
    modules[SENTINEL_MODULES] = SENTINEL_MODULES;
  }

  /// @dev Sets the cooldown before a transaction can be executed.
  /// @param cooldown Cooldown in seconds that should be required before the transaction can be executed
  /// @notice This can only be called by the owner
  function setTxCooldown(uint256 cooldown) public onlyOwner {
    txCooldown = cooldown;
  }

  /// @dev Sets the duration for which a transaction is valid.
  /// @param expiration Duration that a transaction is valid in seconds (or 0 if valid forever) after the cooldown
  /// @notice There need to be at least 60 seconds between end of cooldown and expiration
  /// @notice This can only be called by the owner
  function setTxExpiration(uint256 expiration) public onlyOwner {
    require(
      expiration == 0 || expiration >= 60,
      "Expiratition must be 0 or at least 60 seconds"
    );
    txExpiration = expiration;
  }

  /// @dev Sets transaction nonce. Used to invalidate or skip transactions in queue.
  /// @param _newTxNonce 1 + nonce of transaction to veto
  /// @notice This can only be called by the owner
  function vetoTransactionsTill(uint256 _newTxNonce) public onlyOwner {
    require(_newTxNonce > txNonce, "New nonce must be higher than current txNonce");
    require(_newTxNonce <= queuePointer, "Cannot be higher than queuePointer");
    _adjustApprovals(_newTxNonce);
    emit TransactionsVetoed(txNonce, _newTxNonce - txNonce);
    txNonce = _newTxNonce;
  }

  function vetoTransactionsTillAndApprove(uint256 _newTxNonce, uint256 _transactions)
    public
    onlyOwner
  {
    // vetos transactions
    if (_newTxNonce > txNonce) vetoTransactionsTill(_newTxNonce);

    // approves transactions
    // note: unknown transactions won't be approved because if all transactions are vetoed
    //       and no transactions in queue, it will revert execution
    approveNext(_transactions);
  }

  function approveNext(uint256 _transactions) public onlyOwner {
    require(_transactions > 0, "Must approve at least one tx");
    require(queuePointer - txNonce >= _transactions, "Cannot approve unknown tx");
    emit TransactionsApproved(txNonce, _transactions);
    approved = _transactions;
  }

  /// @dev Adds a transaction to the queue (same as avatar interface so that this can be placed between other modules and the avatar).
  /// @param to Destination address of module transaction
  /// @param value Ether value of module transaction
  /// @param data Data payload of module transaction
  /// @param operation Operation type of module transaction
  /// @notice Can only be called by enabled modules
  function execTransactionFromModule(
    address to,
    uint256 value,
    bytes calldata data,
    Enum.Operation operation
  ) public override moduleOnly returns (bool success) {
    txHash[queuePointer] = getTransactionHash(to, value, data, operation);
    txCreatedAt[queuePointer] = block.timestamp;
    emit TransactionAdded(
      queuePointer,
      txHash[queuePointer],
      to,
      value,
      data,
      operation
    );
    queuePointer++;
    success = true;
  }

  /// @dev Adds a the has of a transaction to the queue
  /// @param hashedTransaction hash of the transaction
  /// @notice Can only be called by enabled modules
  function enqueueSecretTx(bytes32 hashedTransaction, string memory uri)
    public
    moduleOnly
  {
    txHash[queuePointer] = hashedTransaction;
    txCreatedAt[queuePointer] = block.timestamp;
    emit SecretTransactionAdded(
      queuePointer,
      txHash[queuePointer],
      uri,
      salt.current()
    );

    queuePointer++;
    salt.increment();
  }

  /// @dev Executes the next transaction only if the cooldown has passed or tx has been approved and the transaction has not expired
  /// @param to Destination address of module transaction
  /// @param value Ether value of module transaction
  /// @param data Data payload of module transaction
  /// @param operation Operation type of module transaction
  /// @notice The txIndex used by this function is always 0
  function executeNextTx(
    address to,
    uint256 value,
    bytes calldata data,
    Enum.Operation operation
  ) public isExecutable {
    require(
      txHash[txNonce] == getTransactionHash(to, value, data, operation),
      "Transaction hashes do not match"
    );
    txNonce++;
    require(exec(to, value, data, operation), "Module transaction failed");
  }

  /// @dev Executes the next transaction only if the cooldown has passed or tx has been approved and the transaction has not expired
  /// @param to Destination address of module transaction
  /// @param value Ether value of module transaction
  /// @param data Data payload of module transaction
  /// @param operation Operation type of module transaction
  /// @param _salt Salt that was used for hashing the tx originally
  function executeNextSecretTx(
    address to,
    uint256 value,
    bytes calldata data,
    Enum.Operation operation,
    uint256 _salt
  ) public isExecutable {
    require(
      txHash[txNonce] ==
        getSecretTransactionHash(to, value, data, operation, _salt),
      "Transaction hashes do not match"
    );
    txNonce++;
    require(exec(to, value, data, operation), "Module transaction failed");
  }

  function skipExpired() public {
    while (
      txExpiration != 0 &&
      txCreatedAt[txNonce] + txCooldown + txExpiration < block.timestamp &&
      txNonce < queuePointer
    ) {
      txNonce++;
    }
  }

  function getTransactionHash(
    address to,
    uint256 value,
    bytes memory data,
    Enum.Operation operation
  ) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(to, value, data, operation));
  }

  function getSecretTransactionHash(
    address to,
    uint256 value,
    bytes memory data,
    Enum.Operation operation,
    uint256 _salt
  ) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(to, value, data, operation, _salt));
  }

  function getTxHash(uint256 _nonce) public view returns (bytes32) {
    return (txHash[_nonce]);
  }

  function getTxCreatedAt(uint256 _nonce) public view returns (uint256) {
    return (txCreatedAt[_nonce]);
  }

  function _adjustApprovals(uint256 _nonce) internal {
    uint256 delta = _nonce - txNonce;

    if (delta > approved) {
      if (approved != 0) approved = 0;
    } else {
      approved -= delta;
    }
  }
}
