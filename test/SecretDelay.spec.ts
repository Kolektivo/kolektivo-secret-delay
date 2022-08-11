import { expect } from "chai";
import hre, { deployments, waffle, ethers } from "hardhat";
import { Contract } from "ethers";
import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

const ZeroState =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZeroAddress = "0x0000000000000000000000000000000000000000";
const FirstAddress = "0x0000000000000000000000000000000000000001";

describe("SecretDelay", async () => {
  const baseSetup = deployments.createFixture(async () => {
    await deployments.fixture();
    const Avatar = await hre.ethers.getContractFactory("TestAvatar");
    const avatar = await Avatar.deploy();
    const Mock = await hre.ethers.getContractFactory("MockContract");
    const mock = await Mock.deploy();
    return { Avatar, avatar, mock };
  });

  const setupTestWithTestAvatar = deployments.createFixture(async () => {
    const base = await baseSetup();
    const Modifier = await hre.ethers.getContractFactory("SecretDelay");
    const modifier = await Modifier.deploy(
      base.avatar.address,
      base.avatar.address,
      base.avatar.address,
      0,
      "0x1337"
    );
    return { ...base, Modifier, modifier };
  });

  const [user1, user2] = waffle.provider.getWallets();

  describe("setUp()", async () => {
    it("throws if not enough time between txCooldown and txExpiration", async () => {
      const Module = await hre.ethers.getContractFactory("SecretDelay");
      await expect(
        Module.deploy(ZeroAddress, FirstAddress, FirstAddress, 1, 59)
      ).to.be.revertedWith("Expiratition must be 0 or at least 60 seconds");
    });

    it("throws if avatar is zero address", async () => {
      const Module = await hre.ethers.getContractFactory("SecretDelay");
      await expect(
        Module.deploy(ZeroAddress, ZeroAddress, FirstAddress, 1, 0)
      ).to.be.revertedWith("Avatar can not be zero address");
    });

    it("throws if target is zero address", async () => {
      const Module = await hre.ethers.getContractFactory("SecretDelay");
      await expect(
        Module.deploy(ZeroAddress, FirstAddress, ZeroAddress, 1, 0)
      ).to.be.revertedWith("Target can not be zero address");
    });

    it("txExpiration can be 0", async () => {
      const Module = await hre.ethers.getContractFactory("SecretDelay");
      await Module.deploy(user1.address, user1.address, user1.address, 1, 0);
    });

    it("should emit event because of successful set up", async () => {
      const Module = await hre.ethers.getContractFactory("SecretDelay");
      const module = await Module.deploy(
        user1.address,
        user1.address,
        user1.address,
        1,
        0
      );
      await module.deployed();
      await expect(module.deployTransaction)
        .to.emit(module, "DelaySetup")
        .withArgs(user1.address, user1.address, user1.address, user1.address);
    });
  });

  describe("disableModule()", async () => {
    it("throws if not authorized", async () => {
      const { modifier } = await setupTestWithTestAvatar();
      await expect(
        modifier.disableModule(FirstAddress, user1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("throws if module is null or sentinel", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const disable = await modifier.populateTransaction.disableModule(
        FirstAddress,
        FirstAddress
      );
      await expect(
        avatar.exec(modifier.address, 0, disable.data)
      ).to.be.revertedWith("Invalid module");
    });

    it("throws if module is not added ", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const disable = await modifier.populateTransaction.disableModule(
        ZeroAddress,
        user1.address
      );
      await expect(
        avatar.exec(modifier.address, 0, disable.data)
      ).to.be.revertedWith("Module already disabled");
    });

    it("disables a module()", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const enable = await modifier.populateTransaction.enableModule(
        user1.address
      );
      const disable = await modifier.populateTransaction.disableModule(
        FirstAddress,
        user1.address
      );

      await avatar.exec(modifier.address, 0, enable.data);
      await expect(await modifier.isModuleEnabled(user1.address)).to.be.equals(
        true
      );
      await avatar.exec(modifier.address, 0, disable.data);
      await expect(await modifier.isModuleEnabled(user1.address)).to.be.equals(
        false
      );
    });
  });

  describe("enableModule()", async () => {
    it("throws if not authorized", async () => {
      const { modifier } = await setupTestWithTestAvatar();
      await expect(modifier.enableModule(user1.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("throws because module is already enabled", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const enable = await modifier.populateTransaction.enableModule(
        user1.address
      );

      await avatar.exec(modifier.address, 0, enable.data);
      await expect(
        avatar.exec(modifier.address, 0, enable.data)
      ).to.be.revertedWith("Module already enabled");
    });

    it("throws because module is invalid ", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const enable = await modifier.populateTransaction.enableModule(
        FirstAddress
      );

      await expect(
        avatar.exec(modifier.address, 0, enable.data)
      ).to.be.revertedWith("Invalid module");
    });

    it("enables a module", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const enable = await modifier.populateTransaction.enableModule(
        user1.address
      );

      await avatar.exec(modifier.address, 0, enable.data);
      await expect(await modifier.isModuleEnabled(user1.address)).to.be.equals(
        true
      );
      await expect(
        await modifier.getModulesPaginated(FirstAddress, 10)
      ).to.be.deep.equal([[user1.address], FirstAddress]);
    });
  });

  describe("enqueueSecretTx()", async () => {
    let avatar: Contract, modifier: Contract, hashedTx: string, salt: number;
    const testUri = "ipfsHash";

    beforeEach("setup contracts", async () => {
      ({ avatar, modifier } = await setupTestWithTestAvatar());
    });

    beforeEach("hash transaction w/ current salt", async () => {
      salt = await modifier.salt();
      hashedTx = ethers.utils.solidityKeccak256(
        ["address", "uint256", "bytes", "uint8", "uint256"],
        [user1.address, 0, "0x", 0, salt]
      );
    });

    it("throws if not authorized", async () => {
      await expect(
        modifier.enqueueSecretTx(hashedTx, testUri)
      ).to.be.revertedWith("Module not authorized");
    });

    it("increments queuePointer", async () => {
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);
      let queuePointer = await modifier.queuePointer();

      await expect(queuePointer._hex).to.be.equals("0x00");
      await modifier.enqueueSecretTx(hashedTx, testUri);
      queuePointer = await modifier.queuePointer();
      await expect(queuePointer._hex).to.be.equals("0x01");
    });

    it("sets txHash", async () => {
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      let txHash = await modifier.getSecretTransactionHash(
        user1.address,
        0,
        "0x",
        0,
        salt
      );

      await expect(await modifier.getTxHash(0)).to.be.equals(ZeroState);
      await modifier.enqueueSecretTx(hashedTx, testUri);
      await expect(await modifier.getTxHash(0)).to.be.equals(txHash);
    });

    it("sets txCreatedAt", async () => {
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      let expectedTimestamp = await modifier.getTxCreatedAt(0);
      await avatar.exec(modifier.address, 0, tx.data);

      await expect(expectedTimestamp._hex).to.be.equals("0x00");
      let receipt = await modifier.enqueueSecretTx(hashedTx, testUri);

      let blockNumber = receipt.blockNumber;

      let block = await hre.network.provider.send("eth_getBlockByNumber", [
        "latest",
        false,
      ]);

      expectedTimestamp = await modifier.getTxCreatedAt(0);
      await expect(block.timestamp).to.be.equals(expectedTimestamp._hex);
    });

    it("emits transaction details", async () => {
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);
      const expectedQueuePointer = await modifier.queuePointer;

      await expect(await modifier.enqueueSecretTx(hashedTx, testUri))
        .to.emit(modifier, "SecretTransactionAdded")
        .withArgs(expectedQueuePointer, hashedTx, testUri, salt);
    });

    it("increments the salt", async () => {
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);
      await modifier.enqueueSecretTx(hashedTx, testUri);

      expect(await modifier.salt()).to.equal(salt + 1);
    });
  });

  describe("setTxCooldown()", async () => {
    it("throws if not authorized", async () => {
      const { modifier } = await setupTestWithTestAvatar();
      await expect(modifier.setTxCooldown(42)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("sets cooldown", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.setTxCooldown(43);
      let cooldown = await modifier.txCooldown();

      await expect(cooldown._hex).to.be.equals("0x00");
      await avatar.exec(modifier.address, 0, tx.data);
      cooldown = await modifier.txCooldown();
      await expect(cooldown._hex).to.be.equals("0x2b");
    });
  });

  describe("setTxExpiration()", async () => {
    it("throws if not authorized", async () => {
      const { modifier } = await setupTestWithTestAvatar();
      await expect(modifier.setTxExpiration(42)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("thows if expiration is less than 60 seconds.", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.setTxExpiration(59);

      await expect(
        avatar.exec(modifier.address, 0, tx.data)
      ).to.be.revertedWith("Expiratition must be 0 or at least 60 seconds");
    });

    it("sets expiration", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.setTxExpiration("0x031337");
      let expiration = await modifier.txExpiration();

      await expect(expiration._hex).to.be.equals("0x1337");
      await avatar.exec(modifier.address, 0, tx.data);
      expiration = await modifier.txExpiration();
      await expect(expiration._hex).to.be.equals("0x031337");
    });
  });

  describe("vetoNextTransactions()", async () => {
    it("throws if not authorized", async () => {
      const { modifier } = await setupTestWithTestAvatar();
      await expect(modifier.vetoNextTransactions(42)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("reverts when trying to veto zero transcations", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx2 = await modifier.populateTransaction.vetoNextTransactions(0);

      await expect(
        avatar.exec(modifier.address, 0, tx2.data)
      ).to.be.revertedWith("Atleast veto one transaction");
    });

    it("thows if nonce is more than queuePointer + 1.", async () => {
      // queue index starts from 0
      const transactionsInQueue = 3;
      const transactionsToVeto = transactionsInQueue + 1;
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);

      // add a user as a module to simulate transactions coming from BAC
      await avatar.exec(modifier.address, 0, tx.data);

      // enqueues two proposal
      for (let i = 0; i < transactionsInQueue; i++) {
        await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      }

      // generate transaction data to veto transactions more than transactions in queue
      // queue index starts from 0
      const tx2 = await modifier.populateTransaction.vetoNextTransactions(
        transactionsToVeto
      );

      await expect(
        avatar.exec(modifier.address, 0, tx2.data)
      ).to.be.revertedWith("Cannot be higher than queuePointer");
    });

    it("Vetos transaction", async () => {
      const transactionsInQueue = 3;
      const transactionsToVeto = transactionsInQueue;
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      let txNonce = await modifier.txNonce();

      expect(txNonce._hex).to.be.equals("0x00");

      await avatar.exec(modifier.address, 0, tx.data);

      for (let i = 0; i < transactionsInQueue; i++) {
        await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      }

      const tx2 = await modifier.populateTransaction.vetoNextTransactions(
        transactionsToVeto
      );

      await expect(avatar.exec(modifier.address, 0, tx2.data))
        .to.emit(modifier, "TransactionsVetoed")
        .withArgs(txNonce, transactionsToVeto);
      txNonce = await modifier.txNonce();
      expect(txNonce).to.be.equals(transactionsInQueue);
    });
  });

  describe("execTransactionFromModule()", async () => {
    it("throws if not authorized", async () => {
      const { modifier } = await setupTestWithTestAvatar();
      await expect(
        modifier.execTransactionFromModule(user1.address, 0, "0x", 0)
      ).to.be.revertedWith("Module not authorized");
    });

    it("increments queuePointer", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);
      let queuePointer = await modifier.queuePointer();

      await expect(queuePointer._hex).to.be.equals("0x00");
      await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      queuePointer = await modifier.queuePointer();
      await expect(queuePointer._hex).to.be.equals("0x01");
    });

    it("sets txHash", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      let txHash = await modifier.getTransactionHash(user1.address, 0, "0x", 0);

      await expect(await modifier.getTxHash(0)).to.be.equals(ZeroState);
      await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      await expect(await modifier.getTxHash(0)).to.be.equals(txHash);
    });

    it("sets txCreatedAt", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      let expectedTimestamp = await modifier.getTxCreatedAt(0);
      await avatar.exec(modifier.address, 0, tx.data);

      await expect(expectedTimestamp._hex).to.be.equals("0x00");
      let receipt = await modifier.execTransactionFromModule(
        user1.address,
        0,
        "0x",
        0
      );
      let blockNumber = receipt.blockNumber;

      let block = await hre.network.provider.send("eth_getBlockByNumber", [
        "latest",
        false,
      ]);

      expectedTimestamp = await modifier.getTxCreatedAt(0);
      await expect(block.timestamp).to.be.equals(expectedTimestamp._hex);
    });

    it("emits transaction details", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);
      const expectedQueuePointer = await modifier.queuePointer;

      await expect(
        modifier.execTransactionFromModule(user1.address, 42, "0x", 0)
      )
        .to.emit(modifier, "TransactionAdded")
        .withArgs(
          expectedQueuePointer,
          await modifier.getTransactionHash(user1.address, 42, "0x", 0),
          user1.address,
          42,
          "0x",
          0
        );
    });
  });

  describe("executeNextTx()", async () => {
    it("throws if there is nothing in queue", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      await expect(
        modifier.executeNextTx(user1.address, 42, "0x", 0)
      ).to.be.revertedWith("Transaction queue is empty");
    });

    it("throws if cooldown has not passed", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      let tx = await modifier.populateTransaction.setTxCooldown(42);
      await avatar.exec(modifier.address, 0, tx.data);

      tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      await modifier.execTransactionFromModule(user1.address, 42, "0x", 0);
      await expect(
        modifier.executeNextTx(user1.address, 42, "0x", 0)
      ).to.be.revertedWith("Transaction is still in cooldown");
    });

    it("throws if transaction has expired", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      await avatar.setModule(modifier.address);
      await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      let expiry = await modifier.txCreatedAt(0);
      await hre.network.provider.send("evm_setNextBlockTimestamp", [
        4242424242,
      ]);
      await expect(
        modifier.executeNextTx(user1.address, 0, "0x", 0)
      ).to.be.revertedWith("Transaction expired");
    });

    it("throws if transaction hashes do not match", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      await avatar.setModule(modifier.address);
      await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      let block = await hre.network.provider.send("eth_getBlockByNumber", [
        "latest",
        false,
      ]);
      let timestamp = parseInt(block.timestamp) + 100;
      await hre.network.provider.send("evm_setNextBlockTimestamp", [timestamp]);
      await expect(
        modifier.executeNextTx(user1.address, 1, "0x", 0)
      ).to.be.revertedWith("Transaction hashes do not match");
    });

    it("throws if transaction module transaction throws", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      await avatar.setModule(modifier.address);
      await modifier.execTransactionFromModule(user1.address, 1, "0x", 0);
      let block = await hre.network.provider.send("eth_getBlockByNumber", [
        "latest",
        false,
      ]);
      let timestamp = parseInt(block.timestamp) + 100;
      await hre.network.provider.send("evm_setNextBlockTimestamp", [timestamp]);
      await expect(
        modifier.executeNextTx(user1.address, 1, "0x", 0)
      ).to.be.revertedWith("Module transaction failed");
    });

    it("executes transaction", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      await avatar.setModule(modifier.address);
      await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      let block = await hre.network.provider.send("eth_getBlockByNumber", [
        "latest",
        false,
      ]);
      let timestamp = parseInt(block.timestamp) + 100;
      await hre.network.provider.send("evm_setNextBlockTimestamp", [timestamp]);
      await expect(modifier.executeNextTx(user1.address, 0, "0x", 0));
    });
  });

  describe("executeNextSecretTx()", () => {
    let avatar: Contract, modifier: Contract, salt: number;

    const ethAmount = 420;
    const testUri = "ipfsHash";

    beforeEach("setup contracts", async () => {
      ({ avatar, modifier } = await setupTestWithTestAvatar());
      salt = await modifier.salt();
      await avatar.setModule(modifier.address);
      await avatar.exec(
        modifier.address,
        0,
        (await modifier.populateTransaction.enableModule(user1.address)).data
      );
      await user1.sendTransaction({ to: avatar.address, value: ethAmount });
    });

    beforeEach("enqueue secret tx", async () => {
      const hashedTx = ethers.utils.solidityKeccak256(
        ["address", "uint256", "bytes", "uint8", "uint256"],
        [FirstAddress, ethAmount, "0x", 0, salt]
      );
      await modifier.enqueueSecretTx(hashedTx, testUri);
    });

    it("reverts if hashes don't match: 'Transaction hashes do not match'", async () => {
      const wrongSalt = 69;

      await expect(
        modifier.executeNextSecretTx(
          FirstAddress,
          ethAmount,
          "0x",
          0,
          wrongSalt
        )
      ).to.be.revertedWith("Transaction hashes do not match");
    });

    it("executes the transaction", async () => {
      const { provider } = ethers;
      await modifier.executeNextSecretTx(
        FirstAddress,
        ethAmount,
        "0x",
        0,
        salt
      );
      const balance = await provider.getBalance(FirstAddress);

      expect(balance).to.equal(ethAmount);
    });
  });

  describe("skipExpired()", async () => {
    it("should skip to the next nonce that has not yet expired", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      await avatar.setModule(modifier.address);
      for (let i = 0; i < 3; i++) {
        await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      }
      let block = await hre.network.provider.send("eth_getBlockByNumber", [
        "latest",
        false,
      ]);
      let timestamp = parseInt(block.timestamp) + 424242;
      await hre.network.provider.send("evm_setNextBlockTimestamp", [timestamp]);
      await expect(
        modifier.executeNextTx(user1.address, 0, "0x", 0)
      ).to.be.revertedWith("Transaction expired");
      for (let i = 0; i < 2; i++) {
        await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      }
      await expect(modifier.skipExpired());
      let txNonce = await modifier.txNonce();
      let queuePointer = await modifier.queuePointer();
      await expect(parseInt(txNonce._hex)).to.be.equals(3);
      await expect(parseInt(queuePointer._hex)).to.be.equals(5);
      await expect(modifier.executeNextTx(user1.address, 0, "0x", 0));
    });
  });
});
