import { expect } from "chai";
import hre, { deployments, waffle, ethers } from "hardhat";
import "@nomiclabs/hardhat-ethers";
import { Contract, PopulatedTransaction, Transaction } from "ethers";

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

  const setupTestContract = async (address: string) => {
    const TestContract = await ethers.getContractFactory("TestContract");
    const testContract = await TestContract.deploy();
    await testContract.transferOwnership(address);

    return testContract;
  };

  const [user1] = waffle.provider.getWallets();

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

  describe("setTxNonce()", async () => {
    it("throws if not authorized", async () => {
      const { modifier } = await setupTestWithTestAvatar();
      await expect(modifier.setTxNonce(42)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("thows if nonce is less than current nonce.", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.setTxExpiration(60);
      const tx2 = await modifier.populateTransaction.setTxNonce(0);
      await expect(avatar.exec(modifier.address, 0, tx.data));

      await expect(
        avatar.exec(modifier.address, 0, tx2.data)
      ).to.be.revertedWith("New nonce must be higher than current txNonce");
    });

    it("thows if nonce is more than queueNonce + 1.", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      const tx2 = await modifier.populateTransaction.setTxNonce(42);
      await expect(avatar.exec(modifier.address, 0, tx.data));
      await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);

      await expect(
        avatar.exec(modifier.address, 0, tx2.data)
      ).to.be.revertedWith("Cannot be higher than queueNonce");
    });

    it("sets nonce", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      const tx2 = await modifier.populateTransaction.setTxNonce(1);
      let txNonce = await modifier.txNonce();

      await expect(txNonce._hex).to.be.equals("0x00");
      await avatar.exec(modifier.address, 0, tx.data);
      await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      await avatar.exec(modifier.address, 0, tx2.data);
      txNonce = await modifier.txNonce();

      await expect(txNonce._hex).to.be.equals("0x01");
    });

    context("with two enqueued txs", () => {
      let testContract: Contract, modifier: Contract, avatar: Contract;

      beforeEach("enqueue and approve two transactions", async () => {
        ({ avatar, modifier } = await setupTestWithTestAvatar());
        testContract = await setupTestContract(avatar.address);

        let tx = await modifier.populateTransaction.setTxCooldown(42);
        await avatar.exec(modifier.address, 0, tx.data);

        tx = await modifier.populateTransaction.enableModule(user1.address);
        await avatar.exec(modifier.address, 0, tx.data);

        await avatar.setModule(modifier.address);

        const tx2 = await testContract.populateTransaction.pushButton();
        await modifier.execTransactionFromModule(
          testContract.address,
          0,
          tx2.data,
          0
        );
        await modifier.execTransactionFromModule(
          testContract.address,
          0,
          tx2.data,
          0
        );
      });

      context("with no approved tx", () => {
        it("sets txNonce", async () => {
          const tx = await modifier.populateTransaction.setTxNonce(1);
          await avatar.exec(modifier.address, 0, tx.data);

          expect(await modifier.txNonce()).to.equal(1);
        });
      });

      context("with two approved tx", () => {
        it("decrements number of approved transactions", async () => {
          let tx3 = await modifier.populateTransaction.setTxNonceAndApprove(
            0,
            2
          );
          await avatar.exec(modifier.address, 0, tx3.data);

          const tx = await modifier.populateTransaction.setTxNonce(1);
          await avatar.exec(modifier.address, 0, tx.data);

          expect(await modifier.approved()).to.equal(1);
        });
      });

      context("with two approved tx and jump to end of queue", () => {
        it("sets number of approved to zero", async () => {
          let tx3 = await modifier.populateTransaction.setTxNonceAndApprove(
            0,
            1
          );
          await avatar.exec(modifier.address, 0, tx3.data);

          const tx = await modifier.populateTransaction.setTxNonce(2);
          await avatar.exec(modifier.address, 0, tx.data);

          expect(await modifier.approved()).to.equal(0);
        });
      });
    });
  });

  describe("execTransactionFromModule()", async () => {
    it("throws if not authorized", async () => {
      const { modifier } = await setupTestWithTestAvatar();
      await expect(
        modifier.execTransactionFromModule(user1.address, 0, "0x", 0)
      ).to.be.revertedWith("Module not authorized");
    });

    it("increments queueNonce", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);
      let queueNonce = await modifier.queueNonce();

      await expect(queueNonce._hex).to.be.equals("0x00");
      await modifier.execTransactionFromModule(user1.address, 0, "0x", 0);
      queueNonce = await modifier.queueNonce();
      await expect(queueNonce._hex).to.be.equals("0x01");
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
      const expectedQueueNonce = await modifier.queueNonce;

      await expect(
        modifier.execTransactionFromModule(user1.address, 42, "0x", 0)
      )
        .to.emit(modifier, "TransactionAdded")
        .withArgs(
          expectedQueueNonce,
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

    context("when transaction is approved", () => {
      let testContract: Contract, modifier: Contract, avatar: Contract;
      let pushButtonTx: PopulatedTransaction;

      beforeEach("enqueue two tx", async () => {
        ({ avatar, modifier } = await setupTestWithTestAvatar());
        testContract = await setupTestContract(avatar.address);

        let tx = await modifier.populateTransaction.setTxCooldown(42);
        await avatar.exec(modifier.address, 0, tx.data);

        tx = await modifier.populateTransaction.enableModule(user1.address);
        await avatar.exec(modifier.address, 0, tx.data);

        await avatar.setModule(modifier.address);

        pushButtonTx = await testContract.populateTransaction.pushButton();
        await modifier.execTransactionFromModule(
          testContract.address,
          0,
          pushButtonTx.data,
          0
        );
        await modifier.execTransactionFromModule(
          testContract.address,
          0,
          pushButtonTx.data,
          0
        );

        let tx3 = await modifier.populateTransaction.approveNext(1);
        await avatar.exec(modifier.address, 0, tx3.data);
      });

      it("executes", async () => {
        await expect(
          modifier.executeNextTx(testContract.address, 0, pushButtonTx.data, 0)
        ).to.emit(testContract, "ButtonPushed");
      });

      it("decrements approved transactions", async () => {
        await modifier.executeNextTx(
          testContract.address,
          0,
          pushButtonTx.data,
          0
        );

        expect(await modifier.approved()).to.equal(0);
      });
    });

    // it("executes during cooldown if transaction had been approved", async () => {
    //   const { avatar, modifier } = await setupTestWithTestAvatar();

    //   const TestContract = await ethers.getContractFactory("TestContract");
    //   const testContract = await TestContract.deploy();
    //   await testContract.transferOwnership(avatar.address);

    //   let tx = await modifier.populateTransaction.setTxCooldown(42);
    //   await avatar.exec(modifier.address, 0, tx.data);

    //   tx = await modifier.populateTransaction.enableModule(user1.address);
    //   await avatar.exec(modifier.address, 0, tx.data);

    //   const tx2 = await testContract.populateTransaction.pushButton();
    //   await modifier.execTransactionFromModule(
    //     testContract.address,
    //     0,
    //     tx2.data,
    //     0
    //   );
    //   await expect(
    //     modifier.executeNextTx(user1.address, 42, "0x", 0)
    //   ).to.be.revertedWith("Transaction is still in cooldown");

    //   let tx3 = await modifier.populateTransaction.setTxNonceAndApprove(0);
    //   await avatar.exec(modifier.address, 0, tx3.data);

    //   await avatar.setModule(modifier.address);

    //   await expect(
    //     modifier.executeNextTx(testContract.address, 0, tx2.data, 0)
    //   ).to.emit(testContract, "ButtonPushed");
    // });

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
      let queueNonce = await modifier.queueNonce();
      await expect(parseInt(txNonce._hex)).to.be.equals(3);
      await expect(parseInt(queueNonce._hex)).to.be.equals(5);
      await expect(modifier.executeNextTx(user1.address, 0, "0x", 0));
    });
  });

  describe("setTxNonceAndApprove()", async () => {
    it("throws if not authorized", async () => {
      const { modifier } = await setupTestWithTestAvatar();
      await expect(modifier.setTxNonceAndApprove(42, 1)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("reverts if attempting to skip all transactions", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const tx = await modifier.populateTransaction.enableModule(user1.address);
      const tx2 = await modifier.populateTransaction.setTxNonceAndApprove(1, 1);

      expect(await modifier.approved()).to.equal(0);

      await avatar.exec(modifier.address, 0, tx.data);
      // await avatar.exec(modifier.address, 0, tx2.data);

      await expect(
        avatar.exec(modifier.address, 0, tx2.data)
      ).to.be.revertedWith("Cannot skip all transactions");
    });

    it("increases the txNonce and resets approved when executed", async () => {
      const { avatar, modifier } = await setupTestWithTestAvatar();
      const TestContract = await ethers.getContractFactory("TestContract");
      const testContract = await TestContract.deploy();
      await testContract.transferOwnership(avatar.address);

      let tx = await modifier.populateTransaction.setTxCooldown(42);
      await avatar.exec(modifier.address, 0, tx.data);

      tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      const tx2 = await testContract.populateTransaction.pushButton();
      await modifier.execTransactionFromModule(
        testContract.address,
        0,
        tx2.data,
        0
      );

      let tx3 = await modifier.populateTransaction.setTxNonceAndApprove(0, 1);
      await avatar.exec(modifier.address, 0, tx3.data);

      await avatar.setModule(modifier.address);

      await expect(
        modifier.executeNextTx(testContract.address, 0, tx2.data, 0)
      ).to.emit(testContract, "ButtonPushed");

      expect(await modifier.txNonce()).to.be.equal(await modifier.queueNonce());
      expect(await modifier.approved()).to.equal(0);
    });

    context("with two enqueued transactions", () => {
      let testContract: Contract, modifier: Contract, avatar: Contract;

      let pushButtonTx: PopulatedTransaction;

      beforeEach("enqueue two tx and approve second tx", async () => {
        ({ avatar, modifier } = await setupTestWithTestAvatar());
        testContract = await setupTestContract(avatar.address);

        let tx = await modifier.populateTransaction.setTxCooldown(42);
        await avatar.exec(modifier.address, 0, tx.data);

        tx = await modifier.populateTransaction.enableModule(user1.address);
        await avatar.exec(modifier.address, 0, tx.data);

        await avatar.setModule(modifier.address);

        pushButtonTx = await testContract.populateTransaction.pushButton();
        await modifier.execTransactionFromModule(
          testContract.address,
          0,
          pushButtonTx.data,
          0
        );
        await modifier.execTransactionFromModule(
          testContract.address,
          0,
          pushButtonTx.data,
          0
        );

        let tx3 = await modifier.populateTransaction.setTxNonceAndApprove(1, 1);
        await avatar.exec(modifier.address, 0, tx3.data);
      });

      it("executes the second tx", async () => {
        await expect(
          modifier.executeNextTx(testContract.address, 0, pushButtonTx.data, 0)
        ).to.emit(testContract, "ButtonPushed");
        expect(await modifier.queueNonce()).to.equal(2);
        expect(await modifier.txNonce()).to.equal(2);
      });
    });
  });

  describe("approveNext()", async () => {
    let testContract: Contract, modifier: Contract, avatar: Contract;

    let pushButtonTx: PopulatedTransaction;

    beforeEach("enqueue two tx", async () => {
      ({ avatar, modifier } = await setupTestWithTestAvatar());
      testContract = await setupTestContract(avatar.address);

      let tx = await modifier.populateTransaction.setTxCooldown(42);
      await avatar.exec(modifier.address, 0, tx.data);

      tx = await modifier.populateTransaction.enableModule(user1.address);
      await avatar.exec(modifier.address, 0, tx.data);

      await avatar.setModule(modifier.address);

      pushButtonTx = await testContract.populateTransaction.pushButton();
      await modifier.execTransactionFromModule(
        testContract.address,
        0,
        pushButtonTx.data,
        0
      );
      await modifier.execTransactionFromModule(
        testContract.address,
        0,
        pushButtonTx.data,
        0
      );
    });

    context("with parameter is zero", () => {
      it("reverts 'Must approve at least one tx'", async () => {
        let tx = await modifier.populateTransaction.approveNext(0);

        await expect(
          avatar.exec(modifier.address, 0, tx.data)
        ).to.be.revertedWith("Must approve at least one tx");
      });
    });

    context("when approving more tx than enqueued", () => {
      it("reverts 'Cannot approve unknown tx'", async () => {
        let tx = await modifier.populateTransaction.approveNext(3);

        await expect(
          avatar.exec(modifier.address, 0, tx.data)
        ).to.be.revertedWith("Cannot approve unknown tx");
      });
    });

    it("sets approved", async () => {
      let tx = await modifier.populateTransaction.approveNext(2);

      await avatar.exec(modifier.address, 0, tx.data);
      expect(await modifier.approved()).to.equal(2);
    });
  });
});
