/* eslint-disable max-len */
import { Buffer } from 'buffer';
import assert from 'assert/strict';
import fs from 'fs/promises';
import sinon from 'sinon';

import { Amount } from '@coinspace/cs-common';
import { RequestError } from '@coinspace/cs-common/errors';
import Wallet from '@coinspace/cs-monero-wallet';

const RANDOM_SEED = Buffer.from('7363412d7c3e2041e5da425532915d4c003bc601ba0380c7c22ea3d90dc6e1937a575e8aa4dc64a678419b04507adeab65f028c6f2de0dfbd953dc3a0824213d', 'hex');
const RANDOM_PUBLIC_KEY = {
  data: {
    publicSpendKey: '96f4be74272e63b1d05ce2fbdef9f6db2de367bc7000af1d2b2eee4aecef194f',
    secretViewKey: '257082a0fc4938d0c54eb54b7c2efeddd171e8dd8cf8663eb0407e30189f7701',
  },
};
const WALLET_ADDRESS = '47LuCrMtrkiWk22fh1osk1dfKAuwAtr145syRSJfytJLEKuugyCJc2cAXhqBymbMAahufE3ngnqZ93KV6MMQgD7ZH3MVHwV';
const WALLET_SUBADDRESS = '83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB';
const DESTIONATION_ADDRESS = '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX';
const CS_FEE_ADDRESS = '45vtcKT7mxmNQt4PKmpnu4WCUhBa33WBVXtQVVh61Uv1fpK78cYuRNuFD4oxGcXnJYPwFMWPhN2dbH8NTMnoCk143e4TfJJ';
const INITIAL_KEY_IMAGES = {
  '2723afddf8797ca33aa8ccb9a2a52fe4f9f9102127b0038df96d130892154f3a-0-83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB': '57bc60fb31368ec2fe9e2b49c7e1d1cedfe88c93c6cca1449b9009574f36d28a',
};
const KEY_IMAGES = {
  ...INITIAL_KEY_IMAGES,
  '2140aa7572cdfd59232e09f61f615d0766e995c0b5d45bbd96bc03afb59f4e4a-0-83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB': '5f112b2c3031f0e05b7c66ed5e7217da90fb2fa8f960fc4514681156d808955a',
  '2b72fc9d6ae270e52cc5049e9a1db8af8d2dd58e921b96be95adf53ad0e61d36-0-47LuCrMtrkiWk22fh1osk1dfKAuwAtr145syRSJfytJLEKuugyCJc2cAXhqBymbMAahufE3ngnqZ93KV6MMQgD7ZH3MVHwV': '3df305973c3b1d4930fd6c1cc91c6aa8f57e5f793313ede681b53e77f3f78bcf',
};
const TX_IDS = [
  'a0cd9a954719e9de38dd31d59272644a310b0a85ba9618e7ffc102f38909f784',
  '01fd63eee0e247d63a01b28a36d46c6cb4597ccaa9f72f4f3b95ae4ae15bc815',
  '94d1ec6fa674d88656eb72a278bf597f0e48720f7e95e463d39e21f5c0d281a1',
  'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
  '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
  'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
  '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402',
  'cc007da08e61ff69045161e34f4fc7c5b3c5b6823c013bfcd23f8ef4202aa178',
];
const TX_ID_DOUBLE = '48735956e0ad25b83e6c48cd9d0441f71f1fff3925c3760ab918588832b8759f';
const CS_FEE = {
  address: CS_FEE_ADDRESS,
  fee: 0.005,
  minFee: 0.5,
  maxFee: 100,
};
const FEE = {
  fee: 231997,
  quantization_mask: 10000,
};
const FIXTURES = JSON.parse(await fs.readFile('./test/fixtures.json'));

function transactions(ids) {
  return JSON.parse(JSON.stringify(FIXTURES.filter((item) => ids.includes(item.txId))));
}

const moneroATmonero = {
  _id: 'monero@monero',
  asset: 'monero',
  platform: 'monero',
  type: 'coin',
  name: 'Monero',
  symbol: 'XMR',
  decimals: 12,
};

const COIN_PRICE = 150;

class Storage extends Map {
  save() {}
}

let defaultOptions;

describe('MoneroWallet', () => {
  beforeEach(() => {
    defaultOptions = {
      crypto: moneroATmonero,
      platform: moneroATmonero,
      cache: { get() {}, set() {} },
      settings: {},
      request(...args) { console.log(args); },
      apiNode: 'node',
      storage: new Storage([[
        'txIds', TX_IDS,
      ], [
        'keyImages', KEY_IMAGES,
      ], [
        'createdAt', Date.now(),
      ]]),
      txPerPage: 5,
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('create wallet instance', () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      assert.equal(wallet.state, Wallet.STATE_CREATED);
    });
  });

  describe('create wallet', () => {
    it('should create new wallet with seed', async () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.create(RANDOM_SEED);
      assert.equal(wallet.state, Wallet.STATE_INITIALIZED);
      assert.equal(wallet.address, WALLET_ADDRESS);
    });

    it('should fails without seed', async () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await assert.rejects(async () => {
        await wallet.create();
      }, {
        name: 'TypeError',
        message: 'seed must be an instance of Uint8Array or Buffer, undefined provided',
      });
    });
  });

  describe('open wallet', () => {
    it('should open wallet with public key', async () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      assert.equal(wallet.state, Wallet.STATE_INITIALIZED);
      assert.equal(wallet.address, WALLET_ADDRESS);
    });

    it('should fails without public key', async () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await assert.rejects(async () => {
        await wallet.open();
      }, {
        name: 'TypeError',
        message: 'publicKey must be an instance of Object with data property',
      });
    });
  });

  describe('address', () => {
    it('should return address', async () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      wallet.addressType = Wallet.ADDRESS_TYPE_ADDRESS;
      assert.equal(wallet.address, WALLET_ADDRESS);
    });

    it('should return subaddress', async () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      wallet.addressType = Wallet.ADDRESS_TYPE_SUBADDRESS;
      assert.equal(wallet.address, WALLET_SUBADDRESS);
    });
  });

  describe('storage', () => {
    it('should load initial balance from storage', async () => {
      sinon.stub(defaultOptions.storage, 'get')
        .withArgs('balance').returns('1234567890');
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      assert.equal(wallet.balance.value, 1234567890n);
    });
  });

  describe('load', () => {
    it('should load wallet', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS));
      const storage = sinon.mock(defaultOptions.storage);
      storage.expects('save').once();
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();
      assert.equal(wallet.state, Wallet.STATE_LOADED);
      assert.equal(wallet.balance.value, 13_622187809001n);
      storage.verify();
    });

    it('should set STATE_ERROR on error', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).rejects();
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await assert.rejects(async () => {
        await wallet.load();
      });
      assert.equal(wallet.state, Wallet.STATE_ERROR);
    });

    it('should fix doubled txs', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS));
      const storage = new Storage([[
        'txIds', [...TX_IDS, 'CC007da08e61ff69045161e34f4fc7c5b3c5b6823c013bfcd23f8ef4202aa178'],
      ], [
        'keyImages', KEY_IMAGES,
      ]]);
      const mock = sinon.mock(storage);
      mock.expects('set').withArgs('balance', '13622187809001').once();
      mock.expects('set').withArgs('createdAt', sinon.match.number).once();
      mock.expects('set').withArgs('txIds', TX_IDS).once();
      mock.expects('save').once();
      const wallet = new Wallet({
        ...defaultOptions,
        storage,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();
      assert.equal(wallet.state, Wallet.STATE_LOADED);
      assert.equal(wallet.balance.value, 13_622187809001n);
      mock.verify();
    });

    it('should load with valid lastTxId', async () => {
      const INITIAL_TX_IDS = [
        'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
        '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
        'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
      ];
      const LAST_TX_ID = '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402';
      const storage = new Storage([[
        'txIds', INITIAL_TX_IDS,
      ], [
        'keyImages', KEY_IMAGES,
      ], [
        'createdAt', Date.now(),
      ], [
        'lastTxId', LAST_TX_ID,
      ]]);
      const mock = sinon.mock(storage);
      mock.expects('set').withArgs('balance', '7123456789000').once();
      mock.expects('set').withArgs('balance', '5622187809000').once();
      mock.expects('set').withArgs('keyImages', KEY_IMAGES).once();
      mock.expects('set').withArgs('txIds', INITIAL_TX_IDS).once();
      mock.expects('set').withArgs('txIds', [...INITIAL_TX_IDS, LAST_TX_ID]).once();
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${INITIAL_TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(INITIAL_TX_IDS))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${LAST_TX_ID}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions([LAST_TX_ID]));
      const wallet = new Wallet({
        ...defaultOptions,
        storage,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();
      assert.equal(wallet.state, Wallet.STATE_LOADED);
      assert.equal(wallet.balance.value, 5_622187809000n);
      mock.verify();
    });

    it('should load with invalid lastTxId', async () => {
      const INITIAL_TX_IDS = [
        'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
        '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
        'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
      ];
      const LAST_TX_ID = '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402';
      const storage = new Storage([[
        'txIds', INITIAL_TX_IDS,
      ], [
        'keyImages', INITIAL_KEY_IMAGES,
      ], [
        'createdAt', Date.now(),
      ], [
        'lastTxId', LAST_TX_ID,
      ]]);
      const mock = sinon.mock(storage);
      mock.expects('set').withArgs('balance', '7123456789000').once();
      mock.expects('set').withArgs('txIds', INITIAL_TX_IDS).once();
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${INITIAL_TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(INITIAL_TX_IDS))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${LAST_TX_ID}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves([]);
      const wallet = new Wallet({
        ...defaultOptions,
        storage,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();
      assert.equal(wallet.state, Wallet.STATE_LOADED);
      assert.equal(wallet.balance.value, 7_123456789000n);
      mock.verify();
    });
  });

  describe('addTransaction', () => {
    it('should add valid transaction', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/txs/e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a',
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(['e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a']));
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      await wallet.addTransaction('e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a', RANDOM_SEED);
      assert.equal(wallet.balance.value, 9_604261829001n);
    });

    it('should not add transaction with invalid ID', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS));
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      await assert.rejects(async () => {
        await wallet.validateTransaction('foobar', RANDOM_SEED);
      }, {
        name: 'InvalidTransactionIDError',
        message: 'Invalid transaction ID: "foobar"',
      });
    });

    it('should not add already added transaction', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS));
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      await assert.rejects(async () => {
        await wallet.validateTransaction('b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678', RANDOM_SEED);
      }, {
        name: 'TransactionAlreadyAddedError',
        message: 'Transaction already added ID: "b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678"',
      });
    });

    it('should not add already added transaction (uppercase)', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS));
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      await assert.rejects(async () => {
        await wallet.validateTransaction('B973ADAFE966518E5EF69B69AC2F52048DF2273FB220321DC604E75B5F9A3678', RANDOM_SEED);
      }, {
        name: 'TransactionAlreadyAddedError',
        message: 'Transaction already added ID: "b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678"',
      });
    });

    it('should not add unknown transaction', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS));
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      await assert.rejects(async () => {
        await wallet.validateTransaction('a973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678', RANDOM_SEED);
      }, {
        name: 'UnknownTransactionError',
        message: 'Unknown transaction ID: "a973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678"',
      });
    });

    it('should not add not own transaction', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/txs/9a2b897624f9c1e37137511ddfa43944f5ed56cbf4f3cfb819b4d2f081c44848',
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(['9a2b897624f9c1e37137511ddfa43944f5ed56cbf4f3cfb819b4d2f081c44848']));
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      await assert.rejects(async () => {
        await wallet.addTransaction('9a2b897624f9c1e37137511ddfa43944f5ed56cbf4f3cfb819b4d2f081c44848', RANDOM_SEED);
      }, {
        name: 'NotYourTransactionError',
        message: 'Not your transaction ID: "9a2b897624f9c1e37137511ddfa43944f5ed56cbf4f3cfb819b4d2f081c44848"',
      });
    });

    it('should add transactions one by one', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: sinon.match(/^api\/v1\/txs\//),
          baseURL: 'node',
          headers: sinon.match.object,
        }).callsFake(({ url }) => {
          const ids = url.replace('api/v1/txs/', '').split(',');
          return transactions(ids);
        });

      const wallet = new Wallet({
        ...defaultOptions,
        storage: new Storage(),
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      for (const id of TX_IDS) {
        await wallet.addTransaction(id, RANDOM_SEED);
        await wallet.cleanup();
        await wallet.load();
      }
      assert.equal(wallet.balance.value, 13_622187809001n);
    });

    it('should add transactions one by one (reverse)', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: sinon.match(/^api\/v1\/txs\//),
          baseURL: 'node',
          headers: sinon.match.object,
        }).callsFake(({ url }) => {
          const ids = url.replace('api/v1/txs/', '').split(',');
          return transactions(ids);
        });

      const wallet = new Wallet({
        ...defaultOptions,
        storage: new Storage(),
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      const rev = [...TX_IDS];
      rev.reverse();
      for (const id of rev) {
        await wallet.addTransaction(id, RANDOM_SEED);
        await wallet.cleanup();
        await wallet.load();
      }
      assert.equal(wallet.balance.value, 13_622187809001n);
    });

    it('should add transaction with 2 own inputs', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_ID_DOUBLE}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_ID_DOUBLE));
      const wallet = new Wallet({
        ...defaultOptions,
        storage: new Storage(),
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      await wallet.addTransaction(TX_ID_DOUBLE, RANDOM_SEED);
      assert.equal(wallet.balance.value, 3_015000000000n);
    });
  });

  describe('getPublicKey', () => {
    it('should export public key', async () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.create(RANDOM_SEED);
      const publicKey = wallet.getPublicKey();
      assert.deepEqual(publicKey, RANDOM_PUBLIC_KEY);
    });

    it('public key is valid', async () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.create(RANDOM_SEED);
      const publicKey = wallet.getPublicKey();
      const secondWalet = new Wallet({
        ...defaultOptions,
      });
      secondWalet.open(publicKey);
      assert.equal(wallet.address, secondWalet.address);
    });
  });

  describe('getPrivateKey', () => {
    it('should export private key', async () => {
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.create(RANDOM_SEED);
      const privateKey = wallet.getPrivateKey(RANDOM_SEED);
      assert.deepEqual(privateKey, [{
        address: WALLET_ADDRESS,
        publicviewkey: 'abdfbf97f2a56138f8f175d54d6a8bf4928b8ed6e284a00ddcd1c2d49c41b48e',
        privateviewkey: '257082a0fc4938d0c54eb54b7c2efeddd171e8dd8cf8663eb0407e30189f7701',
        publicspendkey: '96f4be74272e63b1d05ce2fbdef9f6db2de367bc7000af1d2b2eee4aecef194f',
        privatespendkey: '84a4d4735070ddd74124e873f22bcc1471dd1163d1c1ca778cd9acfc0d6c260c',
      }]);
    });
  });

  describe('validators', () => {
    describe('validateAddress', () => {
      let wallet;
      beforeEach(async () => {
        sinon.stub(defaultOptions, 'request')
          .withArgs({
            seed: 'device',
            method: 'GET',
            url: `api/v1/txs/${TX_IDS.join(',')}`,
            baseURL: 'node',
            headers: sinon.match.object,
          }).resolves(transactions(TX_IDS));
        wallet = new Wallet({
          ...defaultOptions,
        });
        await wallet.open(RANDOM_PUBLIC_KEY);
        await wallet.load();
      });

      it('valid address', async () => {
        assert.ok(await wallet.validateAddress({ address: DESTIONATION_ADDRESS }));
      });

      it('invalid address', async () => {
        await assert.rejects(async () => {
          await wallet.validateAddress({ address: '123' });
        }, {
          name: 'InvalidAddressError',
          message: 'Invalid address "123"',
        });
      });

      it('own address', async () => {
        await assert.rejects(async () => {
          await wallet.validateAddress({ address: WALLET_ADDRESS });
        }, {
          name: 'DestinationEqualsSourceError',
          message: 'Destination address equals source address',
        });
      });

      it('own subaddress', async () => {
        await assert.rejects(async () => {
          await wallet.validateAddress({ address: WALLET_SUBADDRESS });
        }, {
          name: 'DestinationEqualsSourceError',
          message: 'Destination address equals source address',
        });
      });
    });

    describe('validateAmount', () => {
      let wallet;
      beforeEach(async () => {
        sinon.stub(defaultOptions, 'request')
          .withArgs({
            seed: 'device',
            method: 'GET',
            url: `api/v1/txs/${TX_IDS.join(',')}`,
            baseURL: 'node',
            headers: sinon.match.object,
          }).resolves(transactions(TX_IDS))
          .withArgs({
            seed: 'device',
            method: 'GET',
            url: 'api/v1/estimatefee',
            baseURL: 'node',
            headers: sinon.match.object,
          }).resolves(FEE)
          .withArgs({
            seed: 'device',
            method: 'GET',
            url: 'api/v4/csfee',
            params: { crypto: 'monero@monero' },
          }).resolves(CS_FEE);
        wallet = new Wallet({
          ...defaultOptions,
        });
        await wallet.open(RANDOM_PUBLIC_KEY);
        await wallet.load();
      });

      it('should be valid amount (default fee)', async () => {
        const valid = await wallet.validateAmount({
          address: DESTIONATION_ADDRESS,
          amount: new Amount(2_000000000000n, wallet.crypto.decimals),
          feeRate: Wallet.FEE_RATE_DEFAULT,
          price: COIN_PRICE,
        });
        assert.ok(valid);
      });

      it('should be valid amount (fastest fee)', async () => {
        const valid = await wallet.validateAmount({
          address: DESTIONATION_ADDRESS,
          amount: new Amount(2_000000000000n, wallet.crypto.decimals),
          feeRate: Wallet.FEE_RATE_FASTEST,
          price: COIN_PRICE,
        });
        assert.ok(valid);
      });

      it('throw on small amount', async () => {
        await assert.rejects(async () => {
          await wallet.validateAmount({
            address: DESTIONATION_ADDRESS,
            amount: new Amount(0n, wallet.crypto.decimals),
            feeRate: Wallet.FEE_RATE_DEFAULT,
            price: COIN_PRICE,
          });
        }, {
          name: 'SmallAmountError',
          message: 'Small amount',
          amount: new Amount(1n, wallet.crypto.decimals),
        });
      });

      it('throw on big amount', async () => {
        await assert.rejects(async () => {
          await wallet.validateAmount({
            address: DESTIONATION_ADDRESS,
            amount: new Amount(550_000000000000n, wallet.crypto.decimals),
            feeRate: Wallet.FEE_RATE_DEFAULT,
            price: COIN_PRICE,
          });
        }, {
          name: 'BigAmountError',
          message: 'Big amount',
          amount: new Amount(8_578130436817n, wallet.crypto.decimals),
        });
      });

      it('throw on big amount (unconfirmed)', async () => {
        await assert.rejects(async () => {
          await wallet.validateAmount({
            address: DESTIONATION_ADDRESS,
            amount: new Amount(10_000000000000n, wallet.crypto.decimals),
            feeRate: Wallet.FEE_RATE_DEFAULT,
            price: COIN_PRICE,
          });
        }, {
          name: 'BigAmountConfirmationPendingError',
          message: 'Big amount, confirmation pending',
          amount: new Amount(8_578130436817n, wallet.crypto.decimals),
        });
      });
    });
  });

  describe('estimateMaxAmount', () => {
    let wallet;
    beforeEach(async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/estimatefee',
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(FEE)
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v4/csfee',
          params: { crypto: 'monero@monero' },
        }).resolves(CS_FEE);
      wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();
    });

    it('should correct estimate max amount (default fee)', async () => {
      const maxAmount = await wallet.estimateMaxAmount({
        address: DESTIONATION_ADDRESS,
        feeRate: Wallet.FEE_RATE_DEFAULT,
        price: COIN_PRICE,
      });
      assert.equal(maxAmount.value, 8_578130436817n);
    });

    it('should correct estimate max amount (fastest fee)', async () => {
      const maxAmount = await wallet.estimateMaxAmount({
        address: DESTIONATION_ADDRESS,
        feeRate: Wallet.FEE_RATE_FASTEST,
        price: COIN_PRICE,
      });
      assert.equal(maxAmount.value, 8_550268635822n);
    });
  });

  describe('estimateTransactionFee', () => {
    let wallet;
    beforeEach(async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/estimatefee',
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(FEE)
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v4/csfee',
          params: { crypto: 'monero@monero' },
        }).resolves(CS_FEE);
      wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();
    });

    it('should estimate transaction fee (2 XMR, default fee)', async () => {
      const fee = await wallet.estimateTransactionFee({
        address: DESTIONATION_ADDRESS,
        amount: new Amount(2_000000000000n, wallet.crypto.decimals),
        feeRate: Wallet.FEE_RATE_DEFAULT,
        price: COIN_PRICE,
      });
      assert.equal(fee.value, 10518980000n);
    });

    it('should estimate transaction fee (2 XMR, fastest fee)', async () => {
      const fee = await wallet.estimateTransactionFee({
        address: DESTIONATION_ADDRESS,
        amount: new Amount(2_000000000000n, wallet.crypto.decimals),
        feeRate: Wallet.FEE_RATE_FASTEST,
        price: COIN_PRICE,
      });
      assert.equal(fee.value, 22974440000n);
    });

    it('should estimate transaction fee (max amount)', async () => {
      const fee = await wallet.estimateTransactionFee({
        address: DESTIONATION_ADDRESS,
        amount: new Amount(5_593212556220n, wallet.crypto.decimals),
        feeRate: Wallet.FEE_RATE_DEFAULT,
        price: COIN_PRICE,
      });
      assert.equal(fee.value, 28800092781n);
    });
  });

  describe('createTransaction', () => {
    it('should create valid transaction', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/txs/e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a',
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(['e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a']))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/estimatefee',
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(FEE)
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/outputs/random',
          params: sinon.match.object,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves([])
        .withArgs({
          seed: 'device',
          method: 'POST',
          url: 'api/v1/tx/send',
          data: sinon.match.object,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves({ txId: 'e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a' })
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v4/csfee',
          params: { crypto: 'monero@monero' },
        }).resolves(CS_FEE);
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      const id = await wallet.createTransaction({
        address: DESTIONATION_ADDRESS,
        amount: new Amount(4_000000000000n, wallet.crypto.decimals),
        feeRate: Wallet.FEE_RATE_DEFAULT,
        price: COIN_PRICE,
      }, RANDOM_SEED);
      assert.equal(wallet.balance.value, 9_604261829001n);
      assert.equal(id, 'e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a');
    });

    it('should save last tx id on fail', async () => {
      const storage = sinon.mock(defaultOptions.storage);
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/txs/e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a',
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(['e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a']))
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/estimatefee',
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(FEE)
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v1/outputs/random',
          params: sinon.match.object,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves([])
        .withArgs({
          seed: 'device',
          method: 'POST',
          url: 'api/v1/tx/send',
          data: sinon.match.object,
          baseURL: 'node',
          headers: sinon.match.object,
        }).rejects()
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: 'api/v4/csfee',
          params: { crypto: 'monero@monero' },
        }).resolves(CS_FEE);
      const wallet = new Wallet({
        ...defaultOptions,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      storage.expects('set').withArgs('lastTxId', sinon.match.string).once();
      storage.expects('set').withArgs('keyImages', KEY_IMAGES).once();
      storage.expects('save').once();

      await assert.rejects(async () => {
        await wallet.createTransaction({
          address: DESTIONATION_ADDRESS,
          amount: new Amount(4_000000000000n, wallet.crypto.decimals),
          feeRate: Wallet.FEE_RATE_DEFAULT,
          price: COIN_PRICE,
        }, RANDOM_SEED);
      }, {
        name: 'Error',
      });
      storage.verify();
    });
  });

  describe('loadTransactions', () => {
    it('should load transactions', async () => {
      sinon.stub(defaultOptions, 'request')
        .withArgs({
          seed: 'device',
          method: 'GET',
          url: `api/v1/txs/${TX_IDS.join(',')}`,
          baseURL: 'node',
          headers: sinon.match.object,
        }).resolves(transactions(TX_IDS));
      const wallet = new Wallet({
        ...defaultOptions,
        txPerPage: 5,
      });
      await wallet.open(RANDOM_PUBLIC_KEY);
      await wallet.load();

      const res = await wallet.loadTransactions();
      assert.strictEqual(res.hasMore, true);
      assert.strictEqual(res.transactions.length, 5);
      assert.strictEqual(res.cursor, 5);
    });
  });
});
