const protobuf = require('protobufjs');
const forge = require('node-forge');
const path = require('path');
const Long = require('long');
const duration = require('./duration');
const AccountID = require('./accountId');
const { DEFAULT_TX_FEE, TRANSACTION_RESPONSE_CODE } = require('./constants');

const { ed25519 } = forge;
const txRoot = protobuf.loadSync(path.join(__dirname, '../hedera-proto/Transaction.proto'));
const txBodyRoot = protobuf.loadSync(path.join(__dirname, '../hedera-proto/TransactionBody.proto'));

class Transaction {
  constructor({ operatorId, nodeAccountId }) {
    this.operatorId = new AccountID(operatorId);
    this.nodeAccountId = new AccountID(nodeAccountId);
  }

  initBody(options) {
    const transactionID = {
      accountID: this.operatorId.toObject(),
      transactionValidStart: options.transactionValidStart || duration.now(),
    };

    return {
      transactionID,
      nodeAccountID: this.nodeAccountId.toObject(),
      transactionFee: Long.fromString(options.transactionFee || DEFAULT_TX_FEE),
      transactionValidDuration: options.transactionValidDuration || duration.seconds(120),
      memo: options.memo || undefined,
    };
  }

  serialize() {
    const TransactionProto = txRoot.lookup('proto.Transaction');
    const error = TransactionProto.verify(this.tx);
    if (error) throw Error(error);

    const message = TransactionProto.create(this.tx);
    const buffer = TransactionProto.encode(message).finish();
    return buffer.toString('hex');
  }

  static deserialize(hex) {
    const buffer = Buffer.from(hex, 'hex');
    const TransactionProto = txRoot.lookup('proto.Transaction');
    const tx = TransactionProto.decode(buffer);

    const error = TransactionProto.verify(tx);
    if (error) return undefined;
    return tx;
  }

  toObject() {
    return this.tx;
  }

  getTransactionId() {
    return this.tx.body.transactionID;
  }

  static async handleResponse(response) {
    if (response.nodeTransactionPrecheckCode === 0 || !response.nodeTransactionPrecheckCode) {
      return TRANSACTION_RESPONSE_CODE[0];
    }

    throw Error(TRANSACTION_RESPONSE_CODE[response.nodeTransactionPrecheckCode]);
  }

  addSignature(signature, publicKey) {
    if (!this.tx) {
      throw Error('Missing transaction body. Must create transaction before adding signature');
    }

    const encoding = 'binary';
    const sig = {
      pubKeyPrefix: Buffer.from(forge.util.binary.hex.decode(publicKey), encoding),
      ed25519: signature,
    };
    if (!Buffer.isBuffer(signature)) sig.ed25519 = Buffer.from(signature, 'binary');

    this.tx.sigMap = { sigPair: [sig] };
    return this;
  }

  // sign and return tx with signature
  async signTransaction(privateKey, publicKey) {
    if (!this.tx) {
      throw Error('Missing transaction body. Must create transaction before adding signature');
    }

    const signature = await this.constructor.sign(this.tx.body, privateKey);
    this.addSignature(signature, publicKey);
    return this;
  }

  static serializeBody(body) {
    const TransactionBody = txBodyRoot.lookup('proto.TransactionBody');
    const error = TransactionBody.verify(body);
    if (error) throw Error(error);

    const message = TransactionBody.create(body);
    const buffer = TransactionBody.encode(message).finish();
    return buffer;
  }

  static deserializeBody(body) {
    const buffer = Buffer.from(body, 'hex');
    const TransactionBody = txBodyRoot.lookup('proto.TransactionBody');
    const tx = TransactionBody.decode(buffer);
    return tx;
  }

  static sign(body, privateKeyHex) {
    const message = this.serializeBody(body);
    const encoding = 'binary';
    const privateKey = Buffer.from(forge.util.binary.hex.decode(privateKeyHex), encoding);
    const signature = ed25519.sign({ encoding, message, privateKey });
    return signature;
  }
}

module.exports = Transaction;
