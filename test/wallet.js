import fs from 'fs/promises';
import assert from 'assert';
import MoneroWallet from '../index.js';

// eslint-disable-next-line max-len
const RANDOM_SEED = '7363412d7c3e2041e5da425532915d4c003bc601ba0380c7c22ea3d90dc6e1937a575e8aa4dc64a678419b04507adeab65f028c6f2de0dfbd953dc3a0824213d';
// eslint-disable-next-line max-len
const RANDOM_PUBLIC_KEY = '{"publicSpendKey":"96f4be74272e63b1d05ce2fbdef9f6db2de367bc7000af1d2b2eee4aecef194f","secretViewKey":"257082a0fc4938d0c54eb54b7c2efeddd171e8dd8cf8663eb0407e30189f7701"}';
const NOOP = (...args) => { console.log(args); };
const crypto = {
  platform: 'monero',
};
const cache = { get: () => {}, set: () => {} };
class Storage extends Map {
  init() {}
}

async function mockRequest(config) {
  if (config.baseURL === 'node') {
    if (config.url === 'api/v1/estimatefee') {
      return {
        fee: 231997,
        quantization_mask: 10000,
      };
    } else if (config.url.startsWith('api/v1/txs/')) {
      const fixtures = JSON.parse(await fs.readFile('./test/fixtures.json'));
      const txIds = config.url.replace('api/v1/txs/', '').split(',');
      return fixtures.filter((item) => txIds.includes(item.txId));
    } else if (config.url === 'api/v1/outputs/random') {
      return [];
    } else if (config.url === 'api/v1/tx/send') {
      assert(config.data.rawtx);
      return {
        txId: 'e28464110a36f76bff7e2524a74403936c244a91773d80be3e7fde12efe45b1a',
      };
    }
  } else {
    if (config.url === 'api/v3/csfee') {
      return {
        addresses: ['45vtcKT7mxmNQt4PKmpnu4WCUhBa33WBVXtQVVh61Uv1fpK78cYuRNuFD4oxGcXnJYPwFMWPhN2dbH8NTMnoCk143e4TfJJ'],
        fee: 0.0005,
        maxFee: 170120104793,
        minFee: 340240209,
        rbfFee: 0,
        whitelist: [],
      };
    }
  }
  console.log(config);
}

describe('Wallet', () => {
  describe('constructor', () => {
    it('with seed', () => {
      const wallet = new MoneroWallet({
        seed: RANDOM_SEED,
        storage: new Storage(),
        request: NOOP,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      assert.strictEqual(wallet.isLocked, false);
    });

    it('with publicKey', () => {
      const wallet = new MoneroWallet({
        publicKey: RANDOM_PUBLIC_KEY,
        storage: new Storage(),
        request: NOOP,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      assert.strictEqual(wallet.isLocked, true);
    });
  });

  describe('lock', () => {
    it('works', () => {
      const wallet = new MoneroWallet({
        seed: RANDOM_SEED,
        storage: new Storage(),
        request: NOOP,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      assert.strictEqual(wallet.isLocked, false);
      wallet.lock();
      assert.strictEqual(wallet.isLocked, true);
    });
  });

  describe('unlock', () => {
    it('works', () => {
      const wallet = new MoneroWallet({
        publicKey: RANDOM_PUBLIC_KEY,
        storage: new Storage(),
        request: NOOP,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      assert.strictEqual(wallet.isLocked, true);
      wallet.unlock(RANDOM_SEED);
      assert.strictEqual(wallet.isLocked, false);
    });
  });

  describe('publicKey', () => {
    it('key is valid', () => {
      const wallet = new MoneroWallet({
        seed: RANDOM_SEED,
        storage: new Storage(),
        request: NOOP,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      const publicKey = wallet.publicKey();
      assert.strictEqual(publicKey, RANDOM_PUBLIC_KEY);
    });
  });

  describe('balance', () => {
    it('should works with empty wallet', async () => {
      const wallet = new MoneroWallet({
        seed: RANDOM_SEED,
        storage: new Storage(),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      await wallet.load();
      assert.strictEqual(wallet.balance, '0');
    });

    it('calculates balance correct with full wallet', async () => {
      const wallet = new MoneroWallet({
        seed: RANDOM_SEED,
        storage: new Storage([[
          'txIds', [
            'a0cd9a954719e9de38dd31d59272644a310b0a85ba9618e7ffc102f38909f784',
            '01fd63eee0e247d63a01b28a36d46c6cb4597ccaa9f72f4f3b95ae4ae15bc815',
            '94d1ec6fa674d88656eb72a278bf597f0e48720f7e95e463d39e21f5c0d281a1',
            'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
            '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
            'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
            '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402',
            'cc007da08e61ff69045161e34f4fc7c5b3c5b6823c013bfcd23f8ef4202aa178',
          ],
        ]]),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      await wallet.load();
      assert.strictEqual(wallet.balance, '13622187809001');
    });

    it('calculates balance correct with locked wallet', async () => {
      const wallet = new MoneroWallet({
        publicKey: RANDOM_PUBLIC_KEY,
        storage: new Storage([[
          'txIds', [
            'a0cd9a954719e9de38dd31d59272644a310b0a85ba9618e7ffc102f38909f784',
            '01fd63eee0e247d63a01b28a36d46c6cb4597ccaa9f72f4f3b95ae4ae15bc815',
            '94d1ec6fa674d88656eb72a278bf597f0e48720f7e95e463d39e21f5c0d281a1',
            'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
            '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
            'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
            '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402',
            'cc007da08e61ff69045161e34f4fc7c5b3c5b6823c013bfcd23f8ef4202aa178',
          ]], [
          'keyImages', {
            // eslint-disable-next-line max-len
            '2723afddf8797ca33aa8ccb9a2a52fe4f9f9102127b0038df96d130892154f3a-0-83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB': '57bc60fb31368ec2fe9e2b49c7e1d1cedfe88c93c6cca1449b9009574f36d28a',
          },
        ]]),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      await wallet.load();
      assert.strictEqual(wallet.balance, '13622187809001');
    });
  });

  describe('estimateFees', () => {
    it('should estimate correct with empty wallet', async () => {
      const wallet = new MoneroWallet({
        publicKey: RANDOM_PUBLIC_KEY,
        storage: new Storage(),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      await wallet.load();
      assert.deepStrictEqual(wallet.estimateFees('0'), [
        {
          name: 'default',
          default: true,
          estimate: '859220209',
          maxAmount: '0',
        },
        {
          name: 'fastest',
          default: false,
          estimate: '13314680209',
          maxAmount: '0',
        },
      ]);
    });

    it('should estimate correct (value 0)', async () => {
      const wallet = new MoneroWallet({
        publicKey: RANDOM_PUBLIC_KEY,
        storage: new Storage([[
          'txIds', [
            'a0cd9a954719e9de38dd31d59272644a310b0a85ba9618e7ffc102f38909f784',
            '01fd63eee0e247d63a01b28a36d46c6cb4597ccaa9f72f4f3b95ae4ae15bc815',
            '94d1ec6fa674d88656eb72a278bf597f0e48720f7e95e463d39e21f5c0d281a1',
            'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
            '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
            'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
            '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402',
            'cc007da08e61ff69045161e34f4fc7c5b3c5b6823c013bfcd23f8ef4202aa178',
          ]], [
          'keyImages', {
            // eslint-disable-next-line max-len
            '2723afddf8797ca33aa8ccb9a2a52fe4f9f9102127b0038df96d130892154f3a-0-83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB': '57bc60fb31368ec2fe9e2b49c7e1d1cedfe88c93c6cca1449b9009574f36d28a',
          },
        ]]),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      await wallet.load();
      assert.deepStrictEqual(wallet.estimateFees('0'), [
        {
          name: 'default',
          default: true,
          estimate: '859220209',
          maxAmount: '8616572912545',
        },
        {
          name: 'fastest',
          default: false,
          estimate: '13314680209',
          maxAmount: '8585230013995',
        },
      ]);
    });

    it('should estimate correct (value gt max amount)', async () => {
      const wallet = new MoneroWallet({
        publicKey: RANDOM_PUBLIC_KEY,
        storage: new Storage([[
          'txIds', [
            'a0cd9a954719e9de38dd31d59272644a310b0a85ba9618e7ffc102f38909f784',
            '01fd63eee0e247d63a01b28a36d46c6cb4597ccaa9f72f4f3b95ae4ae15bc815',
            '94d1ec6fa674d88656eb72a278bf597f0e48720f7e95e463d39e21f5c0d281a1',
            'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
            '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
            'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
            '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402',
            'cc007da08e61ff69045161e34f4fc7c5b3c5b6823c013bfcd23f8ef4202aa178',
          ]], [
          'keyImages', {
            // eslint-disable-next-line max-len
            '2723afddf8797ca33aa8ccb9a2a52fe4f9f9102127b0038df96d130892154f3a-0-83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB': '57bc60fb31368ec2fe9e2b49c7e1d1cedfe88c93c6cca1449b9009574f36d28a',
          },
        ]]),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      await wallet.load();
      assert.deepStrictEqual(wallet.estimateFees('100000000000000'), [
        {
          name: 'default',
          default: true,
          estimate: '51306610000',
          maxAmount: '8616572912545',
        },
        {
          name: 'fastest',
          default: false,
          estimate: '82665180000',
          maxAmount: '8585230013995',
        },
      ]);
    });
  });

  describe('getNextAddress', () => {
    let wallet;
    beforeEach(() => {
      wallet = new MoneroWallet({
        publicKey: RANDOM_PUBLIC_KEY,
        storage: new Storage(),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
    });

    it('should return standard address by default', () => {
      assert.deepStrictEqual(wallet.getNextAddress(),
        '47LuCrMtrkiWk22fh1osk1dfKAuwAtr145syRSJfytJLEKuugyCJc2cAXhqBymbMAahufE3ngnqZ93KV6MMQgD7ZH3MVHwV');
    });

    it('should return subaddress', () => {
      wallet.addressType = 'subaddress';
      assert.deepStrictEqual(wallet.getNextAddress(),
        '83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB');
    });

    it('should fail on incorrect address type', () => {
      assert.throws(() => {
        wallet.addressType = 'foobar';
      }, {
        message: 'unsupported address type',
      });
    });
  });

  describe('createTx', () => {
    let wallet;
    beforeEach(async () => {
      wallet = new MoneroWallet({
        publicKey: RANDOM_PUBLIC_KEY,
        storage: new Storage([[
          'txIds', [
            'a0cd9a954719e9de38dd31d59272644a310b0a85ba9618e7ffc102f38909f784',
            '01fd63eee0e247d63a01b28a36d46c6cb4597ccaa9f72f4f3b95ae4ae15bc815',
            '94d1ec6fa674d88656eb72a278bf597f0e48720f7e95e463d39e21f5c0d281a1',
            'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
            '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
            'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
            '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402',
            'cc007da08e61ff69045161e34f4fc7c5b3c5b6823c013bfcd23f8ef4202aa178',
          ]], [
          'keyImages', {
            // eslint-disable-next-line max-len
            '2723afddf8797ca33aa8ccb9a2a52fe4f9f9102127b0038df96d130892154f3a-0-83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB': '57bc60fb31368ec2fe9e2b49c7e1d1cedfe88c93c6cca1449b9009574f36d28a',
          },
        ]]),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      await wallet.load();
    });

    it('should fail (small amount)', async () => {
      await assert.rejects(async () => {
        await wallet.createTx(
          '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
          '0',
          '859220209'
        );
      }, {
        message: 'Invalid value',
      });
    });

    it('should fail (big amount)', async () => {
      await assert.rejects(async () => {
        await wallet.createTx(
          '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
          '100000000000000',
          '50000000000'
        );
      }, {
        message: 'Insufficient funds',
      });
    });

    it('should fail (invalid fee)', async () => {
      await assert.rejects(async () => {
        await wallet.createTx(
          '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
          '1000000000000',
          '500000000'
        );
      }, {
        message: 'Invalid fee',
      });
    });

    it('should fail (gt max amount but lt balance)', async () => {
      await assert.rejects(async () => {
        await wallet.createTx(
          '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
          '13000000000000',
          '6500000000'
        );
      }, {
        message: 'Insufficient funds',
        details: 'Additional funds confirmation pending',
      });
    });

    it('should create valid transaction with 1 input', async () => {
      const tx = await wallet.createTx(
        '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
        '1000000000000',
        '1018980000'
      );
      assert.strictEqual(tx.sources.length, 1);
      assert.strictEqual(tx.sources[0].amount, '3000000000000');
      assert.deepStrictEqual(tx.destinations, [{
        // destinaton
        amount: '1000000000000',
        address: '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
      }, {
        // fee
        amount: '500000000',
        address: '45vtcKT7mxmNQt4PKmpnu4WCUhBa33WBVXtQVVh61Uv1fpK78cYuRNuFD4oxGcXnJYPwFMWPhN2dbH8NTMnoCk143e4TfJJ',
      }, {
        // change
        amount: '1998981020000',
        address: '47LuCrMtrkiWk22fh1osk1dfKAuwAtr145syRSJfytJLEKuugyCJc2cAXhqBymbMAahufE3ngnqZ93KV6MMQgD7ZH3MVHwV',
      }]);
    });

    it('should create valid transaction with many inputs', async () => {
      const tx = await wallet.createTx(
        '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
        '8500000000000',
        '5399090000'
      );
      assert.strictEqual(tx.sources.length, 5);
      assert.strictEqual(tx.sources[0].amount, '3000000000000');
      assert.strictEqual(tx.sources[1].amount, '2498731020000');
      assert.strictEqual(tx.sources[2].amount, '2000000000000');
      assert.strictEqual(tx.sources[3].amount, '1000000000000');
      assert.strictEqual(tx.sources[4].amount, '123456789000');
      assert.deepStrictEqual(tx.destinations, [{
        // destinaton
        amount: '8500000000000',
        address: '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
      }, {
        // fee
        amount: '4250000000',
        address: '45vtcKT7mxmNQt4PKmpnu4WCUhBa33WBVXtQVVh61Uv1fpK78cYuRNuFD4oxGcXnJYPwFMWPhN2dbH8NTMnoCk143e4TfJJ',
      }, {
        // change
        amount: '116788719000',
        address: '47LuCrMtrkiWk22fh1osk1dfKAuwAtr145syRSJfytJLEKuugyCJc2cAXhqBymbMAahufE3ngnqZ93KV6MMQgD7ZH3MVHwV',
      }]);
    });

    it('should create valid transaction with max amount', async () => {
      const tx = await wallet.createTx(
        '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
        '8616572912545',
        '5614896456'
      );
      assert.strictEqual(tx.sources.length, 6);
      assert.strictEqual(tx.sources[0].amount, '3000000000000');
      assert.strictEqual(tx.sources[1].amount, '2498731020000');
      assert.strictEqual(tx.sources[2].amount, '2000000000000');
      assert.strictEqual(tx.sources[3].amount, '1000000000000');
      assert.strictEqual(tx.sources[4].amount, '123456789000');
      assert.strictEqual(tx.sources[5].amount, '1');
      assert.deepStrictEqual(tx.destinations, [{
        // destinaton
        amount: '8616572912545',
        address: '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
      }, {
        // fee
        amount: '4308286456',
        address: '45vtcKT7mxmNQt4PKmpnu4WCUhBa33WBVXtQVVh61Uv1fpK78cYuRNuFD4oxGcXnJYPwFMWPhN2dbH8NTMnoCk143e4TfJJ',
      }, {
        // change
        amount: '0',
        address: '888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H',
      }]);
    });
  });

  describe('sendTx', () => {
    it('should create and send valid transaction', async () => {
      const wallet = new MoneroWallet({
        seed: RANDOM_SEED,
        storage: new Storage([[
          'txIds', [
            'a0cd9a954719e9de38dd31d59272644a310b0a85ba9618e7ffc102f38909f784',
            '01fd63eee0e247d63a01b28a36d46c6cb4597ccaa9f72f4f3b95ae4ae15bc815',
            '94d1ec6fa674d88656eb72a278bf597f0e48720f7e95e463d39e21f5c0d281a1',
            'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
            '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
            'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
            '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402',
            'cc007da08e61ff69045161e34f4fc7c5b3c5b6823c013bfcd23f8ef4202aa178',
          ]], [
          'keyImages', {
            // eslint-disable-next-line max-len
            '2723afddf8797ca33aa8ccb9a2a52fe4f9f9102127b0038df96d130892154f3a-0-83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB': '57bc60fb31368ec2fe9e2b49c7e1d1cedfe88c93c6cca1449b9009574f36d28a',
          },
        ]]),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      await wallet.load();
      assert.strictEqual(wallet.balance, '13622187809001');

      const tx = await wallet.sendTx(await wallet.createTx(
        '46a8AU2ZbHoNZVHjByoQgQAxaFxX9bCkzgqQLZ7j6r3ugUPGYpHf83X9PXHyvyX5A9XJiG58q4RXKhgyQVHojQkNKUJzBsX',
        '4000000000000',
        '17925980000'
      ));

      assert(tx);
      assert.strictEqual(wallet.balance, '9604261829001');
    });
  });

  describe('loadTxs', () => {
    it('works', async () => {
      const wallet = new MoneroWallet({
        publicKey: RANDOM_PUBLIC_KEY,
        storage: new Storage([[
          'txIds', [
            'a0cd9a954719e9de38dd31d59272644a310b0a85ba9618e7ffc102f38909f784',
            '01fd63eee0e247d63a01b28a36d46c6cb4597ccaa9f72f4f3b95ae4ae15bc815',
            '94d1ec6fa674d88656eb72a278bf597f0e48720f7e95e463d39e21f5c0d281a1',
            'b973adafe966518e5ef69b69ac2f52048df2273fb220321dc604e75b5f9a3678',
            '8f5fb6b4f4c3c5a902e4ca42a7f4c4f0bdb9d61d3634ab5b46a6217f1b8b04ad',
            'cc792ff7e5616ca6af4a1f0d520a9d7726cc486af44d13e3a26dbbf384253931',
            '939fc6c6f172e4724e16e47ad08d9900d0e873a0d6fb969c63c86d2af1b27402',
            'cc007da08e61ff69045161e34f4fc7c5b3c5b6823c013bfcd23f8ef4202aa178',
          ]], [
          'keyImages', {
            // eslint-disable-next-line max-len
            '2723afddf8797ca33aa8ccb9a2a52fe4f9f9102127b0038df96d130892154f3a-0-83dJgBZoaky1976Hb2ocaEDn4zQDVgexoWKWxcFEaofAZMkR2Z3zETbA2pFaaMjZ6PCBwPiMvhaKTAcpB37z5fgFJLcNJHB': '57bc60fb31368ec2fe9e2b49c7e1d1cedfe88c93c6cca1449b9009574f36d28a',
          },
        ]]),
        request: mockRequest,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });
      await wallet.load();
      const res = await wallet.loadTxs();
      assert.strictEqual(res.hasMoreTxs, true);
      assert.strictEqual(res.txs.length, 5);
    });
  });

  describe('exportPrivateKeys', () => {
    it('works', () => {
      const wallet = new MoneroWallet({
        seed: RANDOM_SEED,
        storage: new Storage(),
        request: NOOP,
        apiNode: 'node',
        apiWeb: 'web',
        crypto,
        cache,
      });

      // eslint-disable-next-line max-len
      const expected = 'address,secretviewkey,secretspendkey\n47LuCrMtrkiWk22fh1osk1dfKAuwAtr145syRSJfytJLEKuugyCJc2cAXhqBymbMAahufE3ngnqZ93KV6MMQgD7ZH3MVHwV,257082a0fc4938d0c54eb54b7c2efeddd171e8dd8cf8663eb0407e30189f7701,84a4d4735070ddd74124e873f22bcc1471dd1163d1c1ca778cd9acfc0d6c260c';
      assert.strictEqual(wallet.exportPrivateKeys(), expected);
    });
  });
});
