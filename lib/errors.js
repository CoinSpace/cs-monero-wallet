export class InvalidTransactionIDError extends TypeError {
  name = 'InvalidTransactionIDError';
  constructor(id, options) {
    super(`Invalid transaction ID: "${id}"`, options);
    this.id = id;
  }
}

export class TransactionAlreadyAddedError extends TypeError {
  name = 'TransactionAlreadyAddedError';
  constructor(id, options) {
    super(`Transaction already added ID: "${id}"`, options);
    this.id = id;
  }
}

export class UnknownTransactionError extends TypeError {
  name = 'UnknownTransactionError';
  constructor(id, options) {
    super(`Unknown transaction ID: "${id}"`, options);
    this.id = id;
  }
}

export class NotYourTransactionError extends TypeError {
  name = 'NotYourTransactionError';
  constructor(id, options) {
    super(`Not your transaction ID: "${id}"`, options);
    this.id = id;
  }
}
