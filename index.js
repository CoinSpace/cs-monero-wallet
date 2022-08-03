import monerolib from 'monerolib';
import HDKey from 'hdkey';
import BigNumber from 'bignumber.js';

import { calculateCsFee, reverseCsFee } from './lib/fee.js';

const TXS_CHUNK = 50;
const RING_COUNT = 16;

export default class MoneroWallet {
  #wallet;
  #storage;
  #cache;
  #request;
  #wasmPath = 'node_modules/@coinspace/monero-core-js/build/MoneroCoreJS.wasm';
  #apiNode;
  #apiWeb;
  #crypto;
  #addressType;
  #isLocked;
  #txs = [];
  #outputs = new Map();
  #balance = new BigNumber(0);
  #unspentsForTx = [];
  #cachedKeyImages;
  #maxTxInputs;
  #minConf = 10;
  #minConfCoinbase = 60;
  #txsPerPage = 5;
  #txsCursor = 0;
  // https://github.com/monero-project/monero/blob/v0.17.2.0/src/wallet/wallet2.cpp#L10924
  #dustThreshold = new BigNumber(1);
  #baseFee = '1';
  #feeQuantizationMask = '1000';
  // tx pub key + payment id + 3 * additional pub keys
  // 1 + 32 + 1 + 10 + 1 + 1 + 32 + 32 + 32
  #txExtraSize = 142;
  #csFee;
  #csMinFee;
  #csMaxFee;
  #csSkipMinFee;
  #csFeeAddresses;
  #csFeeOff = true;
  #feeRates = [{
    name: 'default',
    default: true,
    feeMultiplier: 1,
  }, {
    name: 'fastest',
    feeMultiplier: 25,
  }];
  #moneroCoreJS;

  get #txIds() {
    return this.#txs.map(item => item.txId);
  }

  get addressTypes() {
    return ['address', 'subaddress'];
  }

  get addressType() {
    return this.#addressType;
  }

  set addressType(addressType) {
    if (!this.addressTypes.includes(addressType)) {
      throw new TypeError('unsupported address type');
    }
    this.#cache.set('addressType', addressType);
    this.#addressType = addressType;
  }

  get isLocked() {
    return this.#isLocked;
  }

  get feeRates() {
    // only names
    return this.#feeRates.map((item) => {
      return {
        name: item.name,
        default: item.default === true,
      };
    });
  }

  get balance() {
    return this.#balance.toString(10);
  }

  get crypto() {
    return this.#crypto;
  }

  constructor(options = {}) {
    if (!options.storage) {
      throw new TypeError('storage should be passed');
    }
    this.#storage = options.storage;

    if (!options.cache) {
      throw new TypeError('cache should be passed');
    }
    this.#cache = options.cache;

    if (!options.request) {
      throw new TypeError('request should be passed');
    }
    this.#request = options.request;

    if (options.wasm) {
      this.#wasmPath = options.wasm;
    }

    if (!options.apiNode) {
      throw new TypeError('apiNode should be passed');
    }
    this.#apiNode = options.apiNode;

    if (!options.apiWeb) {
      throw new TypeError('apiWeb should be passed');
    }
    this.#apiWeb = options.apiWeb;

    if (!options.crypto) {
      throw new TypeError('crypto should be passed');
    }
    this.#crypto = options.crypto;

    this.#maxTxInputs = options.maxTxInputs || 292;

    const nettype = options.useTestNetwork ? 'regtest' : 'mainnet';

    if (options.seed) {
      this.#wallet = this.#walletFromSeed(options.seed, nettype);
      this.#isLocked = false;
    } else if (options.publicKey) {
      const keys = JSON.parse(options.publicKey);
      this.#wallet = this.#walletFromKeys(keys.publicSpendKey, keys.secretViewKey, nettype);
      this.#isLocked = true;
    } else {
      throw new TypeError('seed or publicKey should be passed');
    }

    this.#balance = new BigNumber(this.#cache.get('balance') || 0);
    this.#addressType = this.#cache.get('addressType') || this.addressTypes[0];
  }

  #calculateUnspentsForTx() {
    return Array.from(this.#outputs.values())
      .filter(item => item.spent !== true && item.confirmed === true)
      .sort((a, b) => {
        if (new BigNumber(a.amount).isGreaterThan(b.amount)) {
          return -1;
        }
        if (new BigNumber(a.amount).isLessThan(b.amount)) {
          return 1;
        }
        return 0;
      })
      .slice(0, this.#maxTxInputs);
  }

  #calculateBalance() {
    return Array.from(this.#outputs.values())
      .filter(item => item.spent !== true)
      .reduce((balance, item) => balance.plus(item.amount), new BigNumber(0));
  }

  #requestNode(config) {
    return this.#request({
      ...config,
      baseURL: this.#apiNode,
      disableDefaultCatch: true,
    }).catch((err) => {
      console.error(err);
      throw new Error('cs-node-error');
    });
  }

  #requestWeb(config) {
    return this.#request({
      ...config,
      baseURL: this.#apiWeb,
    });
  }

  #walletFromSeed(seed, nettype) {
    const hdkey = HDKey.fromMasterSeed(Buffer.from(seed, 'hex'));
    // https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
    // https://github.com/satoshilabs/slips/blob/master/slip-0044.md
    const base = hdkey.derive("m/44'/128'/0'");
    return new monerolib.Wallet({
      seed: Buffer.from(base.privateKey),
      nettype,
    });
  }

  #walletFromKeys(publicSpendKey, secretViewKey, nettype) {
    return new monerolib.Wallet({
      publicSpendKey,
      secretViewKey,
      nettype,
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

  lock() {
    this.#wallet = this.#walletFromKeys(
      this.#wallet.publicSpendKey,
      this.#wallet.secretViewKey,
      this.#wallet.nettype
    );
    this.#isLocked = true;
  }

  unlock(seed) {
    this.#wallet = this.#walletFromSeed(seed, this.#wallet.nettype);
    this.#isLocked = false;
  }

  async load() {
    this.#storage.init();
    this.#cachedKeyImages = (await this.#storage.get('keyImages')) || {};

    const txIds = (await this.#storage.get('txIds')) || [];
    this.#txs = await this.#loadTxs(txIds);
    for (const tx of this.#txs) {
      this.#processTx(tx);
    }
    await this.#storage.set('txIds', this.#txIds);

    if (!await this.#storage.get('createdAt')) {
      await this.#storage.set('createdAt', Date.now());
    }

    await this.#loadFee();
    await this.#loadCsFee();
    this.#balance = this.#calculateBalance();
    this.#cache.set('balance', this.#balance);
    this.#txsCursor = 0;
    this.#unspentsForTx = this.#calculateUnspentsForTx();
  }

  async update() {
    await this.#loadFee();
    await this.#loadCsFee();
  }

  async #loadFee() {
    const result = await this.#requestNode({
      url: 'api/v1/estimatefee',
      method: 'get',
      seed: 'public',
    });
    this.#baseFee = new BigNumber(result.fee, 10).toString(10);
    this.#feeQuantizationMask = new BigNumber(result.quantization_mask, 10).toString(10);
  }

  async #loadCsFee() {
    try {
      const result = await this.#requestWeb({
        url: 'api/v3/csfee',
        params: {
          crypto: 'monero@monero',
        },
        method: 'get',
        seed: 'public',
      });
      this.#csFee = result.fee;
      this.#csMinFee = new BigNumber(result.minFee, 10);
      this.#csMaxFee = new BigNumber(result.maxFee, 10);
      this.#csSkipMinFee = result.skipMinFee || false;
      this.#csFeeAddresses = result.addresses;
      this.#csFeeOff = result.addresses.length === 0
        || result.whitelist.includes(this.#getAddress('address'));
    } catch (err) {
      console.error(err);
    }
  }

  async #loadTxs(txIds) {
    const txs = [];
    for (let i = 0; i < Math.ceil(txIds.length / TXS_CHUNK); i++) {
      const ids = txIds.slice(i * TXS_CHUNK, i * TXS_CHUNK + TXS_CHUNK);
      txs.push(await this.#requestNode({
        url: `api/v1/txs/${ids.join(',')}`,
        method: 'get',
        seed: 'public',
      }));
    }
    return txs.flat().sort((a, b) => a.time - b.time);
  }

  async #loadRandomOutputs(count=16, height) {
    return this.#requestNode({
      url: 'api/v1/outputs/random',
      params: {
        count,
        height,
      },
      method: 'get',
      seed: 'public',
    });
  }

  #processTx(tx) {
    let outputValue = new BigNumber(0);
    let inputValue = new BigNumber(0);

    tx.confirmed = tx.coinbase
      ? tx.confirmations >= this.#minConfCoinbase
      : tx.confirmations >= this.#minConf;

    tx.minConf = tx.coinbase ? this.#minConfCoinbase : this.#minConf;

    const mainDerivation = monerolib.cryptoUtil.generateKeyDerivation(
      Buffer.from(tx.txPubKey, 'hex'),
      this.#wallet.secretViewKey
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
            this.#wallet.secretViewKey
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
              output.amount = rct.amount;
            }
            output.ours = true;
            output.address = address.toString();
            output.addressIndex = address.index,
            tx.ours = true;
            outputValue = outputValue.plus(output.amount);

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
      if (output.ours) {
        break;
      }
    }

    for (const input of tx.ins) {
      input.amount = '0';
      for (const keyOutput of input.keyOutputs) {
        if (this.#outputs.has(`${keyOutput.txId}:${keyOutput.targetKey}`)) {
          const output = this.#outputs.get(`${keyOutput.txId}:${keyOutput.targetKey}`);
          const address = this.#wallet.getSubaddress(output.addressIndex.major, output.addressIndex.minor);
          const keyImage = this.#generateKeyImage(output.derivation, output.index, address);
          if (keyImage === input.keyImage) {
            // spent
            output.spent = true;
            tx.ours = true;
            // for tx history
            input.address = output.address;
            input.amount = output.amount;
            inputValue = inputValue.plus(output.amount);
          }
        }
      }
    }

    const minerFee = new BigNumber(tx.fee || 0, 10);
    const csFee = new BigNumber(tx.csfee || 0, 10);
    const fee = minerFee.plus(csFee);
    tx.csFee = csFee.toString(10);
    tx.minerFee = minerFee.toString(10);
    tx.fee = fee.toString(10);

    const amount = outputValue.minus(inputValue);
    if (amount.isLessThan(0)) {
      tx.amount = amount.plus(fee).toString(10);
    } else {
      tx.amount = amount.toString(10);
    }
    tx.isIncoming = amount.isGreaterThan(0);
    tx.timestamp = tx.time * 1000;

    return tx.ours === true;
  }

  #generateKeyImage(derivation, index, address) {
    const key = `${derivation.toString('hex')}-${index}-${address.toString()}`;
    if (this.#cachedKeyImages[key]) {
      return this.#cachedKeyImages[key];
    } else if (!this.#wallet.isViewOnly) {
      const pubKey = monerolib.cryptoUtil.derivePublicKey(derivation, index, address.publicSpendKey);
      const secKey = monerolib.cryptoUtil.deriveSecretKey(derivation, index, address.secretSpendKey);
      const keyImage = monerolib.cryptoUtil.generateKeyImage(pubKey, secKey);
      this.#cachedKeyImages[key] = keyImage.toString('hex');
      return this.#cachedKeyImages[key];
    } else {
      throw new Error('Unable to compute key image in view only mode');
    }
  }

  publicKey() {
    return JSON.stringify({
      publicSpendKey: this.#wallet.publicSpendKey.toString('hex'),
      secretViewKey: this.#wallet.secretViewKey.toString('hex'),
    });
  }

  #getAddress(type) {
    if (type === 'address') {
      return this.#wallet.getAddress();
    } else if (type === 'subaddress') {
      return this.#wallet.getSubaddress(0, 1);
    }
  }

  #getAllAddresses() {
    return this.addressTypes.map((type) => this.#getAddress(type));
  }

  getNextAddress() {
    return this.#getAddress(this.#addressType).toString();
  }

  #getRandomAddress() {
    return '888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H';
  }

  async addTx(txId) {
    if (!/^[0-9A-Fa-f]{64}$/.test(txId)) {
      throw new TypeError('Invalid Transaction ID');
    }
    // check if already added
    if (this.#txIds.includes(txId)) {
      throw new TypeError('Transaction already added');
    }
    const [tx] = await this.#loadTxs([txId]);
    if (!tx) {
      throw new TypeError('Unknown transaction');
    }
    if (!this.#processTx(tx)) {
      throw new TypeError('Not your transaction');
    }
    this.#txs.push(tx);
    this.#txs.sort((a, b) => a.time - b.time);
    await this.#storage.set('txIds', this.#txIds);
    await this.#storage.set('keyImages', this.#cachedKeyImages);
    this.#balance = this.#calculateBalance();
    this.#cache.set('balance', this.#balance);
    this.#unspentsForTx = this.#calculateUnspentsForTx();
    return tx;
  }

  async loadTxs() {
    const txs = Array.from(this.#txs).reverse();
    const cursor = this.#txsCursor ? txs.indexOf(this.#txsCursor) + 1 : 0;
    const slice = txs.slice(cursor, cursor + this.#txsPerPage);
    if (slice.length) {
      this.#txsCursor = slice[slice.length - 1];
      const hasMoreTxs = txs.indexOf(this.#txsCursor) < (txs.length - 1);
      return {
        txs: slice,
        hasMoreTxs,
      };
    } else {
      return {
        txs: [],
        hasMoreTxs: false,
      };
    }
  }

  #calculateCsFee(value) {
    return calculateCsFee(value, this.#csFeeOff, this.#csFee, this.#csMinFee, this.#csMaxFee, this.#csSkipMinFee);
  }

  // value = value + csFee
  #reverseCsFee(value) {
    return reverseCsFee(value, this.#csFeeOff, this.#csFee, this.#csMinFee, this.#csMaxFee, this.#csSkipMinFee);
  }

  #calculateMaxAmount(feeRate) {
    // TODO fee may be a number ?
    const utxos = this.#unspentsForTx;
    if (utxos.length === 0) {
      return new BigNumber(0);
    }
    const available = utxos
      .reduce((available, item) => available.plus(new BigNumber(item.amount, 10)), new BigNumber(0));
    // 3 outputs with change
    const minerFee = new BigNumber(monerolib.tx.estimateFee(utxos.length, 10, 3, this.#txExtraSize,
      this.#baseFee, feeRate.feeMultiplier, this.#feeQuantizationMask), 10);
    if (available.isLessThanOrEqualTo(minerFee)) {
      return new BigNumber(0);
    }
    const csFee = this.#reverseCsFee(available.minus(minerFee));
    const maxAmount = available.minus(minerFee).minus(csFee);
    if (maxAmount.isLessThan(0)) {
      return new BigNumber(0);
    }
    return maxAmount;
  }

  estimateFees(value = 0) {
    const amount = new BigNumber(value, 10);
    return this.#feeRates.map((feeRate) => {
      const info = this.#estimateFee(amount, feeRate);
      return {
        name: feeRate.name,
        default: feeRate.default === true,
        estimate: info.estimate.toString(10),
        maxAmount: info.maxAmount.toString(10),
      };
    });
  }

  #estimateFee(value, feeRate) {
    const utxos = this.#unspentsForTx;
    const maxAmount = this.#calculateMaxAmount(feeRate);
    const csFee = this.#calculateCsFee(value);

    // estimate fee for usual tx
    if (utxos.length === 0) {
      // dummy 1 input
      const minerFee = new BigNumber(monerolib.tx.estimateFee(1, 10, 3, this.#txExtraSize,
        this.#baseFee, feeRate.feeMultiplier, this.#feeQuantizationMask), 10);
      const estimate = csFee.plus(minerFee);
      return {
        minerFee,
        csFee,
        change: new BigNumber(0),
        estimate,
        maxAmount,
      };
    }

    // estimate fee to clear wallet
    if (value.isEqualTo(maxAmount)) {
      const minerFee = new BigNumber(monerolib.tx.estimateFee(utxos.length, 10, 3, this.#txExtraSize,
        this.#baseFee, feeRate.feeMultiplier, this.#feeQuantizationMask), 10);
      const estimate = csFee.plus(minerFee);
      return {
        minerFee,
        csFee,
        change: new BigNumber(0),
        estimate,
        maxAmount,
      };
    }

    let available = new BigNumber(0);
    const sources = [];
    for (const item of utxos) {
      available = available.plus(item.amount);
      sources.push(item);
      if (available.isLessThanOrEqualTo(value)) {
        continue;
      } else {
        // fee with change: 3 outputs
        let minerFee = new BigNumber(monerolib.tx.estimateFee(sources.length, 10, 3, this.#txExtraSize,
          this.#baseFee, feeRate.feeMultiplier, this.#feeQuantizationMask), 10);
        let estimate = csFee.plus(minerFee);
        const total = value.plus(estimate);
        if (total.isLessThanOrEqualTo(available)) {
          let change = available.minus(total);
          if (change.isGreaterThan(0) && change.isLessThanOrEqualTo(this.#dustThreshold)) {
            minerFee = minerFee.plus(change);
            estimate = estimate.plus(change);
            change = new BigNumber(0);
          }
          return {
            minerFee,
            csFee,
            change,
            estimate,
            maxAmount,
          };
        }
      }
    }
    // TODO handle error case with custom fee rate in future
    //throw new Error(`fee could not be estimated for value ${value}`);
    const minerFee = new BigNumber(monerolib.tx.estimateFee(utxos.length, 10, 3, this.#txExtraSize,
      this.#baseFee, feeRate.feeMultiplier, this.#feeQuantizationMask), 10);
    const estimate = csFee.plus(minerFee);
    return {
      minerFee,
      csFee,
      change: new BigNumber(0),
      estimate,
      maxAmount,
    };
  }

  #parseAddress(str) {
    try {
      return this.#wallet.addressFromString(str);
    } catch (err) {
      console.error(err);
      throw new Error('Invalid address');
    }
  }

  async createTx(to, value, fee) {
    const addressTo = this.#parseAddress(to);
    for (const address of this.#getAllAddresses()) {
      if (address.toString() === addressTo.toString()) {
        throw new Error('Destination address equal source address');
      }
    }

    const amount = new BigNumber(value, 10);
    if (amount.isLessThan(this.#dustThreshold)) {
      const error = new Error('Invalid value');
      error.dustThreshold = this.#dustThreshold.toString(10);
      throw error;
    }

    const totalFee = new BigNumber(fee, 10);
    const csFee = this.#calculateCsFee(amount);

    if (!totalFee.isFinite() || totalFee.isLessThan(csFee)) {
      throw new Error('Invalid fee');
    }

    const total = amount.plus(totalFee);
    const utxos = this.#unspentsForTx;

    let available = new BigNumber(0);
    let change = new BigNumber(0);
    const sources = [];

    for (const item of utxos) {
      available = available.plus(item.amount);
      sources.push(item);
      if (available.isLessThan(total)) {
        continue;
      } else {
        change = available.minus(total);
        if (change.isLessThanOrEqualTo(this.#dustThreshold)) {
          if (!csFee.isZero()) {
            csFee.plus(change);
          }
          change = new BigNumber(0);
        }
        break;
      }
    }

    if (total.isGreaterThan(available)) {
      const error = new Error('Insufficient funds');
      if (total.isLessThan(this.#balance)) {
        error.details = 'Additional funds confirmation pending';
      }
      throw error;
    }

    // minimum miner fee
    const minerFee = new BigNumber(monerolib.tx.estimateFee(sources.length, 10, 3, this.#txExtraSize,
      this.#baseFee, 1, this.#feeQuantizationMask), 10);

    if (totalFee.minus(csFee).isLessThan(minerFee)) {
      throw new Error('Invalid fee');
    }

    const destinations = [{
      amount: amount.toString(10),
      address: addressTo.toString(),
    }, {
      amount: csFee.toString(10),
      address: csFee.isGreaterThan(0) ? this.#csFeeAddresses[0] : this.#getRandomAddress(),
    }, {
      amount: change.toString(10),
      address: change.isGreaterThan(0) ? this.#getAddress('address').toString() : this.#getRandomAddress(),
    }];

    const mixins = [];
    for (const source of sources) {
      mixins.push({
        amount: '0',
        outputs: await this.#loadRandomOutputs(RING_COUNT, source.height),
      });
    }

    return {
      minerFee: totalFee.minus(csFee).toString(10),
      csFee: csFee.toString(10),
      fee: totalFee.toString(10),
      sources,
      destinations,
      addresses: this.#getAllAddresses().map(address => address.toString()),
      mixins,
    };
  }

  async sendTx(data) {
    const moneroCoreJs = await this.#initMoneroCoreJS();

    data.secretViewKey = this.#wallet.secretViewKey.toString('hex');
    data.secretSpendKey = this.#wallet.secretSpendKey.toString('hex');

    const rawtx = moneroCoreJs.createTx(data);
    const { txId } = await this.#requestNode({
      url: 'api/v1/tx/send',
      data: {
        rawtx,
      },
      method: 'post',
      seed: 'public',
    });
    // return processed tx
    return this.addTx(txId);
  }

  txUrl(txId) {
    return `https://blockchair.com/monero/transaction/${txId}?from=coinwallet`;
  }

  exportPrivateKeys() {
    const lines = ['address,secretviewkey,secretspendkey'];
    lines.push([
      this.#getAddress('address').toString(),
      this.#wallet.secretViewKey.toString('hex'),
      this.#wallet.secretSpendKey.toString('hex'),
    ].join(','));
    return lines.join('\n');
  }
}
