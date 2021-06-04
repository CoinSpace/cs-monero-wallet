import BigNumber from 'bignumber.js';

export function calculateCsFee(value, csFeeOff, csFee, csMinFee, csMaxFee) {
  if (csFeeOff) {
    return new BigNumber(0);
  }
  let fee = value.multipliedBy(csFee).integerValue(BigNumber.ROUND_DOWN);
  fee = BigNumber.maximum(fee, csMinFee);
  fee = BigNumber.minimum(fee, csMaxFee);
  return fee;
}

// value = value + csFee
export function reverseCsFee(value, csFeeOff, csFee, csMinFee, csMaxFee) {
  if (csFeeOff) {
    return new BigNumber(0);
  }
  // maybe 1^-12 bigger then actual fee
  let reverse = value.multipliedBy(csFee / (1 + csFee)).integerValue(BigNumber.ROUND_DOWN);
  reverse = BigNumber.maximum(reverse, csMinFee);
  reverse = BigNumber.minimum(reverse, csMaxFee);
  const fee = calculateCsFee(value.minus(reverse), csFeeOff, csFee, csMinFee, csMaxFee);
  return BigNumber.maximum(reverse, fee);
}
