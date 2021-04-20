import monerolib from 'monerolib';
import HDKey from 'hdkey';

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

  get #txIds() {
    return this.#txs.map(item => item.txId);
  }

  get decimals() {
    return 12;
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

    if (options.seed) {
      this.#wallet = this.#walletFromSeed(options.seed);
      this.#isLocked = false;
    } else if (options.publicKey) {
      const keys = JSON.parse(options.publicKey);
      this.#wallet = this.#walletFromKeys(keys.publicSpendKey, keys.secretViewKey);
      this.#isLocked = true;
    } else {
      throw new TypeError('seed or publicKey should be passed');
    }

    this.#addressType = options.addressType || this.addressTypes[0];
  }

  #walletFromSeed(seed) {
    const hdkey = HDKey.fromMasterSeed(Buffer.from(seed, 'hex'));
    // https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
    // https://github.com/satoshilabs/slips/blob/master/slip-0044.md
    const base = hdkey.derive("m/44'/128'/0'");
    return new monerolib.Wallet({
      seed: base.privateKey,
    });
  }

  #walletFromKeys(publicSpendKey, secretViewKey) {
    return new monerolib.Wallet({
      publicSpendKey,
      secretViewKey,
    });
  }

  lock() {
    this.#wallet = this.#walletFromKeys(
      this.#wallet.publicSpendKey,
      this.#wallet.secretViewKey
    );
    this.#isLocked = true;
  }

  unlock(seed) {
    this.#wallet = this.#walletFromSeed(seed);
    this.#isLocked = false;
  }

  async load() {
    const txIds = (await this.#cache.get('txIds')) || [];
    const txs = await this.#loadTxs(txIds);
    this.#txs = txs.map((tx) => this.#parseTx(tx));
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
    return txs.flat();
  }

  #parseTx(tx) {
    let valid = false;
    for (const output of tx.outs) {
      const derivation = monerolib.cryptoUtil.generateKeyDerivation(output.txPubKey, this.#wallet.secretViewKey);
      for (const address of this.#getAllAddresses()) {
        const pubKey = monerolib.cryptoUtil.derivePublicKey(derivation, output.index, address.publicSpendKey);
        if (pubKey === output.targetKey) {
          valid = true;
          if (output.rctType !== monerolib.ringct.RCTTypes.Null) {
            const rct = monerolib.ringct.decodeRct(
              { amount: output.ecdhInfoAmount, mask: output.ecdhInfoMask },
              output.outPk,
              output.rctType,
              output.index,
              derivation
            );
            output.amount = rct.amount;
          }
        }
      }
    }
    /*
    for (const input of tx.ins) {
    }
    */
    if (!valid) {
      throw new Error('invalid transaction');
    }
    return tx;
  }

  publicKey() {
    return JSON.stringify({
      publicSpendKey: this.#wallet.publicSpendKey.toString('hex'),
      secretViewKey: this.#wallet.secretViewKey.toString('hex'),
    });
  }

  #getAddress(type) {
    if (type === 'address') {
      return this.#wallet.getAddress().toString();
    } else if (type === 'subaddress') {
      return this.#wallet.getSubaddress(0, 1).toString();
    }
  }

  #getAllAddresses() {
    return this.addressTypes.map((type) => this.#getAddress(type));
  }

  getNextAddress() {
    return this.#getAddress(this.#addressType);
  }

  async addTx(txId) {
    await this.addTxs([txId]);
  }

  async addTxs(txIds) {
    // check if already added
    txIds = txIds.filter(txId => !this.#txIds.includes(txId));
    const txs = await this.#loadTxs(txIds);
    this.#txs = this.#txs.concat(txs.map((tx) => this.#parseTx(tx)));
    await this.#cache.set('txIds', this.#txIds);
  }
}
