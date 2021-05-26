import monerolib from 'monerolib';
import HDKey from 'hdkey';
import BN from 'bn.js';

const TXIDS_CHUNK = 50;

export default class MoneroWallet {
  #wallet;
  #storage;
  #request;
  #apiNode;
  #apiWeb;
  #addressType;
  #isLocked;
  #txs = [];
  #outputs = new Map();
  #cachedKeyImages;
  #maxTxInputs;
  #minConf = 10;
  #minConfCoinbase = 60;
  #txsPerPage = 5;
  #txsCursor = 0;
  // https://github.com/monero-project/monero/blob/v0.17.2.0/src/cryptonote_config.h#L208
  #dustThreshold = new BN('2000000000', 10);
  #baseFee;
  #feeQuantizationMask;
  #csFee;
  #csMinFee;
  #csMaxFee;
  #csFeeAddresses;
  #csFeeOff = false;
  #feeRates = [{
    name: 'default',
    default: true,
    feeMultiplier: 1,
  }, {
    name: 'fastest',
    feeMultiplier: 25,
  }];

  get #txIds() {
    return this.#txs.map(item => item.txId);
  }

  get decimals() {
    return 12;
  }

  get networkName() {
    return 'monero';
  }
  // TODO rename to symbol?
  get denomination() {
    return 'XMR';
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

  get #unspents() {
    return Array.from(this.#outputs.values())
      .filter(item => item.spent !== true);
  }

  get #unspentsForTx() {
    return Array.from(this.#outputs.values())
      .filter(item => item.spent !== true && item.confirmed === true)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, this.#maxTxInputs);
  }

  get #balance() {
    return this.#unspents
      .reduce((balance, item) => balance.add(new BN(item.amount, 10)), new BN(0));
  }

  get balance() {
    return this.#balance.toString(10);
  }

  constructor(options = {}) {
    if (!options.storage) {
      throw new TypeError('storage should be passed');
    }
    this.#storage = options.storage;

    if (!options.request) {
      throw new TypeError('request should be passed');
    }
    this.#request = options.request;

    if (!options.apiNode) {
      throw new TypeError('apiNode should be passed');
    }
    this.#apiNode = options.apiNode;

    if (!options.apiWeb) {
      throw new TypeError('apiWeb should be passed');
    }
    this.#apiWeb = options.apiWeb;

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

    this.#addressType = options.addressType || this.addressTypes[0];
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
  }

  async #loadFee() {
    const result = await this.#request({
      baseURL: this.#apiNode,
      url: 'api/v1/estimatefee',
      method: 'get',
      seed: 'public',
    });
    this.#baseFee = new BN(result.fee, 10).toString(10);
    this.#feeQuantizationMask = new BN(result.quantization_mask, 10).toString(10);
  }

  async #loadCsFee() {
    try {
      const result = await this.#request({
        baseURL: this.#apiWeb,
        url: 'api/v2/csfee',
        params: {
          crypto: 'monero',
        },
        method: 'get',
        seed: 'public',
      });
      this.#csFee = result.fee;
      this.#csMinFee = new BN(result.minFee, 10);
      this.#csMaxFee = new BN(result.maxFee, 10);
      this.#csFeeAddresses = result.addresses;
      this.#csFeeOff = result.addresses.length === 0
        || result.whitelist.includes(this.#getAddress('address'));
    } catch (err) {
      console.error(err);
    }
  }

  async #loadTxs(txIds) {
    const txs = [];
    for (let i = 0; i < Math.ceil(txIds.length / TXIDS_CHUNK); i++) {
      const ids = txIds.slice(i * TXIDS_CHUNK, i * TXIDS_CHUNK + TXIDS_CHUNK);
      txs.push(await this.#request({
        baseURL: this.#apiNode,
        url: `api/v1/txs/${ids.join(',')}`,
        method: 'get',
        seed: 'public',
      }));
    }
    return txs.flat().sort((a, b) => a.time - b.time);
  }

  #processTx(tx) {
    const outputValue = new BN(0);
    const inputValue = new BN(0);

    tx.confirmed = tx.coinbase
      ? tx.confirmations >= this.#minConfCoinbase
      : tx.confirmations >= this.#minConf;

    const mainDerivation = monerolib.cryptoUtil.generateKeyDerivation(
      Buffer.from(tx.txPubKey, 'hex'),
      this.#wallet.secretViewKey
    );

    for (const output of tx.outs) {
      const derivations = [mainDerivation];

      if (output.additionalPubKey) {
        // additional derivation
        derivations.push(monerolib.cryptoUtil.generateKeyDerivation(
          Buffer.from(output.additionalPubKey, 'hex'),
          this.#wallet.secretViewKey
        ));
      }

      for (const address of this.#getAllAddresses()) {
        for (const derivation of derivations) {
          const pubKey = monerolib.cryptoUtil.derivePublicKey(derivation, output.index, address.publicSpendKey);
          if (pubKey.toString('hex') === output.targetKey) {
            if (output.rctType !== monerolib.ringct.RCTTypes.Null) {
              const rct = monerolib.ringct.decodeRct(
                { amount: output.ecdhInfoAmount, mask: output.ecdhInfoMask },
                output.outPk,
                output.rctType,
                output.index,
                derivation
              );
              output.amount = rct.amount;
              output.ours = true;
              output.address = address.toString();
              output.addressIndex = address.index,
              tx.ours = true;
              outputValue.iadd(new BN(output.amount, 10));

              this.#outputs.set(`${tx.txId}:${output.targetKey}`, {
                txId: tx.txId,
                confirmed: tx.confirmed,
                derivation,
                ...output,
              });
            }
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
            inputValue.iadd(new BN(output.amount, 10));
          }
        }
      }
    }

    const minerFee = new BN(tx.fee, 10);
    const csFee = tx.csfee ? new BN(tx.csfee, 10) : new BN(0);
    tx.csFee = csFee.toString(10);
    tx.minerFee = minerFee.toString(10);
    tx.fee = minerFee.add(csFee).toString(10);

    const amount = outputValue.sub(inputValue);
    tx.amount = amount.toString(10);
    tx.isIncoming = amount.gtn(0);
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
    // check if already added
    if (this.#txIds.includes(txId)) {
      return;
    }
    const [tx] = await this.#loadTxs([txId]);
    if (!tx) {
      throw new TypeError('Unknown transaction');
    }
    if (!this.#processTx(tx)) {
      throw new TypeError('Not ours transaction');
    }
    this.#txs = this.#txs.push(tx)
      .sort((a, b) => a.time - b.time);
    await this.#storage.set('txIds', this.#txIds);
    await this.#storage.set('keyImages', this.#cachedKeyImages);
  }

  async loadTxs() {
    const txs = Array.from(this.#txs)
      .reverse()
      .slice(this.#txsCursor, this.#txsCursor + this.#txsPerPage);
    this.#txsCursor = this.#txsCursor + this.#txsPerPage;
    const hasMoreTxs = this.#txsCursor < this.#txs.length;
    return {
      txs,
      hasMoreTxs,
    };
  }

  #calculateCsFee(value) {
    if (this.#csFeeOff) {
      return new BN(0);
    }
    let fee = value.muln(this.#csFee);
    fee = BN.max(fee, this.#csMinFee);
    fee = BN.min(fee, this.#csMaxFee);
    if (fee.lt(this.#dustThreshold)) {
      return new BN(0);
    }
    return fee;
  }

  // value = value + csFee
  #reverseCsFee(value) {
    if (this.#csFeeOff) {
      return new BN(0);
    }
    let fee = value.muln(this.#csFee / (1 + this.#csFee));
    fee = BN.max(fee, this.#csMinFee);
    fee = BN.min(fee, this.#csMaxFee);
    if (fee.lt(this.#dustThreshold)) {
      return new BN(0);
    }
    return fee;
  }

  #calculateMaxAmount(feeRate) {
    // TODO fee may be a number ?
    const utxos = this.#unspentsForTx;
    const available = utxos
      .reduce((available, item) => available.add(new BN(item.amount, 10)), new BN(0));
    // 3 outputs with change
    const fee = new BN(monerolib.tx.estimateFee(utxos.length, 10, 3, 44,
      this.#baseFee, feeRate.feeMultiplier, this.#feeQuantizationMask), 10);
    if (available.lte(fee)) {
      return new BN(0);
    }
    const csFee = this.#reverseCsFee(available.sub(fee));
    const maxAmount = available.sub(fee).sub(csFee);
    if (maxAmount.ltn(0)) {
      return new BN(0);
    }
    return maxAmount;
  }

  estimateFees(value) {
    const amount = new BN(value, 10);
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
    if (value.gt(maxAmount)) {
      value = maxAmount;
    }

    const csFee = this.#calculateCsFee(value);

    if (utxos.length === 0) {
      // dummy 1 input
      const fee = new BN(monerolib.tx.estimateFee(1, 10, 3, 44,
        this.#baseFee, feeRate.feeMultiplier, this.#feeQuantizationMask), 10);
      const estimate = csFee.add(fee, 10);
      return {
        fee,
        csFee,
        change: new BN(0),
        estimate,
        maxAmount,
        sources: [],
      };
    }

    const accum = new BN(0);
    const sources = [];
    let ins = 0;

    for (const item of utxos) {
      ins++;
      accum.iadd(new BN(item.amount, 10));
      sources.push(item);
      if (accum.lte(value)) {
        continue;
      }
      // fee with change: 3 outputs
      const fee = new BN(monerolib.tx.estimateFee(ins, 10, 3, 44,
        this.#baseFee, feeRate.feeMultiplier, this.#feeQuantizationMask), 10);
      const estimate = csFee.add(fee);
      const total = value.add(estimate);
      let change = accum.sub(total);
      if (change.lte(this.#dustThreshold)) {
        if (csFee.isZero()) {
          fee.add(change);
        } else {
          csFee.add(change);
        }
        estimate.add(change);
        change = new BN(0);
      }
      if (total.lte(accum)) {
        return {
          fee,
          csFee,
          change,
          estimate,
          maxAmount,
          sources,
        };
      }
    }
    throw new Error(`fee could not be estimated for value ${value}`);
  }

  #parseAddress(str) {
    try {
      return this.#wallet.addressFromString(str);
    } catch (err) {
      console.error(err);
      throw new Error('Invalid address');
    }
  }

  async createTx(to, value, feeName) {
    const addressTo = this.#parseAddress(to);
    for (const address of this.#getAllAddresses()) {
      if (address.toString() === addressTo.toString()) {
        throw new Error('Destination address equal source address');
      }
    }

    const amount = new BN(value, 10);
    if (amount.lte(this.#dustThreshold)) {
      const error = new Error('Invalid value');
      error.dustThreshold = this.#dustThreshold.toString(10);
      throw error;
    }

    const feeRate = this.#feeRates.find(item => item.name === feeName);

    const { csFee, change, estimate, maxAmount, sources } = this.#estimateFee(amount, feeRate);

    if (amount.gt(maxAmount)) {
      const error = new Error('Insufficient funds');
      if (amount.lt(this.#balance)) {
        error.details = 'Additional funds confirmation pending';
      }
      throw error;
    }

    const destinations = [{
      amount: amount.toString(10),
      address: addressTo.toString(),
    }, {
      amount: change.toString(10),
      address: change.gtn(0) ? this.#getAddress('address').toString() : this.#getRandomAddress(),
    }, {
      amount: csFee.toString(10),
      address: csFee.gtn(0) ? this.#csFeeAddresses[0] : this.#getRandomAddress(),
    }];

    return {
      fee: estimate.toString(10),
      sources,
      destinations,
    };
  }

  async sendTx(tx) {
    // TODO create tx from params
    await this.#request({
      baseURL: this.#apiNode,
      url: 'api/v1/tx/send',
      data: {
        rawtx: tx.serialized_signed_tx,
      },
      method: 'post',
      seed: 'public',
    });
    await this.addTx(tx.tx_hash);
    return tx;
  }
}
