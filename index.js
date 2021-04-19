import monerolib from 'monerolib';
import HDKey from 'hdkey';

export default class MoneroWallet {
  #wallet;
  #cache;
  #addressType;
  #isLocked;

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
    const base = hdkey.derive("m / 44' / 128' / 0'");
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

  getNextAddress() {
    return this.#getAddress(this.#addressType);
  }
}
