export default class API {
  #wallet;
  constructor(wallet) {
    this.#wallet = wallet;
  }

  async feeConfig() {
    const result = await this.#wallet.requestNode({
      url: 'api/v1/estimatefee',
      method: 'GET',
      seed: 'device',
    });
    return {
      baseFee: result.fee,
      feeQuantizationMask: result.quantization_mask,
    };
  }

  async transactions(ids) {
    return this.#wallet.requestNode({
      url: `api/v1/txs/${ids.join(',')}`,
      method: 'GET',
      seed: 'device',
    });
  }

  async randomOutputs(count = 16, height) {
    return this.#wallet.requestNode({
      url: 'api/v1/outputs/random',
      params: {
        count,
        height,
      },
      method: 'GET',
      seed: 'device',
    });
  }

  async sendTransaction(rawtx) {
    const { txId } = await this.#wallet.requestNode({
      url: 'api/v1/tx/send',
      data: {
        rawtx,
      },
      method: 'POST',
      seed: 'device',
    });
    return txId;
  }
}
