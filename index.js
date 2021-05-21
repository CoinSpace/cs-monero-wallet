import monerolib from 'monerolib';
import HDKey from 'hdkey';
import BN from 'bn.js';

const TXIDS_CHUNK = 50;

export default class MoneroWallet {
  #wallet;
  #cache;
  #request;
  #apiNode;
  #apiWeb;
  #addressType;
  #isLocked;
  #txs = [];
  #outputs = new Map();
  #cachedKeyImages;
  #maxTxInputs;
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
    return Array.from(this.#outputs.values()).filter(item => item.spent !== true);
  }

  get #unspentsForTx() {
    return Array.from(this.#outputs.values()).filter(item => item.spent !== true && item.height !== -1)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, this.#maxTxInputs);
  }

  get balance() {
    return this.#unspents
      .reduce((balance, item) => balance.add(new BN(item.amount, 10)), new BN(0))
      .toString(10);
  }

  constructor(options = {}) {
    if (!options.cache) {
      throw new TypeError('cache should be passed');
    }
    this.#cache = options.cache;

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
    this.#cachedKeyImages = (await this.#cache.get('keyImages')) || {};

    const txIds = (await this.#cache.get('txIds')) || [];
    this.#txs = await this.#loadTxs(txIds);
    for (const tx of this.#txs) {
      this.#processTx(tx);
    }
    await this.#cache.set('txIds', this.#txIds);

    if (!await this.#cache.get('createdAt')) {
      await this.#cache.set('createdAt', Date.now());
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
              tx.ours = true;

              this.#outputs.set(`${tx.txId}:${output.targetKey}`, {
                txId: tx.txId,
                derivation,
                address: address.index,
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
      for (const keyOutput of input.keyOutputs) {
        if (this.#outputs.has(`${keyOutput.txId}:${keyOutput.targetKey}`)) {
          const output = this.#outputs.get(`${keyOutput.txId}:${keyOutput.targetKey}`);
          const address = this.#wallet.getSubaddress(output.address.major, output.address.minor);
          const keyImage = this.#generateKeyImage(output.derivation, output.index, address);
          if (keyImage === input.keyImage) {
            // spent
            output.spent = true;
            tx.ours = true;
          }
        }
      }
    }

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
    await this.#cache.set('txIds', this.#txIds);
    await this.#cache.set('keyImages', this.#cachedKeyImages);
  }

  async loadTxs() {
    // TODO implement
    return { txs: [] };
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
    if (maxAmount.lten(0)) {
      return new BN(0);
    }
    return maxAmount;
  }

  estimateFees(value) {
    return this.#feeRates.map((feeRate) => {
      const info = this.#estimateFee(value, feeRate);
      return {
        name: feeRate.name,
        default: feeRate.default === true,
        estimate: info.estimate,
        maxAmount: info.maxAmount,
      };
    });
  }

  #estimateFee(value, feeRate) {
    let amount = new BN(value, 10);
    const utxos = this.#unspentsForTx;

    const maxAmount = this.#calculateMaxAmount(feeRate);
    if (amount.gt(maxAmount)) {
      amount = maxAmount;
    }

    const csFee = this.#calculateCsFee(amount);
    const accum = new BN(0);
    let ins = 0;

    for (const item of utxos) {
      ins++;
      accum.iadd(new BN(item.amount, 10));
      if (accum.lte(amount)) {
        continue;
      }
      // fee with change: 3 outputs
      const fee = monerolib.tx.estimateFee(ins, 10, 3, 44,
        this.#baseFee, feeRate.feeMultiplier, this.#feeQuantizationMask);
      const estimate = csFee.add(new BN(fee, 10));
      const total = amount.add(estimate);
      if (total.lte(accum)) {
        return {
          estimate,
          maxAmount,
        };
      }
    }
    throw new Error(`fee could not be estimated for value ${value}`);
  }


  async createTx(to, value, priority=3) {
    // Priority may be 0,1,2,3
    if (typeof priority === 'string') priority = parseInt(priority);

    const mymonero = await import('@coinspace/monero-core-js');
    const bridge = await mymonero.default.monero_utils_promise;

    return new Promise((resolve, reject) => {
      bridge.async__send_funds({
        is_sweeping: false,
        payment_id_string: undefined,
        sending_amount: '' + value, // should be a string
        sending_all: false,
        from_address_string: this.getNextAddress(),
        sec_viewKey_string: this.#wallet.secretViewKey.toString('hex'),
        sec_spendKey_string: this.#wallet.secretSpendKey.toString('hex'),
        pub_spendKey_string: this.#wallet.publicSpendKey.toString('hex'),
        to_address_string: to,
        priority,
        unlock_time: 0, // unlock_time
        nettype: 0, // MAINNET
        get_unspent_outs_fn: async (req, cb) => {
          const outputs = this.#unspentsForTx.map((item) => {
            return {
              amount: item.amount,
              public_key: item.targetKey,
              rct: item.outPk,
              global_index: item.globalIndex,
              index: item.index,
              tx_pub_key: item.txPubKey,
              // TODO figure out why the key images needed
              spend_key_images: [],
            };
          });
          // TODO request API for fee
          const fee = 187610000;
          cb(null, {
            outputs,
            per_kb_fee: fee,
          });
        },
        get_random_outs_fn: async (req, cb) => {
          const res = [];
          for (const amount of req.amounts) {
            const random = await this.#request({
              baseURL: this.#apiNode,
              url: 'api/v1/outputs/random',
              params: {
                count: req.count,
              },
              method: 'get',
              seed: 'public',
            });
            res.push({
              amount,
              outputs: random.map((item) => {
                return {
                  public_key: item.targetKey,
                  rct: item.outPk,
                  global_index: item.globalIndex,
                };
              }),
            });
          }
          cb(null, {
            amount_outs: res,
          });
        },
        status_update_fn: (status) => console.log('status:', status),
        submit_raw_tx_fn: (res, cb) => {
          // pass through
          cb(null, {});
        },
        success_fn: (res) => resolve(res),
        error_fn: (err) => reject(err),
      });
    });
  }

  async sendTx(tx) {
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
