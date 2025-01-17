import API from './API.js';
import { Buffer } from 'buffer';
import { HDKey } from '@scure/bip32';
import monerolib from 'monerolib';

import * as symbols from './symbols.js';
import {
  InvalidTransactionIDError,
  NotYourTransactionError,
  TransactionAlreadyAddedError,
  UnknownTransactionError,
} from './errors.js';

import {
  Amount,
  CsWallet,
  Transaction,
  errors,
} from '@coinspace/cs-common';

const TXS_CHUNK = 50;
const RING_COUNT = 16;
const MIXIN = RING_COUNT - 1;
// tx pub key + payment id + 3 * additional pub keys
// 1 + 32 + 1 + 10 + 1 + 1 + 32 + 32 + 32
const TX_EXTRA_SIZE = 142;

class MoneroTransaction extends Transaction {
  constructor(data) {
    super(data);
  }

  get url() {
    return `https://blockchair.com/monero/transaction/${this.id}?from=coinwallet`;
  }
}

export default class MoneroWallet extends CsWallet {
  #api;
  #viewOnlyWallet;
  #nettype;
  #wasmPath = 'node_modules/@coinspace/monero-core-js/build/MoneroCoreJS.wasm';
  #txs = [];
  #outputs = new Map();
  #balance = 0n;
  #cachedKeyImages;
  #maxTxInputs;
  #minConf = 10;
  #minConfCoinbase = 60;
  // https://github.com/monero-project/monero/blob/v0.17.2.0/src/wallet/wallet2.cpp#L10924
  // but we use 1 atom to solve calculation issue
  #dustThreshold = 1n;
  #feeMultipliers = {
    [CsWallet.FEE_RATE_DEFAULT]: 1,
    [MoneroWallet.FEE_RATE_FASTEST]: 25,
  };
  #moneroCoreJS;

  // memorized functions
  #getFeeConfig;
  #getUnspentsForTx;
  #estimateMaxAmount;
  #selectUtxos;
  #loadTxs;

  static ADDRESS_TYPE_ADDRESS = symbols.ADDRESS_TYPE_ADDRESS;
  static ADDRESS_TYPE_SUBADDRESS = symbols.ADDRESS_TYPE_SUBADDRESS;

  static FEE_RATE_FASTEST = symbols.FEE_RATE_FASTEST;

  static HIDDEN_ADDRESS = symbols.HIDDEN_ADDRESS;

  get #txIds() {
    return this.#txs.map(item => item.txId.toLowerCase());
  }

  get isCsFeeSupported() {
    return true;
  }

  get isUnaliasSupported() {
    return true;
  }

  get addressTypes() {
    return [
      MoneroWallet.ADDRESS_TYPE_ADDRESS,
      MoneroWallet.ADDRESS_TYPE_SUBADDRESS,
    ];
  }

  get feeRates() {
    return [
      CsWallet.FEE_RATE_DEFAULT,
      MoneroWallet.FEE_RATE_FASTEST,
    ];
  }

  get balance() {
    return new Amount(this.#balance, this.crypto.decimals);
  }

  get address() {
    return this.#getAddress(this.addressType).toString();
  }

  get dummyExchangeDepositAddress() {
    return '8491bP8VHZh6qjnNk2AJshiqewgv5DWYqNQeJmscC8zyiRg71PSFMzPWz4458UdVQYPx8damiUpSnEhdksuG5447PdWsber';
  }

  get blocktime() {
    return 120;
  }

  constructor(options = {}) {
    super(options);
    this.#api = new API(this);
    if (options.wasm) {
      this.#wasmPath = options.wasm;
    }
    this.#maxTxInputs = options.maxTxInputs || 292;
    this.#nettype = options.development ? 'regtest' : 'mainnet';

    this.#getFeeConfig = this.memoize(this._getFeeConfig);
    this.#getUnspentsForTx = this.memoize(this._getUnspentsForTx);
    this.#estimateMaxAmount = this.memoize(this._estimateMaxAmount);
    this.#selectUtxos = this.memoize(this._selectUtxos);
    this.#loadTxs = this.memoize(this._loadTxs);
  }

  async create(seed) {
    this.typeSeed(seed);
    this.state = CsWallet.STATE_INITIALIZING;
    const wallet = this.#walletFromSeed(seed);
    this.#viewOnlyWallet = this.#walletFromKeys(
      wallet.publicSpendKey,
      wallet.secretViewKey
    );
    this.#init();
    this.state = CsWallet.STATE_INITIALIZED;
  }

  async open(publicKey) {
    this.typePublicKey(publicKey);
    this.state = CsWallet.STATE_INITIALIZING;
    this.#viewOnlyWallet = this.#walletFromKeys(
      Buffer.from(publicKey.data.publicSpendKey, 'hex'),
      Buffer.from(publicKey.data.secretViewKey, 'hex')
    );
    this.#init();
    this.state = CsWallet.STATE_INITIALIZED;
  }

  #init() {
    this.#balance = BigInt(this.storage.get('balance') || 0);
  }

  async cleanup() {
    await super.cleanup();
    this.memoizeClear(this.#getFeeConfig);
    this.memoizeClear(this.#getUnspentsForTx);
    this.memoizeClear(this.#estimateMaxAmount);
    this.memoizeClear(this.#selectUtxos);
    this.memoizeClear(this.#loadTxs);
  }

  _getUnspentsForTx(unconfirmed = false) {
    return Array.from(this.#outputs.values())
      .filter(item => item.spent !== true && (unconfirmed || item.confirmed === true))
      .sort((a, b) => {
        if (a.amount > b.amount) {
          return -1;
        }
        if (a.amount < b.amount) {
          return 1;
        }
        return 0;
      })
      .slice(0, this.#maxTxInputs);
  }

  #calculateBalance() {
    return Array.from(this.#outputs.values())
      .filter(item => item.spent !== true)
      .reduce((balance, item) => balance + item.amount, 0n);
  }

  #walletFromSeed(seed) {
    const hdkey = HDKey.fromMasterSeed(Buffer.from(seed, 'hex'));
    // https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
    // https://github.com/satoshilabs/slips/blob/master/slip-0044.md
    const base = hdkey.derive("m/44'/128'/0'");
    return new monerolib.Wallet({
      seed: Buffer.from(base.privateKey),
      nettype: this.#nettype,
    });
  }

  #walletFromKeys(publicSpendKey, secretViewKey) {
    return new monerolib.Wallet({
      publicSpendKey,
      secretViewKey,
      nettype: this.#nettype,
    });
  }

  #initMoneroCoreJS() {
    if (!this.#moneroCoreJS) {
      this.#moneroCoreJS = import(
        /* webpackChunkName: '@coinspace/monero-core-js' */
        '@coinspace/monero-core-js'
      ).then((moneroCoreJS) => {
        return moneroCoreJS.default(this.#wasmPath);
      });
    }
    return this.#moneroCoreJS;
  }

  async load() {
    this.state = CsWallet.STATE_LOADING;
    try {
      this.#cachedKeyImages = this.storage.get('keyImages') || {};
      const txIds = [...new Set((this.storage.get('txIds') || [])
        .map((item) => item.toLowerCase()))];
      this.#txs = await this.#loadTxs(txIds);
      for (const tx of this.#txs) {
        this.#processTx(tx);
      }
      this.storage.set('txIds', this.#txIds);
      if (!this.storage.get('createdAt')) {
        this.storage.set('createdAt', Date.now());
      }
      this.#balance = this.#calculateBalance();
      this.storage.set('balance', this.#balance.toString());
      await this.storage.save();
      this.state = CsWallet.STATE_LOADED;
    } catch (err) {
      this.state = CsWallet.STATE_ERROR;
      throw err;
    }
  }

  async _getFeeConfig() {
    return this.#api.feeConfig();
  }

  async _loadTxs(txIds) {
    const txs = [];
    for (let i = 0; i < Math.ceil(txIds.length / TXS_CHUNK); i++) {
      const ids = txIds.slice(i * TXS_CHUNK, i * TXS_CHUNK + TXS_CHUNK);
      txs.push(await this.#api.transactions(ids));
    }
    return txs.flat().sort((a, b) => a.time - b.time);
  }

  async #loadRandomOutputs(count=16, height) {
    return this.#api.randomOutputs(count, height);
  }

  #processTx(tx, seed) {
    const wallet = seed ? this.#walletFromSeed(seed) : this.#viewOnlyWallet;
    let outputValue = 0n;
    let inputValue = 0n;
    let from;
    let to;

    tx.confirmed = tx.coinbase
      ? tx.confirmations >= this.#minConfCoinbase
      : tx.confirmations >= this.#minConf;

    tx.minConfirmations = tx.coinbase ? this.#minConfCoinbase : this.#minConf;

    const mainDerivation = monerolib.cryptoUtil.generateKeyDerivation(
      Buffer.from(tx.txPubKey, 'hex'),
      wallet.secretViewKey
    );

    for (const output of tx.outs) {
      const items = [{
        derivation: mainDerivation,
        txPubKey: tx.txPubKey,
      }];

      if (output.additionalPubKey) {
        // additional derivation
        items.push({
          derivation: monerolib.cryptoUtil.generateKeyDerivation(
            Buffer.from(output.additionalPubKey, 'hex'),
            wallet.secretViewKey
          ),
          txPubKey: output.additionalPubKey,
        });
      }

      for (const address of this.#getAllAddresses()) {
        for (const item of items) {
          const pubKey = monerolib.cryptoUtil.derivePublicKey(item.derivation, output.index, address.publicSpendKey);
          if (pubKey.toString('hex') === output.targetKey) {
            if (output.rctType !== monerolib.ringct.RCTTypes.Null) {
              const rct = monerolib.ringct.decodeRct(
                { amount: output.ecdhInfoAmount, mask: output.ecdhInfoMask },
                output.outPk,
                output.rctType,
                output.index,
                item.derivation
              );
              output.amount = BigInt(rct.amount);
            } else {
              output.amount = BigInt(output.amount);
            }
            output.ours = true;
            output.address = address.toString();
            to = address.toString();
            output.addressIndex = address.index,
            tx.ours = true;
            outputValue = outputValue + output.amount;

            this.#outputs.set(`${tx.txId}:${output.targetKey}`, {
              txId: tx.txId,
              confirmed: tx.confirmed,
              // derivation and txPubKey
              ...item,
              ...output,
            });
          }
        }
        if (output.ours) {
          break;
        }
      }
    }

    for (const input of tx.ins) {
      input.amount = 0n;
      for (const keyOutput of input.keyOutputs) {
        if (this.#outputs.has(`${keyOutput.txId}:${keyOutput.targetKey}`)) {
          const output = this.#outputs.get(`${keyOutput.txId}:${keyOutput.targetKey}`);
          const address = wallet.getSubaddress(output.addressIndex.major, output.addressIndex.minor);
          const keyImage = this.#generateKeyImage(output.derivation, output.index, address);
          if (keyImage === input.keyImage) {
            // spent
            output.spent = true;
            tx.ours = true;
            // for tx history
            input.address = output.address;
            from = output.address;
            input.amount = output.amount;
            inputValue = inputValue + output.amount;
          }
        }
      }
    }

    tx.minerFee = BigInt(tx.fee || 0);
    tx.csFee = BigInt(tx.csfee || 0);
    tx.fee = tx.minerFee + tx.csFee;

    const amount = outputValue - inputValue;
    if (amount < 0n) {
      tx.amount = -1n * amount - tx.fee;
      tx.from = from;
    } else {
      tx.amount = amount;
      tx.to = to;
    }
    tx.isIncoming = amount > 0;
    tx.timestamp = tx.time * 1000;

    return tx.ours === true;
  }

  #transformTx(tx) {
    return new MoneroTransaction({
      status: tx.confirmed ? MoneroTransaction.STATUS_SUCCESS : MoneroTransaction.STATUS_PENDING,
      id: tx.txId,
      amount: new Amount(tx.amount, this.crypto.decimals),
      incoming: tx.isIncoming,
      from: tx.from || symbols.HIDDEN_ADDRESS,
      to: tx.to || symbols.HIDDEN_ADDRESS,
      fee: new Amount(tx.fee, this.crypto.decimals),
      timestamp: new Date(tx.timestamp),
      confirmations: tx.confirmations,
      minConfirmations: tx.minConfirmations,
      development: this.development,
    });
  }

  #generateKeyImage(derivation, index, address) {
    const key = `${derivation.toString('hex')}-${index}-${address.toString()}`;
    if (this.#cachedKeyImages[key]) {
      return this.#cachedKeyImages[key];
    } else if (!address.isViewOnly) {
      const pubKey = monerolib.cryptoUtil.derivePublicKey(derivation, index, address.publicSpendKey);
      const secKey = monerolib.cryptoUtil.deriveSecretKey(derivation, index, address.secretSpendKey);
      const keyImage = monerolib.cryptoUtil.generateKeyImage(pubKey, secKey);
      this.#cachedKeyImages[key] = keyImage.toString('hex');
      return this.#cachedKeyImages[key];
    } else {
      throw new errors.InternalWalletError('Unable to compute key image in view only mode');
    }
  }

  getPublicKey() {
    return {
      data: {
        publicSpendKey: this.#viewOnlyWallet.publicSpendKey.toString('hex'),
        secretViewKey: this.#viewOnlyWallet.secretViewKey.toString('hex'),
      },
    };
  }

  getPrivateKey(seed) {
    this.typeSeed(seed);
    const wallet = this.#walletFromSeed(seed);
    return [{
      address: this.address,
      publicviewkey: wallet.publicViewKey.toString('hex'),
      privateviewkey: wallet.secretViewKey.toString('hex'),
      publicspendkey: wallet.publicSpendKey.toString('hex'),
      privatespendkey: wallet.secretSpendKey.toString('hex'),
    }];
  }

  #getAddress(type) {
    if (type === MoneroWallet.ADDRESS_TYPE_ADDRESS) {
      return this.#viewOnlyWallet.getAddress();
    } else if (type === MoneroWallet.ADDRESS_TYPE_SUBADDRESS) {
      return this.#viewOnlyWallet.getSubaddress(0, 1);
    }
  }

  #getAllAddresses() {
    return this.addressTypes.map((type) => this.#getAddress(type));
  }

  #getRandomAddress() {
    return '888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H';
  }

  async validateTransaction(txId) {
    if (!/^[0-9A-Fa-f]{64}$/.test(txId)) {
      throw new InvalidTransactionIDError(txId);
    }
    const id = txId.toLowerCase();
    // check if already added
    if (this.#txIds.includes(id)) {
      throw new TransactionAlreadyAddedError(id);
    }
    try {
      const [tx] = await this.#loadTxs([id]);
      if (!tx) {
        throw new UnknownTransactionError(id);
      }
    } catch (err) {
      throw new UnknownTransactionError(id, { cause: err });
    }
  }

  async addTransaction(txId, seed) {
    this.typeSeed(seed);
    const id = txId.toLowerCase();
    const [tx] = await this.#loadTxs([id]);
    if (!this.#processTx(tx, seed)) {
      throw new NotYourTransactionError(id);
    }
    this.#txs.push(tx);
    this.#txs.sort((a, b) => a.time - b.time);
    for (const tx of this.#txs) {
      this.#processTx(tx, seed);
    }
    this.storage.set('txIds', this.#txIds);
    this.storage.set('keyImages', this.#cachedKeyImages);
    this.#balance = this.#calculateBalance();
    this.storage.set('balance', this.#balance.toString());
    await this.storage.save();
    this.memoizeClear(this.#getUnspentsForTx);
    return this.#transformTx(tx);
  }

  async loadTransactions({ cursor = 0 } = {}) {
    const txs = Array.from(this.#txs).reverse();
    const slice = txs.slice(cursor, cursor + this.txPerPage);
    return {
      transactions: slice.map((tx) => this.#transformTx(tx)),
      hasMore: slice.length === this.txPerPage,
      cursor: cursor + this.txPerPage,
    };
  }

  async loadTransaction(id) {
    const tx = this.#txs.find((item) => item.txId === id);
    if (tx) {
      return this.#transformTx(tx);
    }
  }

  async #calculateMinerFee(utxos, mixins, outputs, feeMultiplier) {
    // TODO handle error
    const feeConfig = await this.#getFeeConfig();
    return BigInt(monerolib.tx.estimateFee(
      utxos,
      mixins,
      outputs,
      TX_EXTRA_SIZE,
      feeConfig.baseFee,
      feeMultiplier,
      feeConfig.feeQuantizationMask
    ));
  }

  calculateCsFee({ value, price }) {
    return super.calculateCsFee(value, {
      price,
      dustThreshold: this.#dustThreshold,
    });
  }

  calculateCsFeeForMaxAmount({ value, price }) {
    return super.calculateCsFeeForMaxAmount(value, {
      price,
      dustThreshold: this.#dustThreshold,
    });
  }

  async _estimateMaxAmount({ feeRate, price, unconfirmed = false }) {
    const utxos = await this.#getUnspentsForTx(unconfirmed);
    if (utxos.length === 0) {
      return 0n;
    }
    const available = utxos.reduce((available, item) => available + item.amount, 0n);
    const csFeeConfig = await this.getCsFeeConfig();
    const csFeeOutput = csFeeConfig.disabled ? 0 : 1;
    // outputs without change
    const minerFee = await this.#calculateMinerFee(utxos.length, MIXIN, 1 + csFeeOutput, this.#feeMultipliers[feeRate]);
    if (available <= minerFee) {
      return 0n;
    }
    const csFee = await this.calculateCsFeeForMaxAmount({ value: available - minerFee, price });
    const maxAmount = available - minerFee - csFee;
    if (maxAmount < 0n) {
      return 0n;
    }
    return maxAmount;
  }

  async estimateMaxAmount(options) {
    super.estimateMaxAmount(options);
    const maxAmount = await this.#estimateMaxAmount(options);
    return new Amount(maxAmount, this.crypto.decimals);
  }

  async _selectUtxos({ feeRate, value, price }) {
    const utxos = await this.#getUnspentsForTx();
    const csFee = await this.calculateCsFee({ value, price });
    const csFeeOutput = csFee > 0n ? 1 : 0;

    let available = 0n;
    const sources = [];
    for (const item of utxos) {
      available = available + item.amount;
      sources.push(item);
      if (available > value) {
        // fee without change: 1 or 2 oututs
        const minerFeeWihoutChange = await this.#calculateMinerFee(
          sources.length, MIXIN, 1 + csFeeOutput, this.#feeMultipliers[feeRate]);
        if (value + csFee + minerFeeWihoutChange <= available) {
          const change = available - value - minerFeeWihoutChange - csFee;
          // if change is 0
          if (change <= this.#dustThreshold) {
            return {
              sources,
              minerFee: minerFeeWihoutChange,
              csFee,
              //change: undefined,
            };
          }
        }
        // fee with change: 2 or 3 outputs
        const minerFeeWithChange = await this.#calculateMinerFee(
          sources.length, MIXIN, 2 + csFeeOutput, this.#feeMultipliers[feeRate]);
        if (value + minerFeeWithChange + csFee <= available) {
          const change = available - value - minerFeeWithChange - csFee;
          // if change is 0
          if (change <= this.#dustThreshold) {
            return {
              sources,
              minerFee: minerFeeWithChange + change,
              csFee,
              // additional output with zero value
              change: 0n,
            };
          } else {
            return {
              sources,
              minerFee: minerFeeWithChange,
              csFee,
              change,
            };
          }
        }
      }
    }
    // only for fee estimation
    // do we actually need it?
    return {
      sources: utxos,
      minerFee: await this.#calculateMinerFee(utxos.length || 1, MIXIN, 2 + csFeeOutput, this.#feeMultipliers[feeRate]),
      csFee,
    };
  }

  async #estimateTransactionFee({ feeRate, value, price }) {
    const { minerFee, csFee } = await this.#selectUtxos({ feeRate, value, price });
    return minerFee + csFee;
  }

  async estimateTransactionFee({ feeRate, address, amount, price }) {
    super.estimateTransactionFee({ feeRate, address, amount, price });
    const { value } = amount;
    // we don't need destination address to calculate fee in monero
    const fee = await this.#estimateTransactionFee({ feeRate, value, price });
    return new Amount(fee, this.crypto.decimals);
  }

  #parseAddress(address) {
    try {
      return this.#viewOnlyWallet.addressFromString(address);
    } catch (err) {
      throw new errors.InvalidAddressError(address, { cause: err });
    }
  }

  async validateAddress({ address }) {
    super.validateAddress({ address });
    const parsedAddress = this.#parseAddress(address);
    for (const address of this.#getAllAddresses()) {
      if (address.toString() === parsedAddress.toString()) {
        throw new errors.DestinationEqualsSourceError();
      }
    }
    return true;
  }

  async validateAmount({ feeRate, address, amount, price }) {
    super.validateAmount({ feeRate, address, amount, price });
    const { value } = amount;
    if (value < this.#dustThreshold) {
      throw new errors.SmallAmountError(new Amount(this.#dustThreshold, this.crypto.decimals));
    }
    const maxAmount = await this.#estimateMaxAmount({ feeRate, price });
    if (value > maxAmount) {
      const unconfirmedMaxAmount = await this.#estimateMaxAmount({ feeRate, price, unconfirmed: true });
      if (value < unconfirmedMaxAmount) {
        throw new errors.BigAmountConfirmationPendingError(new Amount(maxAmount, this.crypto.decimals));
      } else {
        throw new errors.BigAmountError(new Amount(maxAmount, this.crypto.decimals));
      }
    }
    return true;
  }

  // amount and address are already validated
  async createTransaction({ feeRate, address, amount, price }, seed) {
    super.createTransaction({ feeRate, address, amount, price }, seed);
    const description = this.#parseAddress(address);
    const { value } = amount;
    const {
      sources,
      csFee,
      change,
    } = await this.#selectUtxos({ feeRate, value, price });
    const csFeeConfig = await this.getCsFeeConfig();

    const destinations = [{
      amount: value.toString(),
      address: description.toString(),
    }];

    if (csFee > 0n) {
      destinations.push({
        amount: csFee.toString(),
        address: csFeeConfig.address,
      });
    }

    if (change !== undefined) {
      destinations.push({
        amount: change.toString(),
        address: change > 0n ?
          this.#getAddress(MoneroWallet.ADDRESS_TYPE_ADDRESS).toString() : this.#getRandomAddress(),
      });
    }

    const mixins = [];
    for (const source of sources) {
      mixins.push({
        amount: '0',
        outputs: await this.#loadRandomOutputs(RING_COUNT, source.height),
      });
    }
    const moneroCoreJs = await this.#initMoneroCoreJS();
    const wallet = this.#walletFromSeed(seed);

    const rawtx = moneroCoreJs.createTx({
      addresses: this.#getAllAddresses().map(address => address.toString()),
      sources: sources.map((item) => {
        return {
          ...item,
          amount: item.amount.toString(),
        };
      }),
      destinations,
      mixins,
      secretViewKey: wallet.secretViewKey.toString('hex'),
      secretSpendKey: wallet.secretSpendKey.toString('hex'),
    });
    const txId = await this.#api.sendTransaction(rawtx);
    // return processed tx
    await this.addTransaction(txId, seed);
    return txId;
  }
}
