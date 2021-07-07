import assert from 'assert';
import { calculateCsFee, reverseCsFee } from '../lib/fee.js';
import BigNumber from 'bignumber.js';

describe('fee', () => {
  describe('cs fee calculation', () => {
    it('to be zero if fee is off', () => {
      const value = new BigNumber('10000000000000');
      const fee = calculateCsFee(value, true, 0.0005, '100000000', '100000000000');
      assert(fee.isZero());
    });

    it('to be minimum fee (bigger then value)', () => {
      const value = new BigNumber('1');
      const fee = calculateCsFee(value, false, 0.0005, '100000000', '100000000000');
      assert(fee.isEqualTo('100000000'));
    });

    it('to be minimum fee', () => {
      const value = new BigNumber('199999999999');
      const fee = calculateCsFee(value, false, 0.0005, '100000000', '100000000000');
      assert(fee.isEqualTo('100000000'));
    });

    it('to be right', () => {
      const value = new BigNumber('4000000000000');
      const fee = calculateCsFee(value, false, 0.0005, '100000000', '100000000000');
      assert(fee.isEqualTo('2000000000'));
    });

    it('to be maximum fee', () => {
      const value = new BigNumber('500000000000000');
      const fee = calculateCsFee(value, false, 0.0005, '100000000', '100000000000');
      assert(fee.isEqualTo('100000000000'));
    });

    it('to be zero if skip minimum is true', () => {
      const value = new BigNumber('199999999999');
      const fee = calculateCsFee(value, false, 0.0005, '100000000', '100000000000', true);
      assert(fee.isZero());
    });
  });

  describe('cs fee reverse calculation', () => {
    it('to be zero if fee is off', () => {
      const value = new BigNumber('10000000000000');
      const fee = reverseCsFee(value, true, 0.0005, '100000000', '100000000000');
      assert(fee.isZero());
    });

    it('to be minimum fee (bigger then value)', () => {
      const value = new BigNumber('1');
      const fee = reverseCsFee(value, false, 0.0005, '100000000', '100000000000');
      assert(fee.isEqualTo('100000000'));
    });

    it('to be minimum fee', () => {
      const value = new BigNumber('199999999999');
      const fee = reverseCsFee(value, false, 0.0005, '100000000', '100000000000');
      assert(fee.isEqualTo('100000000'));
    });

    it('to be right', () => {
      const value = new BigNumber('4002000000000');
      const fee = reverseCsFee(value, false, 0.0005, '100000000', '100000000000');
      assert(fee.isEqualTo('2000000000'));
    });

    it('to be maximum fee', () => {
      const value = new BigNumber('500000000000000');
      const fee = reverseCsFee(value, false, 0.0005, '100000000', '100000000000');
      assert(fee.isEqualTo('100000000000'));
    });

    it('to be zero if skip minimum is true', () => {
      const value = new BigNumber('199999999999');
      const fee = reverseCsFee(value, false, 0.0005, '100000000', '100000000000', true);
      assert(fee.isZero());
    });
  });

  describe('cs fee self check reverse calculation', () => {
    it('calculation should match reverse calculation', () => {
      for (let num = 0; num <= 10000; num++) {
        const value = new BigNumber('10000000000000').plus(num);
        const reverse = reverseCsFee(value, false, 0.0005, '100000000', '100000000000');
        const fee = calculateCsFee(value.minus(reverse), false, 0.0005, '100000000', '100000000000');
        assert(reverse.isEqualTo(fee) || reverse.minus(fee).isEqualTo(1));
      }
    });
  });
});
